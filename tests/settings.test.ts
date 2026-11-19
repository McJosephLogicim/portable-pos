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
const sale = (tender: string, received: number, discountId?: string) =>
  makeSale({
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
  const paid = sale("gcash", 7200, "senior-pwd");
  assert.equal(paid.subtotal, 9000);
  assert.deepEqual(paid.discount, {
    id: "senior-pwd",
    name: "Senior / PWD",
    amount: 1800,
  });
  assert.equal(paid.total, 7200);
  assert.equal(paid.payment.name, "GCash");
  assert.throws(() => sale("gcash", 9000, "senior-pwd"), /exact amount/);
  assert.throws(() => sale("cash", 9000, "staff"), /discount/);
  assert.throws(() => sale("paypal", 9000), /payment method/);
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
