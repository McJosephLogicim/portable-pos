import { and, desc, eq, isNull } from "drizzle-orm";
import { checkCount } from "../lib/cash";
import { checkClosing, checkOpening, shiftTotals, stockLeft, withNewItems } from "../lib/domain";
import {
  currencyDigits,
  defaultSettings,
  legacyShiftSettings,
  mergeShiftSettings,
} from "../lib/settings";
import { ownerPlanActions, planActions, walkInBooking, type PlanCommand } from "../lib/team";
import { getDb, type Transaction } from "./db";
import { ensure } from "./errors";
import { parseCommand } from "./input";
import { hashPin, verifyPin } from "./pin";
import { bookings, businesses, expenses, members, sales, shifts } from "./schema";
import { presentExpense, presentSale, presentShift, snapshot as baseSnapshot } from "./snapshot";
import { applyEvents } from "./sync";
import { listBusinesses, presentMe, resolveAccess, runPlan, type Actor } from "./team";

const pinActions = ["reverse", "close", "menu", "settings", ...ownerPlanActions];
const ownerActions = ["menu", "settings", ...ownerPlanActions];

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

export async function runCommand(who: string | Actor, input: unknown) {
  const actor: Actor = typeof who === "string" ? { id: who } : { ...who };
  const cmd = parseCommand(input);
  const selfAction = cmd.action === "leave" || cmd.action === "role";
  if (pinActions.includes(cmd.action) || selfAction) {
    // Joining by invite happens here too, so the PIN is checked against the right business.
    const access = await getDb().transaction((tx) => resolveAccess(tx, actor));
    ensure(access, "Create your business first.", 404);
    // Taking yourself off a shift needs no PIN. Taking someone else off does.
    if (!selfAction || cmd.memberId !== access.member.id) {
      const pin = "pin" in cmd ? cmd.pin : undefined;
      ensure(pin, "Enter the owner PIN.", 403);
      await verifyPin(access.business.id, pin);
    }
  }

  return getDb().transaction(async (tx) => {
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
    // The business is the write lock for its register. Independent sellers never
    // block each other. Snapshots are taken while the same lock is still held.
    const access = await resolveAccess(tx, actor);
    if (cmd.action === "bootstrap" || cmd.action === "setup")
      return snapshot(access);
    ensure(access, "Create your business first.", 404);
    const { business, member } = access;
    const me = presentMe(member);
    ensure(!ownerActions.includes(cmd.action) || me.owner, "Only the owner can change this.", 400);

    if ((planActions as readonly string[]).includes(cmd.action)) {
      await runPlan(tx, business, me, cmd as PlanCommand);
      return snapshot(access);
    }

    if (cmd.action === "menu") {
      await tx
        .update(businesses)
        .set({ menu: cmd.menu })
        .where(eq(businesses.id, business.id));
      // New items reach the till that is open on this phone straight away.
      const [open] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.businessId, business.id), isNull(shifts.closedAt)));
      if (open && cmd.deviceId && open.deviceId === cmd.deviceId) {
        const next = withNewItems(presentShift(open, business.currency), cmd.menu, cmd.stock);
        await tx
          .update(shifts)
          .set({ menu: next.menu, stock: next.stock ?? null })
          .where(eq(shifts.id, open.id));
      }
    } else if (cmd.action === "settings") {
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
      }
      await tx
        .update(businesses)
        .set({
          name: cmd.name,
          currency: cmd.currency,
          timeZone: cmd.timeZone,
          settings: cmd.settings,
        })
        .where(eq(businesses.id, business.id));
      // The till applies new checkout settings right away. The client syncs every pending
      // receipt before this command, and anything removed stays in the snapshot switched
      // off, so receipts already priced on another path still validate.
      if (open && open.deviceId === cmd.deviceId) {
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
      await applyEvents(
        tx,
        business.id,
        business.currency,
        cmd.deviceId,
        cmd.events,
      );
    } else if (cmd.action === "open") {
      const [last] = await tx
        .select()
        .from(shifts)
        .where(eq(shifts.businessId, business.id))
        .orderBy(desc(shifts.number))
        .limit(1);
      if (last && !last.closedAt) {
        ensure(
          last.deviceId === cmd.deviceId,
          "A shift is already open on another device.",
          409,
        );
      } else {
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
        let bookingId = cmd.bookingId;
        if (bookingId) {
          const [booking] = await tx
            .select({ id: bookings.id })
            .from(bookings)
            .where(and(eq(bookings.id, bookingId), eq(bookings.businessId, business.id)));
          ensure(booking, "That scheduled shift was removed.", 404);
        } else {
          // Every till runs for a shift. Without one scheduled, start one now.
          bookingId = await addWalkIn(tx, business.id, me, cmd.newShift ?? { hours: 8 });
        }
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
          menu: business.menu,
          settings: {
            ...(business.settings ?? defaultSettings(business.currency)),
            currency: business.currency,
          },
        });
      }
    } else if (cmd.action === "link") {
      const [open] = await tx
        .select()
        .from(shifts)
        .where(and(eq(shifts.businessId, business.id), isNull(shifts.closedAt)));
      ensure(open?.deviceId === cmd.deviceId, "Open the till on this phone first.", 409);
      if (!open.bookingId) {
        const bookingId = await addWalkIn(tx, business.id, me, cmd.newShift, Date.parse(open.openedAt));
        await tx.update(shifts).set({ bookingId }).where(eq(shifts.id, open.id));
      }
    } else if (cmd.action === "reverse") {
      const [open] = await tx
        .select()
        .from(shifts)
        .where(
          and(eq(shifts.businessId, business.id), isNull(shifts.closedAt)),
        );
      ensure(
        open?.deviceId === cmd.deviceId,
        "Reverse sales on the device with the open shift.",
        409,
      );
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
      ensure(
        shift?.deviceId === cmd.deviceId,
        "Close this shift on the device where it was opened.",
        409,
      );
      if (!shift.closedAt) {
        const receipts = await tx
          .select()
          .from(sales)
          .where(eq(sales.shiftId, shift.id));
        const spent = await tx.select().from(expenses).where(eq(expenses.shiftId, shift.id));
        const present = presentShift(shift, business.currency);
        const sold = receipts.map(presentSale);
        const { expectedCash } = shiftTotals(present, sold, spent.map(presentExpense));
        let closingStock, closingCount;
        try {
          closingStock = checkClosing(present, cmd.closingStock);
          closingCount = checkCount(cmd.closingCount, cmd.countedCash);
        } catch (error) {
          ensure(false, (error as Error).message);
        }
        const left = stockLeft(present, sold);
        const usedStock = present.stock
          ? Object.fromEntries(Object.entries(present.stock).map(([id, n]) => [id, Math.round((n - left[id]) * 1000) / 1000]))
          : null;
        await tx
          .update(shifts)
          .set({
            closedAt: new Date().toISOString(),
            countedCash: cmd.countedCash,
            difference: cmd.countedCash - expectedCash,
            closingStock: closingStock ?? null,
            closingCount: closingCount ?? null,
            usedStock,
          })
          .where(eq(shifts.id, shift.id));
      }
    }
    return snapshot(access);
  });
}
