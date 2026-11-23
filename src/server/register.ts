import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { checkCount } from "../lib/cash";
import { changeMenuCategories, menuCategoryNames } from "../lib/menu-categories";
import { changeMenuItem, checkClosing, checkOpening, mergeLeftovers, setShiftStock, updateShiftMenu } from "../lib/domain";
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
import { parseCommand, readTill, validateMenu } from "./input";
import { sendInvitationEmail } from "./invitation-email";
import { hashPin, verifyPin } from "./pin";
import { bookings, businesses, completedOnboarding, expenses, images, members, sales, shifts, syncedEvents } from "./schema";
import { presentShift, snapshot as baseSnapshot } from "./snapshot";
import { applyEvents, closingFigures } from "./sync";
import { acceptInvite, listBusinesses, presentMe, resolveAccess, runPlan, type Actor } from "./team";

const ownerActions = ["menu", "saveMenuCategory", "removeMenuCategories", "removeMenuItem", "restoreMenuItem", "settings", "mode", "mergeStock", ...ownerPlanActions];
const pinActions = ["reverse", "close", ...ownerActions];

async function deleteBusiness(tx: Transaction, businessId: string) {
  const [open] = await tx.select({ id: shifts.id }).from(shifts)
    .where(and(eq(shifts.businessId, businessId), isNull(shifts.closedAt))).limit(1);
  ensure(!open, "Close all open tills before deleting this business.", 409);

  const shiftIds = tx.select({ id: shifts.id }).from(shifts).where(eq(shifts.businessId, businessId));
  await tx.delete(sales).where(inArray(sales.shiftId, shiftIds));
  await tx.delete(expenses).where(inArray(expenses.shiftId, shiftIds));
  await tx.delete(syncedEvents).where(inArray(syncedEvents.shiftId, shiftIds));
  await tx.delete(shifts).where(eq(shifts.businessId, businessId));
  await tx.delete(bookings).where(eq(bookings.businessId, businessId));
  await tx.delete(images).where(eq(images.businessId, businessId));
  await tx.delete(members).where(eq(members.businessId, businessId));
  await tx.delete(businesses).where(eq(businesses.id, businessId));
}

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
  const view = readTill(input);
  if (cmd.action === "deleteBusiness") {
    await verifyPin(cmd.businessId, cmd.pin, {
      userId: actor.id,
      run: (tx) => deleteBusiness(tx, cmd.businessId),
    });
  }
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
    const snapshot = async (access: Parameters<typeof baseSnapshot>[1]) => {
      const [completion] = await tx.select({ userId: completedOnboarding.userId })
        .from(completedOnboarding).where(eq(completedOnboarding.userId, actor.id));
      return {
        ...(await baseSnapshot(tx, access, view)),
        businesses: await listBusinesses(tx, actor),
        onboardingComplete: Boolean(completion),
      };
    };
    if (cmd.action === "deleteBusiness") return snapshot(null);
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
    if (cmd.action === "leaveTeam") actor.businessId = cmd.businessId;
    // The business is the write lock for its register. Independent sellers never
    // block each other. Snapshots are taken while the same lock is still held.
    const access = await resolveAccess(tx, actor);
    if (cmd.action === "bootstrap" || cmd.action === "setup" || cmd.action === "acceptInvite")
      return snapshot(access);
    if (cmd.action === "leaveTeam") {
      if (access) await runPlan(tx, access.business, presentMe(access.member), cmd);
      return snapshot(null);
    }
    ensure(access, "Create your business first.", 404);
    const { business, member } = access;
    const me = presentMe(member);
    if (cmd.action === "completeOnboarding") {
      ensure(me.owner, "Only a business owner can finish this setup.", 403);
      await tx.insert(completedOnboarding).values({ userId: actor.id }).onConflictDoNothing();
      return snapshot(access);
    }
    ensure(!ownerActions.includes(cmd.action) || me.owner, "Only the owner can change this.", 400);
    /** Every booth's open shift. */
    const openShifts = () =>
      tx.select().from(shifts).where(and(eq(shifts.businessId, business.id), isNull(shifts.closedAt)));
    /** The open shift this phone is running, if any. */
    const tillShift = async () => {
      const open = await openShifts();
      if (view.till !== undefined) return open.find((s) => s.id === view.till);
      // Older app versions: the one open shift, as before.
      return open.length === 1 ? open[0] : open.find((s) => s.deviceId === view.deviceId);
    };

    if ((planActions as readonly string[]).includes(cmd.action)) {
      const deleted = await runPlan(tx, business, me, cmd as PlanCommand);
      if (deleted) return { ...(await snapshot(access)), deletedRecord: { kind: "booking" as const, booking: deleted } };
      return snapshot(access);
    }

    if (cmd.action === "menu" || cmd.action === "removeMenuItem" || cmd.action === "restoreMenuItem" ||
      cmd.action === "saveMenuCategory" || cmd.action === "removeMenuCategories") {
      const settings = business.settings ?? defaultSettings(business.currency);
      let menu, deletedRecord, menuCategories;
      if (cmd.action === "menu") {
        menu = cmd.menu;
      } else if (cmd.action === "saveMenuCategory" || cmd.action === "removeMenuCategories") {
        try {
          ({ menu, menuCategories } = changeMenuCategories(business.menu, settings.menuCategories, cmd));
        } catch (error) {
          ensure(false, (error as Error).message, 409);
        }
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
      menuCategories ??= menuCategoryNames(menu, menuCategoryNames(business.menu, settings.menuCategories));
      await tx
        .update(businesses)
        .set({ menu, settings: { ...settings, menuCategories } })
        .where(eq(businesses.id, business.id));
      if (menu === business.menu) return snapshot(access);
      // Every booth running now gets the change. Counts asked for on this phone go to its own shift;
      // the others start new stock items from their saved amount.
      const till = await tillShift();
      for (const open of await openShifts()) {
        const appliedAt = new Date().toISOString();
        const next = updateShiftMenu(
          presentShift(open, business.currency),
          menu,
          cmd.action === "menu" && open.id === till?.id ? cmd.stock : undefined,
          business.settings?.stockItems,
          appliedAt,
        );
        const menuChanged = !isDeepStrictEqual(next.menu, open.menu);
        if (menuChanged || !isDeepStrictEqual(next.stockSets ?? null, open.stockSets)) {
          await tx
            .update(shifts)
            .set({
              menu: next.menu,
              stockSets: next.stockSets ?? null,
              settings: next.settings,
              ...(menuChanged ? { menuHistory: [...open.menuHistory, {
                id: crypto.randomUUID(),
                appliedAt,
                previousMenu: open.menu,
              }] } : {}),
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
      const running = await openShifts();
      const till = await tillShift();
      if (cmd.currency !== business.currency) {
        ensure(!running.length, running.length > 1 ? "Close every open shift before changing currency." : "Close the shift before changing currency.", 409);
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
            menuCategories: business.settings?.menuCategories,
            mode: business.settings?.mode,
          },
        })
        .where(eq(businesses.id, business.id));
      // The till applies new checkout settings right away. The client syncs every pending
      // receipt before this command, and anything removed stays in the snapshot switched
      // off, so receipts already priced on another path still validate.
      for (const open of running) {
        const settings = mergeShiftSettings(
          open.settings ?? legacyShiftSettings(business.currency),
          cmd.settings,
        );
        // "Left this shift" is what this phone's booth has. Other booths keep theirs.
        const next = cmd.stockNow && open.id === till?.id
          ? setShiftStock({ ...presentShift(open, business.currency), settings }, cmd.settings.stockItems, cmd.stockNow)
          : undefined;
        await tx
          .update(shifts)
          .set({
            settings: next?.settings ?? settings,
            ...(next?.stockSets ? { stockSets: next.stockSets } : {}),
          })
          .where(eq(shifts.id, open.id));
      }
    } else if (cmd.action === "sync") {
      await applyEvents(tx, business.id, business.currency, cmd.events);
    } else if (cmd.action === "open") {
      const { bookingId } = cmd;
      // Booths run side by side, each on its own phone. A shift already open on another
      // phone is joined, not opened twice.
      const joined = bookingId && (await openShifts()).find((s) => s.bookingId === bookingId);
      if (joined) view.till = joined.id;
      else {
        const mine = await tillShift();
        ensure(!mine, `Close shift ${mine?.number} on this phone before starting another.`, 409);
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
        const [last] = await tx
          .select({ number: shifts.number })
          .from(shifts)
          .where(eq(shifts.businessId, business.id))
          .orderBy(desc(shifts.number))
          .limit(1);
        const { mode: _mode, menuCategories: _categories, ...checkoutSettings } = withoutStockCosts(settings);
        const [opened] = await tx.insert(shifts).values({
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
        }).returning({ id: shifts.id });
        view.till = opened.id;
      }
      if (cmd.expenses?.length) {
        const shiftId = view.till;
        const by = me.name.slice(0, 80) || undefined;
        await applyEvents(tx, business.id, business.currency, cmd.expenses.map((expense) => ({
          type: "expense",
          id: expense.id,
          shiftId,
          expense: { ...expense, shiftId, by },
        })));
      }
    } else if (cmd.action === "mergeStock") {
      const rows = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.businessId, business.id), inArray(shifts.id, cmd.shiftIds)));
      ensure(rows.length === new Set(cmd.shiftIds).size, "A shift you picked isn't on this account anymore.", 404);
      ensure(rows.every((r) => r.closedAt), "Close every shift you picked before merging what's left.", 409);
      ensure(rows.every((r) => !r.mergedAt), "Some of these leftovers were already merged. Open the list again.", 409);
      const settings = business.settings ?? defaultSettings(business.currency);
      const total = mergeLeftovers(rows.map((r) => presentShift(r, business.currency)), settings.stockItems);
      ensure(Object.keys(total).length, "These shifts didn't track any stock or prep items.", 409);
      await tx
        .update(businesses)
        .set({
          settings: {
            ...settings,
            stockItems: settings.stockItems?.map((item) => (item.id in total ? { ...item, onHand: total[item.id] } : item)),
          },
        })
        .where(eq(businesses.id, business.id));
      await tx
        .update(shifts)
        .set({ mergedAt: new Date().toISOString() })
        .where(inArray(shifts.id, rows.map((r) => r.id)));
    } else if (cmd.action === "profile") {
      const target = cmd.memberId ?? member.id;
      ensure(target === member.id || me.owner, "Only the owner can change someone else's profile.", 403);
      ensure(cmd.photo !== undefined || cmd.name, "Nothing to change.");
      await tx
        .update(members)
        .set({ ...(cmd.photo !== undefined ? { photo: cmd.photo } : {}), ...(cmd.name ? { name: cmd.name } : {}) })
        .where(and(eq(members.id, target), eq(members.businessId, business.id)));
    } else if (cmd.action === "link") {
      const open = await tillShift();
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
      const [running] = await tx
        .select({ id: shifts.id })
        .from(shifts)
        .where(and(eq(shifts.businessId, business.id), eq(shifts.bookingId, booking.id), isNull(shifts.closedAt)))
        .limit(1);
      ensure(!running, "Another phone is already running this shift. Choose another shift.", 409);
      const problem = linkBookingProblem(booking, business.timeZone);
      ensure(!problem, problem ?? "", 409);
      await tx.update(shifts).set({ bookingId: booking.id }).where(eq(shifts.id, open.id));
    } else if (cmd.action === "reverse") {
      const [found] = await tx
        .select({ sale: sales, closedAt: shifts.closedAt })
        .from(sales)
        .innerJoin(shifts, eq(sales.shiftId, shifts.id))
        .where(and(eq(sales.id, cmd.saleId), eq(shifts.businessId, business.id)));
      ensure(found, "That receipt isn't on this account anymore.", 404);
      ensure(!found.closedAt, "Only sales on an open shift can be reversed.", 409);
      const { sale } = found;
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
            ...(await closingFigures(tx, { ...present, closingStock }, cmd.countedCash)),
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
