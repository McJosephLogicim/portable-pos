import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { makeSale } from "../src/lib/domain";
import type { RegisterEvent, Shift, Tender } from "../src/lib/types";
import { runCommand } from "../src/server/register";
import { shiftNow } from "./schedule";

test(
  "any phone sells on, manages and closes a shift, and late sales reconcile after closing",
  {
    skip:
      !process.env.POS_TEST_DATABASE_URL &&
      "Set POS_TEST_DATABASE_URL to a migrated local test database.",
  },
  async () => {
    process.env.DATABASE_URL = process.env.POS_TEST_DATABASE_URL;
    const owner = randomUUID();
    const phoneA = randomUUID();
    const phoneB = randomUUID();
    const pin = "4826";
    const cmd = (input: object) => runCommand(owner, input);
    await cmd({ action: "setup", name: "Two phone stall", currency: "PHP", timeZone: "Asia/Manila", pin });
    await cmd({
      action: "menu",
      pin,
      menu: [{ id: "tea", name: "Tea", category: "", price: 10000, groups: [], stock: true }],
    });
    const bookingId = await shiftNow(cmd, pin);
    const opened = await cmd({ action: "open", deviceId: phoneA, bookingId, openingCash: 50000, stock: { tea: 3 } });
    const shift = opened.shift!;

    // Phone B joins the shift phone A opened.
    const joined = await cmd({ action: "open", deviceId: phoneB, bookingId: await shiftNow(cmd, pin), openingCash: 0, stock: { tea: 9 } });
    assert.equal(joined.shift!.id, shift.id);
    assert.equal(joined.shift!.openingCash, 50000);

    // Both phones were offline and numbered their receipts #1 and #2 on their own.
    const sale = (s: Shift, sequence: number, tender: Tender = "cash") => {
      const made = makeSale({
        id: randomUUID(),
        shift: s,
        sequence,
        cart: [{ productId: "tea", quantity: 1, optionIds: [] }],
        soldOut: [],
        tender,
        received: 10000,
        createdAt: new Date().toISOString(),
      });
      return { type: "sale" as const, id: made.id, shiftId: s.id, sale: made };
    };
    const a = [sale(shift, 1), sale(shift, 2)];
    const b = [sale(shift, 1, "gcash"), sale(shift, 2)];
    const sync = (deviceId: string, events: RegisterEvent[]) => cmd({ action: "sync", deviceId, events });
    await sync(phoneA, a);
    const both = await sync(phoneB, b);
    const numbers = both.sales.filter((s) => s.shiftId === shift.id).map((s) => s.sequence).sort();
    assert.deepEqual(numbers, [1, 2, 3, 4]);
    // Retrying a batch never doubles it.
    assert.equal((await sync(phoneB, b)).sales.length, 4);

    // Phone B logs an expense and reverses one of phone A's sales.
    const expense = {
      id: randomUUID(),
      shiftId: shift.id,
      createdAt: new Date().toISOString(),
      label: "Ice",
      amount: 5000,
      source: "till" as const,
    };
    await sync(phoneB, [{ type: "expense", id: expense.id, shiftId: shift.id, expense }]);
    await cmd({ action: "reverse", deviceId: phoneB, saleId: a[0].id, reason: "Rang twice", pin });

    // Expected: 500 float + 200 cash (one cash sale reversed, one GCash) - 50 ice = 650.
    // Phone B closes with 650 counted, while phone A still has a cash sale waiting.
    const late = sale(shift, 3);
    const closed = await cmd({
      action: "close",
      deviceId: phoneB,
      shiftId: shift.id,
      countedCash: 75000,
      closingStock: { tea: 0 },
      pin,
    });
    assert.equal(closed.shift, null);
    assert.equal(closed.shifts[0].difference, 10000);

    // The late sale lands on the closed shift and the drawer adds up again.
    const settled = await sync(phoneA, [late]);
    const after = settled.shifts.find((s) => s.id === shift.id)!;
    assert.equal(after.difference, 0);
    assert.equal(after.usedStock?.tea, 4);
    assert.equal(settled.sales.find((s) => s.id === late.id)?.sequence, 5);
    // A sold-out mark that arrives after closing is ignored instead of blocking the queue.
    await sync(phoneA, [{ type: "availability", id: randomUUID(), shiftId: shift.id, targetId: "tea", soldOut: true }]);

    // The old phone can't restart the closed booking. A new shift moves the counter on.
    await assert.rejects(
      cmd({ action: "open", deviceId: phoneA, bookingId, openingCash: 0, stock: { tea: 1 } }),
      /already closed/,
    );
    const next = await cmd({ action: "open", deviceId: phoneA, bookingId: await shiftNow(cmd, pin), openingCash: 0, stock: { tea: 1 } });
    assert.equal(next.shift!.number, 2);
  },
);
