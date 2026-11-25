import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  beginClose,
  cacheBusinessRegister,
  cancelClose,
  checkout,
  clearRegister,
  editExpense,
  loadRegister,
  logExpense,
  mergeServer,
  saveCart,
  setAvailability,
} from "../src/lib/register-store";
import { defaultSettings } from "../src/lib/settings";
import type { Bootstrap, CartLine } from "../src/lib/types";

const itemId = crypto.randomUUID();
const cart: CartLine[] = [{ productId: itemId, quantity: 1, optionIds: [] }];

async function start() {
  const key = crypto.randomUUID();
  const { deviceId } = await loadRegister(key);
  const business = {
    id: key,
    name: "Counter",
    timeZone: "UTC",
    currency: "USD",
    settings: defaultSettings("USD"),
  };
  const menu = [
    { id: itemId, name: "Coffee", category: "Drinks", groups: [], price: 325 },
  ];
  const shift = {
    id: crypto.randomUUID(),
    number: 1,
    businessId: key,
    deviceId,
    openedAt: new Date().toISOString(),
    closedAt: null,
    openingCash: 1000,
    menu,
    settings: { ...defaultSettings("USD"), currency: "USD" },
  };
  const data: Bootstrap = {
    business,
    menu,
    shift,
    soldOut: [],
    sales: [],
    shifts: [shift],
  };
  await mergeServer(key, data);
  return { key, data };
}

test("two concurrent checkouts commit one numbered receipt and one pending record", async () => {
  const { key, data } = await start();
  await saveCart(key, cart);
  const attempts = await Promise.allSettled([
    checkout(key, "cash", 500, cart),
    checkout(key, "cash", 500, cart),
  ]);
  assert.equal(
    attempts.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const saved = await loadRegister(key);
  assert.equal(saved.cart.length, 0);
  assert.equal(saved.sales[0].sequence, 1);
  assert.equal(saved.sales[0].change, 175);
  assert.equal(saved.pending.length, 1);
  await assert.rejects(clearRegister(key), /sync/i);
  await saveCart(key, cart);
  const { sale: second } = await checkout(key, "card", 325);
  assert.equal(second.sequence, 2);

  // An acknowledgement for a batch in flight cannot discard a later local sale.
  const acknowledged = { ...data, sales: [saved.sales[0]] };
  await mergeServer(key, acknowledged, [saved.pending[0].id]);
  const refreshed = await mergeServer(key, acknowledged);
  assert.deepEqual(
    refreshed.pending.map((event) => event.id),
    [second.id],
  );
  assert.equal(refreshed.sales.length, 2);
  const done = await mergeServer(
    key,
    { ...data, sales: [second, saved.sales[0]] },
    [second.id],
  );
  assert.equal(done.pending.length, 0);
  assert.deepEqual((await clearRegister(key)).sales, []);
  assert.equal((await loadRegister(key)).deviceId, saved.deviceId);
});

test("failed local writes preserve the cart and sequence number", async () => {
  const { key } = await start();
  await saveCart(key, cart);
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () {
    throw new DOMException("Storage full", "QuotaExceededError");
  };
  try {
    await assert.rejects(checkout(key, "cash", 500));
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  const before = await loadRegister(key);
  assert.deepEqual(before.cart, cart);
  assert.equal(before.pending.length, 0);
  assert.equal(before.sales.length, 0);
  assert.equal((await checkout(key, "cash", 500)).sale.sequence, 1);
});

test("offline registers share the account's latest business list and keep other accounts separate", async () => {
  const { key, data } = await start();
  const first = { id: data.business!.id, name: "Counter", owner: true };
  const second = { id: crypto.randomUUID(), name: "Booth", owner: false };
  const otherKey = key + "@" + second.id;
  const secondSnapshot = { ...data, shift: null, shifts: [], business: { ...data.business!, ...second } };
  await mergeServer(key, { ...data, businesses: [first, second] });
  await cacheBusinessRegister(otherKey, { ...secondSnapshot, businesses: [second] });
  assert.deepEqual((await loadRegister(otherKey)).businesses, [first, second]);
  await mergeServer(otherKey, { ...secondSnapshot, businesses: [second] });
  assert.deepEqual((await loadRegister(key)).businesses, [second]);
  assert.deepEqual((await saveCart(key, cart)).businesses, [second]);
  assert.equal((await loadRegister(crypto.randomUUID() + "@" + second.id)).business, null);
  assert.equal((await loadRegister(crypto.randomUUID())).businesses, undefined);
});

test("stale carts and sold-out items are guarded, and any phone can sell on the open shift", async () => {
  const { key, data } = await start();
  await saveCart(key, cart, []);
  await assert.rejects(saveCart(key, [], []), /cart changed/);
  await setAvailability(key, itemId, true);
  assert.deepEqual((await mergeServer(key, data)).soldOut, [itemId]);
  await assert.rejects(checkout(key, "cash", 325));
  assert.deepEqual((await loadRegister(key)).cart, cart);
  const pending = (await loadRegister(key)).pending;
  // A shift opened on another phone sells here too.
  await mergeServer(
    key,
    { ...data, shift: { ...data.shift!, deviceId: crypto.randomUUID() } },
    pending.map((event) => event.id),
  );
  await saveCart(key, cart);
  assert.deepEqual((await loadRegister(key)).cart, cart);
});

test("work for a shift another phone closed stays queued to sync", async () => {
  const { key, data } = await start();
  await saveCart(key, cart);
  const { sale } = await checkout(key, "cash", 325);
  const closed = { ...data.shift!, closedAt: new Date().toISOString(), countedCash: 1000, difference: 0 };
  const after = await mergeServer(key, { ...data, shift: null, shifts: [closed] });
  assert.deepEqual(after.pending.map((e) => e.id), [sale.id]);
  assert.ok(after.sales.some((s) => s.id === sale.id));
  await assert.rejects(saveCart(key, cart), /Open a shift/);
});

test("a close with an uncertain network outcome still blocks sales after reload", async () => {
  const { key, data } = await start();
  const shift = data.shift!;
  await saveCart(key, cart);
  await assert.rejects(beginClose(key, shift.id), /clear the current order/);
  const { sale } = await checkout(key, "cash", 325);
  await assert.rejects(beginClose(key, shift.id), /sync/i);
  const synced = { ...data, sales: [sale] };
  await mergeServer(key, synced, [sale.id]);
  await beginClose(key, shift.id);
  assert.equal((await loadRegister(key)).closingShiftId, shift.id);
  await assert.rejects(checkout(key, "cash", 325), /closing/i);
  await assert.rejects(saveCart(key, cart), /closing/i);
  await assert.rejects(setAvailability(key, itemId, true), /closing/i);
  await cancelClose(key, "unrelated-shift");
  assert.equal((await mergeServer(key, synced)).closingShiftId, shift.id);
  assert.equal((await mergeServer(key, { ...synced, bookings: [] })).closingShiftId, undefined);
  await mergeServer(key, synced);
  await beginClose(key, shift.id);
  await cancelClose(key, shift.id);
  await saveCart(key, cart);
  await saveCart(key, []);
  await beginClose(key, shift.id);
  const closed = {
    ...shift,
    closedAt: new Date().toISOString(),
    countedCash: 1325,
    difference: 0,
  };
  assert.equal(
    (await mergeServer(key, { ...synced, shift: null, shifts: [closed] }))
      .closingShiftId,
    undefined,
  );
});

test("an offline expense edit survives a refresh and a concurrent removal wins", async () => {
  const { key, data } = await start();
  const logged = await logExpense(key, { label: "Ice", amount: 200, source: "till", by: "Ana" });
  const original = logged.expenses![0];
  const changes = { label: "Ice packs", amount: 350, source: "pocket" as const };
  const edited = await editExpense(key, original.id, changes);
  const expected = { ...original, ...changes };
  assert.deepEqual(edited.expenses, [expected]);

  const snapshot = { ...data, expenses: [original] };
  const refreshed = await mergeServer(key, snapshot, [logged.pending[0].id]);
  assert.deepEqual(refreshed.expenses, [expected]);
  assert.equal(refreshed.pending.length, 1);

  const removed = { ...original, voidedAt: new Date().toISOString() };
  const remote = { ...data, expenses: [removed] };
  assert.deepEqual((await mergeServer(key, remote)).expenses, [removed]);
  assert.deepEqual((await mergeServer(key, remote, [edited.pending[1].id])).pending, []);
  await assert.rejects(editExpense(key, original.id, changes), /no longer on the open shift/);
});
