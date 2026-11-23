import type { Booking, Business, Shift } from "./types";

type BookingSlot = Pick<Booking, "id" | "startsAt" | "event" | "place" | "organizer">;

export function bookingShiftNumbers(bookings: readonly BookingSlot[], timeZone: string) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const counts = new Map<string, number>();
  const numbers = new Map<string, number>();
  const ordered = [...bookings].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
  for (const booking of ordered) {
    const group = booking.event ? ["event", booking.event.id]
      : booking.place ? ["place", booking.place.name]
      : booking.organizer ? ["organizer", booking.organizer.id] : [];
    const key = JSON.stringify([day.format(new Date(booking.startsAt)), ...group]);
    const number = (counts.get(key) ?? 0) + 1;
    counts.set(key, number);
    numbers.set(booking.id, number);
  }
  return numbers;
}

export function shiftName(entry: Booking | Shift, { business, bookings = [] }: {
  business: Pick<Business, "name" | "timeZone"> | null;
  bookings?: readonly Booking[];
}) {
  const timeZone = business?.timeZone ?? "UTC";
  const booking = "startsAt" in entry ? entry : bookings.find((b) => b.id === entry.bookingId);
  const start = new Date("startsAt" in entry ? entry.startsAt : booking?.startsAt ?? entry.openedAt);
  const date = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(start);
  const title = booking?.event?.name ?? booking?.place?.name ?? booking?.organizer?.name ?? business?.name ?? "Till";
  const shift = booking
    ? `Shift ${booking.shiftOfDay ?? bookingShiftNumbers(bookings, timeZone).get(booking.id) ?? 1}`
    : new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(start);
  return `${title} • ${date} • ${shift}`;
}
