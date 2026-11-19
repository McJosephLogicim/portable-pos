import assert from "node:assert/strict";
import test from "node:test";
import { makeSale, shiftTotals } from "../src/lib/domain";
import {
  checkSettings,
  defaultSettings,
  discountAmount,
  mergeShiftSettings,
} from "../src/lib/settings";
import type { Shift } from "../src/lib/types";

const settings = defaultSettings("PHP");
const shift: Shift = {
  id: crypto.randomUUID(),
  number: 1,
  businessId: "b",
  deviceId: "d",
  openedAt: new Date().toISOString(),
  closedAt: null,
  openingCash: 100000,
  menu: [{ id: "taho", name: "Taho", category: "", price: 4500, groups: [] }],
  settings: { ...settings, currency: "PHP" },
};
const sale = (tender: string, received: number, discountId?: string, proofs?: string[]) =>
  makeSale({
    proofs,
    id: crypto.randomUUID(),
    shift,
    sequence: 1,
    cart: [{ productId: "taho", optionIds: [], quantity: 2 }],
    soldOut: [],
    tender,
    discountId,
    received,
    createdAt: new Date().toISOString(),
  });

test("Philippine registers start with cash, GCash, Maya, card and Senior / PWD", () => {
  assert.deepEqual(
    settings.payments.map((p) => p.name),
    ["Cash", "GCash", "Maya", "Card"],
  );
  assert.equal(settings.discounts[0].value, 20);
  assert.deepEqual(
    defaultSettings("USD").payments.map((p) => p.id),
    ["cash", "qr", "card"],
  );
});

test("a discount comes off the subtotal and is kept on the receipt", () => {
  // Senior / PWD needs a photo of the ID before it applies.
  assert.throws(() => sale("gcash", 7200, "senior-pwd"), /photo of the Senior \/ PWD ID/);
  const paid = sale("gcash", 7200, "senior-pwd", ["/api/proofs/" + crypto.randomUUID()]);
  assert.equal(paid.proofs!.length, 1);
  assert.equal(paid.subtotal, 9000);
  assert.deepEqual(paid.discount, {
    id: "senior-pwd",
    name: "Senior / PWD",
    amount: 1800,
  });
  assert.equal(paid.total, 7200);
  assert.equal(paid.payment.name, "GCash");
  assert.throws(() => sale("gcash", 9000, "senior-pwd", ["x"]), /exact amount/);
  assert.throws(() => sale("cash", 9000, "staff"), /discount/);
  assert.throws(() => sale("paypal", 9000), /payment method/);
});

test("a method set to need a photo can't complete without one", () => {
  const strict = {
    ...shift,
    settings: {
      ...shift.settings,
      payments: shift.settings.payments.map((p) => (p.id === "gcash" ? { ...p, proof: true } : p)),
    },
  };
  const make = (proofs?: string[]) =>
    makeSale({ id: crypto.randomUUID(), shift: strict, sequence: 1, cart: [{ productId: "taho", optionIds: [], quantity: 2 }], soldOut: [], tender: "gcash", received: 9000, createdAt: new Date().toISOString(), proofs });
  assert.throws(() => make(), /photo of the GCash payment/);
  assert.equal(make(["/api/proofs/" + crypto.randomUUID()]).proofs!.length, 1);
  // Cash with no discount never asks.
  assert.equal(sale("cash", 9000).proofs, undefined);
});

test("fixed discounts never go below zero", () => {
  const fixed = { id: "f", name: "Bundle", type: "fixed" as const, value: 50000, on: true };
  assert.equal(discountAmount(fixed, 9000), 9000);
});

test("drawer cash counts only cash-kind methods", () => {
  const totals = shiftTotals(shift, [sale("cash", 10000), sale("maya", 9000)]);
  assert.equal(totals.expectedCash, 109000);
  assert.equal(totals.total, 18000);
  assert.deepEqual(
    totals.methods.filter((m) => m.count).map((m) => m.name),
    ["Cash", "Maya"],
  );
});

test("removing a method mid-shift keeps it, switched off, for receipts that used it", () => {
  const next = { ...settings, payments: settings.payments.filter((p) => p.id !== "maya") };
  const merged = mergeShiftSettings(shift.settings, next);
  assert.equal(merged.payments.find((p) => p.id === "maya")?.on, false);
  assert.equal(merged.currency, "PHP");
});

test("settings need at least one method and sensible discounts", () => {
  assert.throws(() =>
    checkSettings({
      ...settings,
      payments: settings.payments.map((p) => ({ ...p, on: false })),
    }),
  );
  assert.throws(() =>
    checkSettings({
      ...settings,
      discounts: [{ id: "x", name: "X", type: "percent", value: 120, on: true }],
    }),
  );
});
