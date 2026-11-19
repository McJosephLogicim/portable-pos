import { and, desc, eq, isNull } from "drizzle-orm";
import { shiftTotals } from "../lib/domain";
import { getDb } from "./db";
import { ensure } from "./errors";
import { parseCommand } from "./input";
import { hashPin, verifyPin } from "./pin";
import { businesses, sales, shifts } from "./schema";
import { presentSale, presentShift, snapshot } from "./snapshot";
import { applyEvents } from "./sync";

export async function runCommand(ownerId: string, input: unknown) {
  const cmd = parseCommand(input);
  if (
    cmd.action === "reverse" ||
    cmd.action === "close" ||
    cmd.action === "menu"
  ) {
    await verifyPin(ownerId, cmd.pin);
  }

  return getDb().transaction(async (tx) => {
    if (cmd.action === "setup") {
      await tx
        .insert(businesses)
        .values({
          ownerId,
          name: cmd.name,
          currency: cmd.currency,
          timeZone: cmd.timeZone,
          pinHash: await hashPin(cmd.pin),
        })
        .onConflictDoNothing({ target: businesses.ownerId });
    }
    // The business is the write lock for its register. Independent sellers never
    // block each other. Snapshots are taken while the same lock is still held.
    const [business] = await tx
      .select()
      .from(businesses)
      .where(eq(businesses.ownerId, ownerId))
      .for("update");
    if (cmd.action === "bootstrap" || cmd.action === "setup")
      return snapshot(tx, ownerId);
    ensure(business, "Create your business first.", 404);

    if (cmd.action === "menu") {
      await tx
        .update(businesses)
        .set({ menu: cmd.menu })
        .where(eq(businesses.id, business.id));
    } else if (cmd.action === "sync") {
      await applyEvents(tx, business.id, cmd.deviceId, cmd.events);
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
        await tx.insert(shifts).values({
          businessId: business.id,
          deviceId: cmd.deviceId,
          openingCash: cmd.openingCash,
          number: (last?.number ?? 0) + 1,
          openedAt: new Date().toISOString(),
          menu: business.menu,
        });
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
        const { expectedCash } = shiftTotals(
          presentShift(shift),
          receipts.map(presentSale),
        );
        await tx
          .update(shifts)
          .set({
            closedAt: new Date().toISOString(),
            countedCash: cmd.countedCash,
            difference: cmd.countedCash - expectedCash,
          })
          .where(eq(shifts.id, shift.id));
      }
    }
    return snapshot(tx, ownerId);
  });
}
