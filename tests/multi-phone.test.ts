import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { makeSale } from "../src/lib/domain";
import type { RegisterEvent, Shift, Tender } from "../src/lib/types";
import { getDb } from "../src/server/db";
import { bookingRecords } from "../src/server/snapshot";
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

    const outsiderId = randomUUID();
    const outsider = (input: object) => runCommand(outsiderId, input);
    const invited = await cmd({ action: "invite", name: "New teammate", email: "", rate: 0, pin });
    const invite = invited.team!.find((person) => person.name === "New teammate")!;
    await outsider({ action: "acceptInvite", code: invite.inviteCode });
    const foreignTill = { action: "bootstrap", deviceId: randomUUID(), till: shift.id };
    assert.equal((await outsider(foreignTill)).shift, null);
    assert.equal((await outsider({ action: "bootstrap" })).shift, null);
    await assert.rejects(
      outsider({ action: "open", deviceId: foreignTill.deviceId, till: null, bookingId, openingCash: 0 }),
      { status: 403 },
    );
    const unstaffed = await shiftNow(cmd, pin, false);
    await assert.rejects(
      cmd({ action: "open", deviceId: randomUUID(), till: null, bookingId: unstaffed, openingCash: 0, stock: { tea: 1 } }),
      { status: 403 },
    );
    await outsider({ action: "join", bookingId, role: "cashier" });
    assert.equal((await outsider(foreignTill)).shift?.id, shift.id);
    await cmd({ action: "leave", bookingId, memberId: invite.id, pin });
    assert.equal((await outsider(foreignTill)).shift, null);

    // The same assigned account on a fresh phone sees the open shift before picking a till.
    const discovery = await cmd({ action: "bootstrap", deviceId: phoneB, till: null });
    assert.equal(discovery.shift, null);
    assert.deepEqual(discovery.shifts.map(({ id, closedAt }) => ({ id, closedAt })), [{ id: shift.id, closedAt: null }]);
    const joined = await cmd({ action: "bootstrap", deviceId: phoneB, till: shift.id });
    assert.equal(joined.shift!.id, shift.id);
    assert.equal(joined.shift!.openingCash, 50000);

    // A stale opening form on another phone joins without applying a second setup.
    const stalePhone = await cmd({
      action: "open", deviceId: randomUUID(), till: null, bookingId, openingCash: 0, stock: { tea: 9 },
      expenses: [{ id: randomUUID(), createdAt: new Date().toISOString(), label: "Extra float supplies", amount: 500, source: "till" }],
    });
    assert.equal(stalePhone.shift!.id, shift.id);
    assert.equal(stalePhone.shift!.openingCash, 50000);
    assert.deepEqual(stalePhone.shift!.stock, { tea: 3 });
    assert.deepEqual(stalePhone.expenses, []);

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
      by: "Ana",
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
    // An expense correction queued before closing also reconciles the original shift.
    const changes = { label: "Ice packs", amount: 4500, source: "pocket" as const };
    const edit: RegisterEvent = { type: "editExpense", id: randomUUID(), shiftId: shift.id, targetId: expense.id, changes };
    await sync(phoneA, [edit]);
    const retried = await sync(phoneA, [edit]);
    assert.deepEqual(retried.expenses, [{ ...expense, ...changes }]);
    assert.equal(retried.shifts.find((s) => s.id === shift.id)!.difference, -5000);
    const delivery = { ...expense, id: randomUUID(), label: "Delivery", amount: 1200 };
    const voidedExpense = { ...expense, id: randomUUID(), label: "Duplicate" };
    const spent = await sync(phoneA, [
      { type: "expense", id: delivery.id, shiftId: shift.id, expense: delivery },
      { type: "expense", id: voidedExpense.id, shiftId: shift.id, expense: voidedExpense },
      { type: "unexpense", id: randomUUID(), shiftId: shift.id, targetId: voidedExpense.id },
    ]);
    assert.equal(spent.bookings?.find((b) => b.id === bookingId)?.expenses, 5700);
    const businessId = opened.business!.id;
    await getDb().transaction(async (tx) => {
      const receipts = await bookingRecords(tx, businessId, bookingId, "sales");
      assert.equal(receipts.sales.length, 4);
      const records = await bookingRecords(tx, businessId, bookingId, "expenses");
      assert.deepEqual(records.expenses.map((expense) => expense.label).sort(), ["Delivery", "Ice packs"]);
      assert.deepEqual(await bookingRecords(tx, randomUUID(), bookingId, "expenses"), { sales: [], expenses: [] });
    });

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
