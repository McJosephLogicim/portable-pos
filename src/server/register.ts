import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { checkCount } from "../lib/cash";
import { changeMenuItem, checkClosing, checkOpening, updateShiftMenu } from "../lib/domain";
import {
  currencyDigits,
  defaultSettings,
  legacyShiftSettings,
  mergeShiftSettings,
} from "../lib/settings";
import { batchIngredientProblem, hasStockCostAmounts, pricingInCurrency, withoutMenuCosts, withoutStockCosts } from "../lib/stock";
import { linkBookingProblem, normalEmail, ownerPlanActions, planActions, startProblem, walkInBooking, type PlanCommand } from "../lib/team";
import type { RegisterResponse } from "../lib/types";
import { getDb, type Transaction } from "./db";
import { ensure } from "./errors";
import { parseCommand, validateMenu } from "./input";
import { sendInvitationEmail } from "./invitation-email";
import { hashPin, verifyPin } from "./pin";
import { bookings, businesses, members, sales, shifts } from "./schema";
import { presentShift, snapshot as baseSnapshot } from "./snapshot";
import { applyEvents, closingFigures } from "./sync";
import { acceptInvite, listBusinesses, presentMe, resolveAccess, runPlan, type Actor } from "./team";

const ownerActions = ["menu", "removeMenuItem", "restoreMenuItem", "settings", "mode", ...ownerPlanActions];
const pinActions = ["reverse", "close", ...ownerActions];

async function addWalkIn(
  tx: Transaction,
  businessId: string,
  me: ReturnType<typeof presentMe>,
  input: { place?: string; hours: number },
  at?: number,
) {
  const b = walkInBooking(input, me, at);
  await tx.insert(bookings).values({
    id: b.id,
    businessId,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    place: b.place,
    organizer: null,
    event: null,
    seats: b.seats,
    staff: b.staff,
  });
  return b.id;
}

export async function runCommand(
  who: string | Actor,
  input: unknown,
): Promise<RegisterResponse & { nextSales?: string }> {
  const actor: Actor = typeof who === "string" ? { id: who } : { ...who };
  const cmd = parseCommand(input);
  const selfAction = cmd.action === "leave" || cmd.action === "role" || cmd.action === "profile";
  if (pinActions.includes(cmd.action) || selfAction) {
    // Joining by invite happens here too, so the PIN is checked against the right business.
    const access = await getDb().transaction((tx) => resolveAccess(tx, actor));
    ensure(access, "Create your business first.", 404);
    actor.businessId = access.business.id;
    // Taking yourself off a shift needs no PIN. Taking someone else off does.
    const others = cmd.action === "profile" ? cmd.memberId && cmd.memberId !== access.member.id : true;
    if (!selfAction || (cmd.action === "profile" ? others : cmd.memberId !== access.member.id)) {
      const pin = "pin" in cmd ? cmd.pin : undefined;
      ensure(pin, "Enter the owner PIN.", 403);
      await verifyPin(access.business.id, pin);
    }
  }

  const data = await getDb().transaction(async (tx) => {
    const snapshot = async (access: Parameters<typeof baseSnapshot>[1]) => ({
      ...(await baseSnapshot(tx, access)),
      businesses: await listBusinesses(tx, actor),
    });
    if (cmd.action === "setup") {
      if (cmd.id) {
        // Another business: the new one is what the app works in from now on.
        await tx
          .insert(businesses)
          .values({
            id: cmd.id,
            ownerId: actor.id,
            name: cmd.name,
            currency: cmd.currency,
            timeZone: cmd.timeZone,
            pinHash: await hashPin(cmd.pin),
          })
          .onConflictDoNothing({ target: businesses.id });
        actor.businessId = cmd.id;
      } else {
        const [onTeam] = await tx.select().from(members).where(eq(members.userId, actor.id)).limit(1);
        const [owns] = await tx.select({ id: businesses.id }).from(businesses).where(eq(businesses.ownerId, actor.id)).limit(1);
        if (!onTeam && !owns)
          await tx.insert(businesses).values({
            ownerId: actor.id,
            name: cmd.name,
            currency: cmd.currency,
            timeZone: cmd.timeZone,
            pinHash: await hashPin(cmd.pin),
          });
        else ensure(owns, "This account is already on a team. Add your own business from Settings.", 409);
      }
    }
    if (cmd.action === "acceptInvite") await acceptInvite(tx, actor, cmd.code);
    // The business is the write lock for its register. Independent sellers never
    // block each other. Snapshots are taken while the same lock is still held.
    const access = await resolveAccess(tx, actor);
    if (cmd.action === "bootstrap" || cmd.action === "setup" || cmd.action === "acceptInvite")
      return snapshot(access);
    ensure(access, "Create your business first.", 404);
    const { business, member } = access;
    const me = presentMe(member);
    ensure(!ownerActions.includes(cmd.action) || me.owner, "Only the owner can change this.", 400);

    if ((planActions as readonly string[]).includes(cmd.action)) {
      const deleted = await runPlan(tx, business, me, cmd as PlanCommand);
      if (deleted) return { ...(await snapshot(access)), deletedRecord: { kind: "booking" as const, booking: deleted } };
      return snapshot(access);
    }

    if (cmd.action === "menu" || cmd.action === "removeMenuItem" || cmd.action === "restoreMenuItem") {
      let menu, deletedRecord;
      if (cmd.action === "menu") {
        menu = cmd.menu;
      } else {
        if (cmd.action === "restoreMenuItem" &&
          isDeepStrictEqual(business.menu.find((item) => item.id === cmd.item.id), cmd.item))
          return snapshot(access);
        try {
          ({ menu, deletedRecord } = changeMenuItem(business.menu, cmd));
        } catch (error) {
          ensure(false, (error as Error).message, 409);
        }
        if (cmd.action === "restoreMenuItem") validateMenu(menu);
      }
      const problem = batchIngredientProblem(menu, business.settings?.stockItems);
      if (problem) ensure(false, problem);
      await tx
        .update(businesses)
        .set({ menu })
        .where(eq(businesses.id, business.id));
      const [open] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.businessId, business.id), isNull(shifts.closedAt)));
      if (open) {
        const next = updateShiftMenu(
          presentShift(open, business.currency),
          menu,
          cmd.action === "menu" ? cmd.stock : undefined,
          business.settings?.stockItems,
        );
        if (!isDeepStrictEqual(next.menu, open.menu)) {
          await tx
            .update(shifts)
            .set({
              menu: next.menu,
              stock: next.stock ?? null,
              settings: next.settings,
              menuHistory: [...open.menuHistory, {
                id: crypto.randomUUID(),
                appliedAt: new Date().toISOString(),
                previousMenu: open.menu,
              }],
            })
            .where(eq(shifts.id, open.id));
        }
      }
      return { ...(await snapshot(access)), deletedRecord };
    } else if (cmd.action === "mode") {
      await tx
        .update(businesses)
        .set({ settings: { ...(business.settings ?? defaultSettings(business.currency)), mode: cmd.mode } })
        .where(eq(businesses.id, business.id));
    } else if (cmd.action === "settings") {
      const problem = batchIngredientProblem(business.menu, cmd.settings.stockItems);
      if (problem) ensure(false, problem);
      const [open] = await tx
        .select()
        .from(shifts)
        .where(
          and(eq(shifts.businessId, business.id), isNull(shifts.closedAt)),
        );
      if (cmd.currency !== business.currency) {
        ensure(!open, "Close the shift before changing currency.", 409);
        ensure(
          !business.menu.length ||
            currencyDigits(cmd.currency) === currencyDigits(business.currency),
          `${cmd.currency} uses different decimals. Clear the menu first or keep ${business.currency}.`,
          409,
        );
        ensure(
          !hasStockCostAmounts(cmd.settings) ||
            currencyDigits(cmd.currency) === currencyDigits(business.currency),
          `${cmd.currency} uses different decimals. Clear the stock and batch costs first or keep ${business.currency}.`,
          409,
        );
      }
      await tx
        .update(businesses)
        .set({
          name: cmd.name,
          currency: cmd.currency,
          timeZone: cmd.timeZone,
          settings: {
            ...pricingInCurrency(cmd.settings, business.currency, cmd.currency),
            stockLists: cmd.settings.stockLists ?? business.settings?.stockLists,
            mode: business.settings?.mode,
          },
        })
        .where(eq(businesses.id, business.id));
      // The till applies new checkout settings right away. The client syncs every pending
      // receipt before this command, and anything removed stays in the snapshot switched
      // off, so receipts already priced on another path still validate.
      if (open) {
        await tx
          .update(shifts)
          .set({
            settings: mergeShiftSettings(
              open.settings ?? legacyShiftSettings(business.currency),
              cmd.settings,
            ),
          })
          .where(eq(shifts.id, open.id));
      }
    } else if (cmd.action === "sync") {
      await applyEvents(tx, business.id, business.currency, cmd.events);
    } else if (cmd.action === "open") {
      const [last] = await tx
        .select()
        .from(shifts)
        .where(eq(shifts.businessId, business.id))
        .orderBy(desc(shifts.number))
        .limit(1);
      // A shift already open on another phone is joined, not opened twice.
      if (!last || last.closedAt) {
        ensure(
          business.menu.length,
          "Add a menu item before opening the till.",
        );
        const settings = business.settings ?? defaultSettings(business.currency);
        const checklist = settings.checklist ?? [];
        let stock, openingCount;
        try {
          stock = checkOpening(business.menu, settings.stockItems, checklist, cmd.stock, cmd.checked);
          openingCount = checkCount(cmd.openingCount, cmd.openingCash);
        } catch (error) {
          ensure(false, (error as Error).message);
        }
        const { bookingId } = cmd;
        ensure(bookingId, "Pick a scheduled shift to start. Add one on Shifts first.");
        const [booking] = await tx
          .select({ startsAt: bookings.startsAt, endsAt: bookings.endsAt })
          .from(bookings)
          .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, business.id)));
        ensure(booking, "That scheduled shift was removed.", 404);
        const [closed] = await tx
          .select({ id: shifts.id })
          .from(shifts)
          .where(and(
            eq(shifts.businessId, business.id),
            eq(shifts.bookingId, bookingId),
            isNotNull(shifts.closedAt),
          ))
          .limit(1);
        ensure(!closed, "This shift already closed. Add a new one on Shifts.", 409);
        const problem = startProblem(booking, business.timeZone);
        ensure(!problem, problem ?? "", 409);
        const { mode: _mode, ...checkoutSettings } = withoutStockCosts(settings);
        await tx.insert(shifts).values({
          stock: Object.keys(stock).length ? stock : null,
          openingCount: openingCount ?? null,
          openedBy: me.name || null,
          bookingId,
          checklist: checklist.map((c) => c.text),
          businessId: business.id,
          deviceId: cmd.deviceId,
          openingCash: cmd.openingCash,
          number: (last?.number ?? 0) + 1,
          openedAt: new Date().toISOString(),
          menu: withoutMenuCosts(business.menu),
          settings: {
            ...checkoutSettings,
            currency: business.currency,
          },
        });
      }
    } else if (cmd.action === "profile") {
      const target = cmd.memberId ?? member.id;
      ensure(target === member.id || me.owner, "Only the owner can change someone else's profile.", 403);
      ensure(cmd.photo !== undefined || cmd.name, "Nothing to change.");
      await tx
        .update(members)
        .set({ ...(cmd.photo !== undefined ? { photo: cmd.photo } : {}), ...(cmd.name ? { name: cmd.name } : {}) })
        .where(and(eq(members.id, target), eq(members.businessId, business.id)));
    } else if (cmd.action === "link") {
      const [open] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.businessId, business.id), isNull(shifts.closedAt)));
      ensure(open, "Open the till first.", 409);
      if (!open.bookingId) {
        const bookingId = await addWalkIn(tx, business.id, me, cmd.newShift, Date.parse(open.openedAt));
        await tx.update(shifts).set({ bookingId }).where(eq(shifts.id, open.id));
      }
    } else if (cmd.action === "linkBooking") {
      const [open] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.businessId, business.id), eq(shifts.id, cmd.shiftId), isNull(shifts.closedAt)));
      ensure(open, "The till changed. Open Shifts again to choose a shift.", 409);
      if (open.bookingId === cmd.bookingId) return snapshot(access);
      ensure(!open.bookingId, "This till is already on another shift.", 409);
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.businessId, business.id), eq(bookings.id, cmd.bookingId)));
      ensure(booking, "That scheduled shift was removed.", 404);
      const [closed] = await tx
        .select({ id: shifts.id })
        .from(shifts)
        .where(and(eq(shifts.businessId, business.id), eq(shifts.bookingId, booking.id), isNotNull(shifts.closedAt)))
        .limit(1);
      ensure(!closed, "This shift already closed. Choose another shift.", 409);
      const problem = linkBookingProblem(booking, business.timeZone);
      ensure(!problem, problem ?? "", 409);
      await tx.update(shifts).set({ bookingId: booking.id }).where(eq(shifts.id, open.id));
    } else if (cmd.action === "reverse") {
      const [open] = await tx
        .select()
        .from(shifts)
        .where(
          and(eq(shifts.businessId, business.id), isNull(shifts.closedAt)),
        );
      ensure(open, "Only sales on the open shift can be reversed.", 409);
      const [sale] = await tx
        .select()
        .from(sales)
        .where(and(eq(sales.id, cmd.saleId), eq(sales.shiftId, open.id)));
      ensure(sale, "That receipt is not in the open shift.", 404);
      if (!sale.reversedAt) {
        await tx
          .update(sales)
          .set({ reason: cmd.reason, reversedAt: new Date().toISOString() })
          .where(eq(sales.id, sale.id));
      }
    } else if (cmd.action === "close") {
      const [shift] = await tx
        .select()
        .from(shifts)
        .where(
          and(eq(shifts.id, cmd.shiftId), eq(shifts.businessId, business.id)),
        );
      ensure(shift, "That shift isn't on this account anymore.", 404);
      // Any phone can close. Sales still on other phones are added when they sync.
      if (!shift.closedAt) {
        const present = presentShift(shift, business.currency);
        let closingStock, closingCount;
        try {
          closingStock = checkClosing(present, cmd.closingStock);
          closingCount = checkCount(cmd.closingCount, cmd.countedCash);
        } catch (error) {
          ensure(false, (error as Error).message);
        }
        await tx
          .update(shifts)
          .set({
            closedAt: new Date().toISOString(),
            countedCash: cmd.countedCash,
            closingStock: closingStock ?? null,
            closingCount: closingCount ?? null,
            ...(await closingFigures(tx, present, cmd.countedCash)),
          })
          .where(eq(shifts.id, shift.id));
      }
    }
    return snapshot(access);
  });
  if (cmd.action === "invite" && data.business && cmd.email.trim()) {
    const email = normalEmail(cmd.email);
    const code = data.team?.find((m) => normalEmail(m.email) === email)?.inviteCode;
    return { ...data, inviteDelivery: await sendInvitationEmail(data.business, email, code) };
  }
  return data;
}
