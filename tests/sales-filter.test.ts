import assert from "node:assert/strict";
import test from "node:test";
import { filterOptions, matchesFilter, saleFacets, shiftFacet, shiftKey } from "../src/lib/sales-filter";
import { shiftName } from "../src/lib/shift-name";
import type { Booking, Sale, Shift } from "../src/lib/types";

const booking = (id: string, event: string, organizer: string): Booking => ({
  id,
  startsAt: "2026-11-20T00:00:00Z",
  endsAt: "2026-11-20T08:00:00Z",
  place: { name: "Legazpi Park" },
  organizer: { id: "o-" + organizer, name: organizer },
  event: { id: "e-" + event, name: event },
  seats: 1,
  staff: [],
  quota: 0,
  incentive: 0,
});
const till = (id: string, bookingId?: string) =>
  ({ id, number: 1, openedAt: "2026-11-20T00:00:00Z", closedAt: null, bookingId }) as Shift;
const sale = (id: string, shiftId: string, items: string[], payment: string) =>
  ({
    id,
    shiftId,
    createdAt: "2026-11-20T01:00:00Z",
    lines: items.map((p) => ({ productId: p, name: p, quantity: 1, unitPrice: 100, optionIds: [], options: [] })),
    subtotal: 100 * items.length,
    total: 100 * items.length,
    payment: { id: payment, name: payment, kind: payment === "cash" ? "cash" : "ewallet" },
  }) as unknown as Sale;

const shifts = new Map([till("t1", "b1"), till("t2", "b2"), till("t3")].map((s) => [s.id, s]));
const bookings = new Map([booking("b1", "Ube Takeover", "Weekend Co"), booking("b2", "Night Bazaar", "Weekend Co")].map((b) => [b.id, b]));
const shiftFacets = new Map([...shifts.values()].map((s) => {
  const facet = shiftFacet(s, shiftName(s, { business: { name: "Sunday Supply", timeZone: "Asia/Manila" }, bookings: [...bookings.values()] }), bookings.get(s.bookingId ?? ""));
  return [facet.value, facet];
}));
const all = [
  sale("s1", "t1", ["matcha"], "cash"),
  sale("s2", "t1", ["matcha", "ube"], "gcash"),
  sale("s3", "t2", ["ube"], "cash"),
  sale("s4", "t3", ["matcha"], "cash"),
].map((s) => ({ sale: s, facets: saleFacets(s, shifts, bookings, shiftFacets) }));
const ids = (filter: Parameters<typeof matchesFilter>[1]) =>
  all.filter((x) => matchesFilter(x.facets, filter)).map((x) => x.sale.id);

test("filters combine: any value within a group, every group across", () => {
  assert.deepEqual(ids({}), ["s1", "s2", "s3", "s4"]);
  assert.deepEqual(ids({ item: ["matcha"] }), ["s1", "s2", "s4"]);
  assert.deepEqual(ids({ item: ["matcha"], shift: ["b1"] }), ["s1", "s2"]);
  assert.deepEqual(ids({ item: ["matcha"], shift: ["b1"], payment: ["gcash"] }), ["s2"]);
  assert.deepEqual(ids({ event: ["e-Ube Takeover", "e-Night Bazaar"] }), ["s1", "s2", "s3"]);
  assert.deepEqual(ids({ organizer: ["o-Weekend Co"], item: ["ube"] }), ["s2", "s3"]);
});

test("a till without a scheduled shift is its own shift", () => {
  assert.equal(shiftKey(shifts.get("t3")!), "till:t3");
  assert.deepEqual(ids({ shift: ["till:t3"] }), ["s4"]);
});

test("option counts follow the other filters, not their own", () => {
  const options = filterOptions(all, { shift: ["b1"], item: ["matcha"] });
  assert.deepEqual(
    options.item.map((o) => [o.value, o.count]),
    [["matcha", 2], ["ube", 1]],
  );
  assert.deepEqual(
    Object.fromEntries(options.shift.map((o) => [o.value, o.count])),
    { b1: 2, b2: 0, "till:t3": 1 },
  );
  assert.deepEqual(
    options.payment.map((o) => [o.value, o.count]),
    [["cash", 1], ["gcash", 1]],
  );
});
