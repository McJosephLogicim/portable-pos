import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { checkCount, countTotal, denominations } from "../src/lib/cash";
import { checkClosing, checkOpening, makeSale, shiftTotals, stockLeft } from "../src/lib/domain";
import { reportText, scheduleText, shiftReport } from "../src/lib/report";
import { canMake, shiftStock } from "../src/lib/stock";
import type { Booking, Business, Expense, Product, Shift } from "../src/lib/types";
import { runCommand } from "../src/server/register";
import { shiftNow } from "./schedule";

const fmt = (n: number) => "₱" + (n / 100).toLocaleString("en");

const strawberry = { id: "sb", name: "Strawberry pack", unit: "pack" };
const ice = { id: "ice", name: "Ice", unit: "kg" };
const dcc: Product = {
  id: "dcc", name: "DCC", category: "", price: 15000, groups: [],
  uses: [{ stockId: "sb", amount: 1 }, { stockId: "ice", amount: 0.2 }],
};
const sc: Product = { id: "sc", name: "SC", category: "", price: 12000, groups: [], uses: [{ stockId: "ice", amount: 0.25 }] };

function openShift(stock: Record<string, number>): Shift {
  return {
    id: randomUUID(), number: 4, businessId: "b", deviceId: "d",
    openedAt: "2026-11-16T02:00:00.000Z", closedAt: null, openingCash: 17000,
    openingCount: { "500": 20, "1000": 7 },
    menu: [dcc, sc], stock, openedBy: "Eunice",
    settings: {
      currency: "PHP", receiptNote: "", discounts: [], stockItems: [strawberry, ice],
      payments: [
        { id: "cash", name: "Cash", kind: "cash", on: true },
        { id: "gcash", name: "GCash", kind: "wallet", on: true },
      ],
    },
  };
}

test("coins and bills add up and must match the amount sent with them", () => {
  assert.equal(countTotal({ "500": 15, "100": 3 }), 7800);
  assert.deepEqual(checkCount({ "500": 15, "100": 0 }, 7500), { "500": 15 });
  assert.equal(checkCount({ "500": 0 }, 0), undefined);
  assert.throws(() => checkCount({ "500": 15 }, 7000), /add up/);
  const php = denominations("PHP").map((d) => d.value);
  assert.ok(php.includes(500) && php.includes(100000));
  assert.deepEqual(denominations("USD").slice(0, 2).map((d) => d.value), [1, 5]);
});

test("menu items use stock items, sales draw them down, and closing reports the gap", () => {
  const stock = checkOpening([dcc, sc], [strawberry, ice], [], { sb: 28, ice: 5, other: 3 }, []);
  assert.deepEqual(stock, { sb: 28, ice: 5 });
  assert.throws(() => checkOpening([dcc], [strawberry, ice], [], { sb: 1 }, []), /Count the Ice/);
  const shift = openShift(stock);
  const sale = (productId: string, quantity: number, tender = "cash") =>
    makeSale({
      id: randomUUID(), shift, sequence: 1, soldOut: [], tender,
      cart: [{ productId, quantity, optionIds: [] }],
      received: (productId === "dcc" ? 15000 : 12000) * quantity,
      createdAt: "2026-11-16T05:00:00.000Z",
      stock: stockLeft(shift, []),
    });
  const sales = [sale("dcc", 8), sale("sc", 4, "gcash")];
  const left = stockLeft(shift, sales);
  assert.deepEqual(left, { sb: 20, ice: 2.4 });
  // Ice runs out first: 2.4 kg makes 12 more DCC's ice but only 20 packs.
  assert.equal(canMake(shiftStock(shift), left, "dcc"), 12);
  assert.throws(
    () => makeSale({
      id: randomUUID(), shift, sequence: 3, soldOut: [], tender: "cash",
      cart: [{ productId: "sc", quantity: 10, optionIds: [] }],
      received: 120000, createdAt: "2026-11-16T05:00:00.000Z", stock: left,
    }),
    /Only 9 more SC/,
  );

  const expenses: Expense[] = [
    { id: randomUUID(), shiftId: shift.id, createdAt: "2026-11-16T03:00:00.000Z", label: "Rent", amount: 20000, source: "till" },
    { id: randomUUID(), shiftId: shift.id, createdAt: "2026-11-16T04:00:00.000Z", label: "Lalamove", amount: 11000, source: "pocket", by: "Eunice Cruz" },
    { id: randomUUID(), shiftId: shift.id, createdAt: "2026-11-16T04:30:00.000Z", label: "Oops", amount: 999, source: "till", voidedAt: "x" },
  ];
  const totals = shiftTotals(shift, sales, expenses);
  assert.equal(totals.tillExpenses, 20000);
  assert.equal(totals.pocketExpenses, 11000);
  assert.equal(totals.expectedCash, 17000 + 120000 - 20000);

  assert.throws(() => checkClosing(shift, { sb: 19 }), /Count the Ice left/);
  const closed: Shift = {
    ...shift,
    closedAt: "2026-11-16T12:00:00.000Z",
    closingStock: checkClosing(shift, { sb: 19, ice: 2.4 }),
    countedCash: 117500,
    closingCount: { "100000": 1, "10000": 1, "5000": 1, "1000": 2, "500": 1 },
    difference: 500,
  };
  const business: Business = { id: "b", name: "Berry Good", currency: "PHP", timeZone: "Asia/Manila", settings: { receiptNote: "", payments: [], discounts: [] } };
  const report = shiftReport(closed, sales, expenses, business);
  assert.deepEqual(report.sold.map(({ name, quantity }) => ({ name, quantity })), [{ name: "DCC", quantity: 8 }, { name: "SC", quantity: 4 }]);
  assert.equal(report.sold[0].revenue, 120000);
  assert.ok(report.hourly.length >= 1 && report.peak);
  assert.deepEqual(report.stock.map((s) => [s.name, s.start, s.used, s.expected, s.counted]), [
    ["Strawberry pack", 28, 8, 20, 19],
    ["Ice", 5, 2.6, 2.4, 2.4],
  ]);
  assert.deepEqual(report.payBack, [{ name: "Eunice Cruz", amount: 11000 }]);
  const text = reportText(report, fmt);
  for (const part of [
    "Berry Good · Shift 4",
    "Eunice",
    "SALES ₱1,680 (2 sales)",
    "GCash ₱480",
    "Strawberry pack 28 / 8 / 19 packs (-1 vs expected)",
    "Lalamove ₱110 (paid by Eunice Cruz)",
    "= Expected ₱1,170",
    "Cash on hand ₱1,175 (₱5 over)",
    "Pay back Eunice Cruz ₱110",
  ])
    assert.ok(text.includes(part), `missing "${part}" in:\n${text}`);
  assert.ok(!text.includes("Oops"));
});

test("the schedule copies grouped by place and event with a distinct link for each shift", () => {
  const booking = (id: string, day: string, hour: string, names: string[]): Booking => ({
    id, startsAt: `${day}T${hour}:00:00.000Z`, endsAt: `${day}T12:00:00.000Z`,
    place: { name: "SM City Grand Central" }, organizer: null,
    event: { id: "ube", name: "Ube Matcha takeover" }, seats: 2, quota: 0, incentive: 0,
    staff: names.map((name) => ({ memberId: name, name, role: "cashier" as const })),
  });
  const market = booking("market", "2026-11-28", "02", ["Brian Santos", "Aye"]);
  const text = scheduleText(
    [
      booking("nov21-pm", "2026-11-21", "07", ["Aye"]),
      booking("nov20", "2026-11-20", "02", ["Bettercup"]),
      booking("nov21-am", "2026-11-21", "02", []),
      { ...market, place: { name: "SM Manila" }, event: null },
    ],
    "Asia/Manila",
    { origin: "https://pos.example.com", businessId: "team" },
  );
  assert.equal(text, [
    "SM City Grand Central - Ube Matcha takeover",
    "Nov 20 Bettercup - https://pos.example.com/?shifts=team&shift=nov20",
    "Nov 21 10:00 AM - https://pos.example.com/?shifts=team&shift=nov21-am",
    "Nov 21 3:00 PM Aye - https://pos.example.com/?shifts=team&shift=nov21-pm",
    "",
    "SM Manila",
    "Nov 28 Brian, Aye - https://pos.example.com/?shifts=team&shift=market",
  ].join("\n"));
});

test(
  "the server keeps the float's coins, expenses and the closing count",
  {
    skip: !process.env.POS_TEST_DATABASE_URL && "Set POS_TEST_DATABASE_URL to a migrated local test database.",
  },
  async () => {
    process.env.DATABASE_URL = process.env.POS_TEST_DATABASE_URL;
    const owner = randomUUID();
    const deviceId = randomUUID();
    const pin = "4821";
    const cmd = (input: object) => runCommand(owner, input);
    await cmd({ action: "setup", name: "Berry Good", currency: "PHP", timeZone: "Asia/Manila", pin });
    const boot = await cmd({ action: "bootstrap" });
    await cmd({
      action: "settings", deviceId, pin, name: "Berry Good", currency: "PHP", timeZone: "Asia/Manila",
      settings: { ...boot.business!.settings, stockItems: [strawberry, ice] },
    });
    await cmd({ action: "menu", menu: [dcc, sc], pin });
    const bookingId = await shiftNow(cmd, pin);
    await assert.rejects(
      cmd({ action: "open", deviceId, bookingId, openingCash: 17000, openingCount: { "500": 30 }, stock: { sb: 28, ice: 5 } }),
      /add up/,
    );
    await assert.rejects(cmd({ action: "open", deviceId, bookingId, openingCash: 17000, stock: { sb: 28 } }), /Count the Ice/);
    const opened = await cmd({
      action: "open", deviceId, bookingId, openingCash: 17000, openingCount: { "500": 20, "1000": 7 }, stock: { sb: 28, ice: 5 },
    });
    const shift = opened.shift!;
    assert.deepEqual(shift.openingCount, { "500": 20, "1000": 7 });
    assert.deepEqual(shift.stock, { sb: 28, ice: 5 });
    assert.ok(shift.openedBy);

    const sale = makeSale({
      id: randomUUID(), shift, sequence: 1, soldOut: [], tender: "cash",
      cart: [{ productId: "dcc", quantity: 2, optionIds: [] }], received: 30000,
      createdAt: new Date().toISOString(),
    });
    const rent: Expense = { id: randomUUID(), shiftId: shift.id, createdAt: new Date().toISOString(), label: "Rent", amount: 20000, source: "till" };
    const ride: Expense = { id: randomUUID(), shiftId: shift.id, createdAt: new Date().toISOString(), label: "Lalamove", amount: 11000, source: "pocket", by: "Eunice" };
    const events = [
      { id: sale.id, shiftId: shift.id, type: "sale", sale },
      { id: rent.id, shiftId: shift.id, type: "expense", expense: rent },
      { id: ride.id, shiftId: shift.id, type: "expense", expense: ride },
      { id: randomUUID(), shiftId: shift.id, type: "unexpense", targetId: ride.id },
    ];
    await cmd({ action: "sync", deviceId, events });
    const synced = await cmd({ action: "sync", deviceId, events });
    assert.equal(synced.expenses!.length, 2);
    assert.ok(synced.expenses!.find((e) => e.id === ride.id)!.voidedAt);

    await assert.rejects(
      cmd({ action: "close", deviceId, shiftId: shift.id, countedCash: 27000, closingStock: { sb: 26 }, pin }),
      /Count the Ice left/,
    );
    const closed = await cmd({
      action: "close", deviceId, shiftId: shift.id, pin,
      countedCash: 27000, closingCount: { "10000": 2, "5000": 1, "1000": 2 },
      closingStock: { sb: 26, ice: 4.5 },
    });
    const done = closed.shifts.find((s) => s.id === shift.id)!;
    // 170 float + 300 cash sales − 200 rent from the till. The pocket ride was taken back.
    assert.equal(done.difference, 27000 - 27000);
    assert.deepEqual(done.closingStock, { sb: 26, ice: 4.5 });
    assert.deepEqual(done.usedStock, { sb: 2, ice: 0.4 });
    assert.deepEqual(done.closingCount, { "10000": 2, "5000": 1, "1000": 2 });
    // The closed shift drops its menu but keeps the names its report needs.
    assert.deepEqual(done.menu, []);
    assert.deepEqual(done.settings.stockItems?.map((i) => i.name), ["Strawberry pack", "Ice"]);
  },
);

test(
  "shifts start on their schedule, one at a time",
  {
    skip: !process.env.POS_TEST_DATABASE_URL && "Set POS_TEST_DATABASE_URL to a migrated local test database.",
  },
  async () => {
    process.env.DATABASE_URL = process.env.POS_TEST_DATABASE_URL;
    const owner = randomUUID();
    const deviceId = randomUUID();
    const pin = "4821";
    const cmd = (input: object) => runCommand(owner, input);
    await cmd({ action: "setup", name: "On time", currency: "PHP", timeZone: "Asia/Manila", pin });
    await cmd({ action: "menu", menu: [{ id: "tea", name: "Tea", category: "", price: 100, groups: [] }], pin });
    const open = (bookingId?: string) => cmd({ action: "open", deviceId, openingCash: 0, bookingId });
    // No shift on the schedule, no till.
    await assert.rejects(cmd({ action: "open", deviceId, openingCash: 0, newShift: { hours: 6 } }), /scheduled shift/);
    const at = (startHours: number, endHours: number) => {
      const id = randomUUID();
      return cmd({
        action: "booking",
        pin,
        booking: {
          id, startsAt: new Date(Date.now() + startHours * 3600000).toISOString(),
          endsAt: new Date(Date.now() + endHours * 3600000).toISOString(),
          place: null, organizer: null, event: null, seats: 1, staff: [], rent: 0, quota: 0, incentive: 0,
        },
      }).then(() => id);
    };
    await assert.rejects(open(await at(2, 6)), /opens from/);
    await assert.rejects(open(await at(-8, -1)), /already ended/);
    // Half an hour early is fine.
    const soon = await at(0.4, 5);
    const first = await open(soon);
    assert.equal(first.shift!.bookingId, soon);
    // A second start while one runs joins it instead of opening another.
    const second = await open(await at(-1, 3));
    assert.equal(second.shift!.id, first.shift!.id);
  },
);
