import { createHash } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { makeSale, priceLines, shiftTotals, stockReplay, totalLines } from "../lib/domain";
import type { Shift } from "../lib/types";
import { isOnShift } from "../lib/team";
import type { Transaction } from "./db";
import { ensure, RegisterError } from "./errors";
import type { InputEvent } from "./input";
import { bookings, expenses, sales, shifts, syncedEvents } from "./schema";
import { presentExpense, presentSale, presentShift } from "./snapshot";

/** Price offline receipts using the menu the device had when it checked out. */
function receiptMenu(shift: typeof shifts.$inferSelect, event: Extract<InputEvent, { type: "sale" }>) {
  const { menuHistory, menu } = shift;
  if (event.menuVersion === "opening") return menuHistory[0]?.previousMenu ?? menu;
  if (event.menuVersion) {
    const index = menuHistory.findIndex((revision) => revision.id === event.menuVersion);
    ensure(index >= 0, "That receipt's menu version could not be found. The receipt is still on this phone.", 409);
    return menuHistory[index + 1]?.previousMenu ?? menu;
  }
  // Older app versions and sales already queued on this device have a timestamp only.
  const soldAt = Date.parse(event.sale.createdAt);
  const byTime = menuHistory.find((revision) => Date.parse(revision.appliedAt) > soldAt)?.previousMenu ?? menu;
  const { subtotal, lines } = event.sale;
  if (subtotal === undefined || !menuHistory.length) return byTime;
  // An older offline device can still use its cached menu after another phone edits it.
  // Match its subtotal only against server-owned prices and option sets.
  return [byTime, menu, ...menuHistory.map((revision) => revision.previousMenu).reverse()].find((candidate) => {
    try {
      return totalLines(priceLines(candidate, lines)) === subtotal;
    } catch {
      return false;
    }
  }) ?? byTime;
}

function eventForFingerprint(event: InputEvent) {
  if (event.type !== "sale") return event;
  // This field was previously stripped by validation. Keep old retries idempotent.
  const { subtotal, ...sale } = event.sale;
  return { ...event, sale };
}

/** A repeated write on the same till must match the first committed request. */
export async function claimRegisterEvent(tx: Transaction, shiftId: string, id: string, payload: object) {
  const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const inserted = await tx.insert(syncedEvents).values({ id, shiftId, fingerprint })
    .onConflictDoNothing().returning({ id: syncedEvents.id });
  if (inserted.length) return true;
  const [prior] = await tx.select({ fingerprint: syncedEvents.fingerprint }).from(syncedEvents)
    .where(and(eq(syncedEvents.id, id), eq(syncedEvents.shiftId, shiftId)));
  ensure(prior?.fingerprint === fingerprint,
    "A record on this phone doesn't match the saved one. This phone's copy is kept.", 409);
  return false;
}

/** The drawer difference and stock used, from everything recorded on a closed shift. */
export async function closingFigures(tx: Transaction, shift: Shift, countedCash: number) {
  const sold = (await tx.select().from(sales).where(eq(sales.shiftId, shift.id))).map(presentSale);
  const spent = (await tx.select().from(expenses).where(eq(expenses.shiftId, shift.id))).map(presentExpense);
  const { expectedCash } = shiftTotals(shift, sold, spent);
  const { used, left } = stockReplay(shift, sold);
  const usedStock = Object.keys(used).length
    ? Object.fromEntries(Object.entries(used).map(([id, n]) => [id, Math.round(n * 1000) / 1000]))
    : null;
  // A count at closing wins over what the sales say is left.
  const kept = { ...left, ...shift.closingStock };
  const leftStock = Object.keys(kept).length
    ? Object.fromEntries(Object.entries(kept).map(([id, n]) => [id, Math.max(0, Math.round(n * 1000) / 1000)]))
    : null;
  return { difference: countedCash - expectedCash, usedStock, leftStock };
}

/**
 * Record what a phone did on a shift. Any phone on the team can sell on the open shift,
 * so receipts are numbered here as they arrive. Sales and expenses that reach a shift
 * after another phone closed it are still recorded, and the closing figures are worked
 * out again, because the money already changed hands.
 */
export async function applyEvents(
  tx: Transaction,
  businessId: string,
  currency: string,
  events: InputEvent[],
  recorder: { memberId: string; deviceId: string; primaryOwner: boolean },
) {
  if (!events.length) return;
  const shiftId = events[0].shiftId;
  ensure(
    events.every((event) => event.shiftId === shiftId),
    "Sync one shift at a time.",
  );
  const [shift] = await tx
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, shiftId), eq(shifts.businessId, businessId)));
  ensure(shift, "That shift isn't on this account anymore.", 409);
  const knownDevice = shift.tillDevices?.[recorder.memberId]?.includes(recorder.deviceId);
  if (!knownDevice) {
    const bookingId = shift.bookingId;
    const [booking] = bookingId ? await tx.select({ staff: bookings.staff }).from(bookings)
      .where(and(eq(bookings.businessId, businessId), eq(bookings.id, bookingId))) : [];
    // Existing offline queues may predate device registration. Current assignees can still sync them.
    const legacyOwner = !booking && !shift.tillDevices && recorder.primaryOwner && recorder.deviceId === shift.deviceId;
    ensure(isOnShift(booking, recorder.memberId) || legacyOwner,
      "This phone couldn’t verify till access. Unsynced records are still saved here. Ask an owner to restore your shift assignment, then retry sync.", 403);
  }
  const current = presentShift(shift, currency);
  const closed = Boolean(current.closedAt);
  const unavailable = new Set(shift.soldOut);
  const targets = new Set(
    shift.menu.flatMap((item) => [
      item.id,
      ...item.groups.flatMap((g) => g.options.map((o) => o.id)),
    ]),
  );
  const [last] = await tx
    .select({ sequence: sales.sequence })
    .from(sales)
    .where(eq(sales.shiftId, shift.id))
    .orderBy(desc(sales.sequence))
    .limit(1);
  let nextSequence = (last?.sequence ?? 0) + 1;
  let availabilityChanged = false;
  let recorded = false;

  for (const event of events) {
    if (!await claimRegisterEvent(tx, shiftId, event.id, eventForFingerprint(event))) continue;

    if (event.type === "availability") {
      // Sold-out marks only matter while the shift is open.
      if (closed || !targets.has(event.targetId)) continue;
      if (event.soldOut) unavailable.add(event.targetId);
      else unavailable.delete(event.targetId);
      availabilityChanged = true;
      continue;
    }

    if (event.type === "expense") {
      const e = event.expense;
      ensure(event.id === e.id && e.shiftId === shift.id, "This expense couldn't be saved. Try logging it again.");
      ensure(!e.deduction || (e.deduction.kind === "member") === (e.source === "pocket"), "Choose where the expense was paid from.");
      await tx
        .insert(expenses)
        .values({
          id: e.id,
          shiftId: shift.id,
          createdAt: e.createdAt,
          label: e.label,
          amount: e.amount,
          source: e.source,
          deduction: e.deduction,
          by: e.by ?? null,
        })
        .onConflictDoNothing();
      recorded = true;
      continue;
    }
    if (event.type === "editExpense" || event.type === "unexpense") {
      const changes = event.type === "editExpense" ? event.changes : undefined;
      ensure(!changes?.deduction || (changes.deduction.kind === "member") === (changes.source === "pocket"), "Choose where the expense was paid from.");
      await tx
        .update(expenses)
        .set(changes ? {
          ...changes,
          deduction: changes.deduction === undefined
            ? sql`case when ${expenses.source} = ${changes.source} then ${expenses.deduction} end`
            : changes.deduction,
        } : { voidedAt: new Date().toISOString() })
        .where(and(eq(expenses.id, event.targetId), eq(expenses.shiftId, shift.id), isNull(expenses.voidedAt)));
      recorded = true;
      continue;
    }

    const { sale } = event;
    ensure(
      event.id === sale.id && sale.shiftId === shift.id,
      "This receipt couldn't be saved. It's still on this phone.",
    );
    const menu = receiptMenu(shift, event);
    let priced;
    try {
      priced = makeSale({
        id: sale.id,
        shift: { ...current, menu },
        sequence: nextSequence,
        cart: sale.lines,
        soldOut: [],
        tender: sale.tender,
        discountId: sale.discount?.id,
        received: sale.received,
        createdAt: sale.createdAt,
        proofs: sale.proofs,
        recorded: true,
      });
    } catch (error) {
      throw new RegisterError(
        422,
        error instanceof Error
          ? error.message
          : "This receipt couldn't be checked. It's still on this phone.",
      );
    }
    await tx.insert(sales).values(priced).onConflictDoNothing();
    nextSequence++;
    recorded = true;
  }
  if (availabilityChanged)
    await tx
      .update(shifts)
      .set({ soldOut: [...unavailable] })
      .where(eq(shifts.id, shift.id));
  if (closed && recorded && shift.countedCash !== null)
    await tx
      .update(shifts)
      .set(await closingFigures(tx, current, shift.countedCash))
      .where(eq(shifts.id, shift.id));
}
