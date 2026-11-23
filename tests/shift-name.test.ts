import assert from "node:assert/strict";
import test from "node:test";
import { shiftName } from "../src/lib/shift-name";
import type { Booking, Shift } from "../src/lib/types";

const business = { name: "Bettercup", timeZone: "Asia/Manila" };
const christmas = { id: "christmas", name: "Christmas Bazaar" };

function booking(id: string, startsAt: string, event = christmas): Booking {
  return { id, startsAt, endsAt: startsAt, event, place: null, organizer: null, seats: 1, staff: [], quota: 0, incentive: 0 };
}

test("shift numbering follows the start time for each event and local day", () => {
  const first = booking("first", "2026-11-22T23:00:00Z");
  const second = booking("second", "2026-11-23T05:00:00Z");
  const tomorrow = booking("tomorrow", "2026-11-23T16:00:00Z");
  const other = booking("other", "2026-11-23T02:00:00Z", { id: "craft", name: "Craft Fair" });
  const context = { business, bookings: [second, tomorrow, other, first] };

  assert.equal(shiftName(first, context), "Christmas Bazaar • Nov 23 • Shift 1");
  assert.equal(shiftName(second, context), "Christmas Bazaar • Nov 23 • Shift 2");
  assert.equal(shiftName(tomorrow, context), "Christmas Bazaar • Nov 24 • Shift 1");
  assert.equal(shiftName(other, context), "Craft Fair • Nov 23 • Shift 1");
  const till = { bookingId: second.id, number: 42, openedAt: "2026-11-24T03:00:00Z" } as Shift;
  assert.equal(shiftName(till, context), "Christmas Bazaar • Nov 23 • Shift 2");
  assert.equal(shiftName({ ...second, shiftOfDay: 2 }, { business }), "Christmas Bazaar • Nov 23 • Shift 2");
  assert.equal(shiftName({ ...till, bookingId: undefined }, context), "Bettercup • Nov 24 • 11:00 AM");
});
