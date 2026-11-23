import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { makeSale, mergeLeftovers, shiftLeftovers } from "../src/lib/domain";
import type { Shift, StockItem } from "../src/lib/types";
import { runCommand } from "../src/server/register";
import { shiftNow } from "./schedule";

const milk: StockItem = { id: "milk", name: "Milk", unit: "L", onHand: 10 };
const ice: StockItem = { id: "ice", name: "Ice", unit: "kg", onHand: 4 };

test("leftovers use the closing count, then what the sales left", () => {
  const base = { id: "a", closedAt: "2026-11-20T10:00:00Z" } as Shift;
  assert.deepEqual(shiftLeftovers({ ...base, leftStock: { milk: 3 } }), { milk: 3 });
  // Shifts closed before leftovers were saved.
  assert.deepEqual(shiftLeftovers({ ...base, stock: { milk: 10, ice: 4 }, usedStock: { milk: 2.5 }, closingStock: { ice: 1 } }), { milk: 7.5, ice: 1 });
  const total = mergeLeftovers(
    [{ ...base, leftStock: { milk: 3, ice: 1, gone: 2 } }, { ...base, id: "b", leftStock: { milk: 4.25 } }],
    [milk, ice],
  );
  assert.deepEqual(total, { milk: 7.25, ice: 1 });
});

test(
  "two booths run at once on their own phones, then merge what they had left",
  { skip: !process.env.POS_TEST_DATABASE_URL && "Set POS_TEST_DATABASE_URL to a migrated local test database." },
  async () => {
    process.env.DATABASE_URL = process.env.POS_TEST_DATABASE_URL;
    const owner = randomUUID();
    const phoneA = randomUUID();
    const phoneB = randomUUID();
    const pin = "4826";
    const cmd = (input: object) => runCommand(owner, input);
    const boot = await cmd({ action: "setup", name: "Two booths", currency: "PHP", timeZone: "Asia/Manila", pin });
    await cmd({
      action: "settings", deviceId: phoneA, pin, name: "Two booths", currency: "PHP", timeZone: "Asia/Manila",
      settings: { ...boot.business!.settings, stockItems: [milk, ice] },
    });
    await cmd({
      action: "menu",
      pin,
      menu: [{ id: "latte", name: "Latte", category: "", price: 12000, groups: [], uses: [{ stockId: "milk", amount: 0.25 }] }],
    });
    // Same place, same time: two scheduled shifts, one per booth.
    const boothA = await shiftNow(cmd, pin);
    const boothB = await shiftNow(cmd, pin);

    const a = (await cmd({ action: "open", deviceId: phoneA, till: null, bookingId: boothA, openingCash: 50000 })).shift!;
    const b = (await cmd({ action: "open", deviceId: phoneB, till: null, bookingId: boothB, openingCash: 30000, stock: { milk: 6 } })).shift!;
    assert.notEqual(a.id, b.id);
    assert.equal(b.number, a.number + 1);
    assert.equal(a.stock?.milk, 10);
    assert.equal(b.stock?.milk, 6);

    // One phone runs one shift at a time.
    await assert.rejects(
      cmd({ action: "open", deviceId: phoneA, till: a.id, bookingId: await shiftNow(cmd, pin), openingCash: 0 }),
      /Close the current shift/,
    );
    // Each phone sees its own booth, and the other booth in the list.
    const seenA = await cmd({ action: "bootstrap", deviceId: phoneA, till: a.id });
    const seenB = await cmd({ action: "bootstrap", deviceId: phoneB, till: b.id });
    assert.equal(seenA.shift!.id, a.id);
    assert.equal(seenB.shift!.id, b.id);
    assert.ok(seenA.shifts.some((s) => s.id === b.id && !s.closedAt));
    // A third phone with no booth yet sees neither as its own, and can join one.
    assert.equal((await cmd({ action: "bootstrap", deviceId: randomUUID(), till: null })).shift, null);
    assert.equal((await cmd({ action: "bootstrap", deviceId: randomUUID(), till: b.id })).shift!.id, b.id);

    const sale = (s: Shift, quantity: number) => {
      const made = makeSale({
        id: randomUUID(), shift: s, sequence: 1, cart: [{ productId: "latte", quantity, optionIds: [] }],
        soldOut: [], tender: "cash", received: 12000 * quantity, createdAt: new Date().toISOString(),
      });
      return { type: "sale" as const, id: made.id, shiftId: s.id, sale: made };
    };
    await cmd({ action: "sync", deviceId: phoneA, till: a.id, events: [sale(a, 4)] });
    await cmd({ action: "sync", deviceId: phoneB, till: b.id, events: [sale(b, 2)] });

    // A menu change reaches both booths.
    const menu = [{ id: "latte", name: "Latte", category: "", price: 13000, groups: [], uses: [{ stockId: "milk", amount: 0.25 }] }];
    await cmd({ action: "menu", pin, deviceId: phoneA, till: a.id, menu });
    const both = await cmd({ action: "bootstrap", deviceId: phoneA, till: a.id });
    for (const id of [a.id, b.id]) assert.equal(both.shifts.find((s) => s.id === id)!.menu[0].price, 13000);

    // Closing one booth leaves the other running.
    const closedA = await cmd({ action: "close", deviceId: phoneA, till: a.id, shiftId: a.id, countedCash: 98000, pin });
    assert.equal(closedA.shift, null);
    const stillB = await cmd({ action: "bootstrap", deviceId: phoneB, till: b.id });
    assert.equal(stillB.shift!.id, b.id);
    // Leftovers can't merge while a picked booth is open.
    await assert.rejects(cmd({ action: "mergeStock", shiftIds: [a.id, b.id], pin }), /Close every shift/);
    // Booth B counts its milk at closing: the count wins over what the sales left.
    const closedB = await cmd({ action: "close", deviceId: phoneB, till: b.id, shiftId: b.id, countedCash: 54000, closingStock: { milk: 4 }, pin });
    assert.deepEqual(closedB.shifts.find((s) => s.id === a.id)!.leftStock, { milk: 9, ice: 4 });
    assert.deepEqual(closedB.shifts.find((s) => s.id === b.id)!.leftStock, { milk: 4, ice: 4 });
    // Nothing was written back on closing.
    assert.equal(closedB.business!.settings.stockItems?.find((i) => i.id === "milk")?.onHand, 10);

    const merged = await cmd({ action: "mergeStock", shiftIds: [a.id, b.id], pin });
    const items = merged.business!.settings.stockItems!;
    assert.equal(items.find((i) => i.id === "milk")?.onHand, 13);
    // Nothing used the ice. Both booths started from 4 and kept it.
    assert.equal(items.find((i) => i.id === "ice")?.onHand, 8);
    assert.ok(merged.shifts.filter((s) => s.id === a.id || s.id === b.id).every((s) => s.mergedAt));
    await assert.rejects(cmd({ action: "mergeStock", shiftIds: [a.id], pin }), /already merged/);
  },
);
