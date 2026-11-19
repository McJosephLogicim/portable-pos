import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { makeSale, stockLeft } from "../lib/domain";
import type { Transaction } from "./db";
import { ensure, RegisterError } from "./errors";
import type { InputEvent } from "./input";
import { expenses, sales, shifts, syncedEvents } from "./schema";
import { presentSale, presentShift } from "./snapshot";

export async function applyEvents(
  tx: Transaction,
  businessId: string,
  currency: string,
  deviceId: string,
  events: InputEvent[],
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
  ensure(
    shift && shift.deviceId === deviceId,
    "This shift belongs to a different register.",
    409,
  );
  const current = presentShift(shift, currency);
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
  // Counted items can't sell below zero, even from a till that was offline.
  const left =
    shift.stock && Object.keys(shift.stock).length
      ? stockLeft(
          current,
          (
            await tx.select().from(sales).where(eq(sales.shiftId, shift.id))
          ).map(presentSale),
        )
      : undefined;
  let availabilityChanged = false;

  for (const event of events) {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(event))
      .digest("hex");
    const inserted = await tx
      .insert(syncedEvents)
      .values({ id: event.id, shiftId, fingerprint })
      .onConflictDoNothing()
      .returning({ id: syncedEvents.id });
    if (!inserted.length) {
      const [prior] = await tx
        .select({ fingerprint: syncedEvents.fingerprint })
        .from(syncedEvents)
        .where(
          and(
            eq(syncedEvents.id, event.id),
            eq(syncedEvents.shiftId, shift.id),
          ),
        );
      ensure(
        prior?.fingerprint === fingerprint,
        "A sync identifier was reused. Your local records have been kept.",
        409,
      );
      continue;
    }

    ensure(!current.closedAt, "This shift has already closed.", 409);
    if (event.type === "availability") {
      ensure(
        targets.has(event.targetId),
        "This menu item or option is missing from the shift.",
      );
      if (event.soldOut) unavailable.add(event.targetId);
      else unavailable.delete(event.targetId);
      availabilityChanged = true;
      continue;
    }

    if (event.type === "expense") {
      const e = event.expense;
      ensure(event.id === e.id && e.shiftId === shift.id, "The expense and sync identifiers do not match.");
      await tx
        .insert(expenses)
        .values({
          id: e.id,
          shiftId: shift.id,
          createdAt: e.createdAt,
          label: e.label,
          amount: e.amount,
          source: e.source,
          by: e.by ?? null,
        })
        .onConflictDoNothing();
      continue;
    }
    if (event.type === "unexpense") {
      await tx
        .update(expenses)
        .set({ voidedAt: new Date().toISOString() })
        .where(and(eq(expenses.id, event.targetId), eq(expenses.shiftId, shift.id), isNull(expenses.voidedAt)));
      continue;
    }

    const { sale } = event;
    ensure(
      event.id === sale.id && sale.shiftId === shift.id,
      "The receipt and sync identifiers do not match.",
    );
    ensure(
      sale.sequence === nextSequence,
      "Receipts must sync in order. Retry the earlier pending sale first.",
      409,
    );
    let priced;
    try {
      priced = makeSale({
        id: sale.id,
        shift: current,
        sequence: sale.sequence,
        cart: sale.lines,
        soldOut: [...unavailable],
        tender: sale.tender,
        discountId: sale.discount?.id,
        received: sale.received,
        createdAt: sale.createdAt,
        stock: left,
        proofs: sale.proofs,
      });
    } catch (error) {
      throw new RegisterError(
        422,
        error instanceof Error
          ? error.message
          : "Unable to validate this sale.",
      );
    }
    await tx.insert(sales).values(priced);
    if (left)
      for (const line of priced.lines)
        if (line.productId in left) left[line.productId] -= line.quantity;
    nextSequence++;
  }
  if (availabilityChanged)
    await tx
      .update(shifts)
      .set({ soldOut: [...unavailable] })
      .where(eq(shifts.id, shift.id));
}
