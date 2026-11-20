import { useMemo } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { shiftTotals } from "@/lib/domain";
import { bookingProfit, bookingTitle, dayOf, salesByBooking, seatsOpen } from "@/lib/team";
import type { Booking, RegisterState, Shift } from "@/lib/types";
import { shiftCurrency } from "./receipt";
import { Avatar } from "./team";
import { EmptyState, formatMoney, Money } from "./ui";
import { blocked, OFFLINE } from "@/lib/reject";

export function useShiftFormats(timeZone: string) {
  return useMemo(
    () => ({
      time: new Intl.DateTimeFormat("en", { timeZone, hour: "numeric", minute: "2-digit" }),
      day: new Intl.DateTimeFormat("en", { timeZone, weekday: "short", month: "short", day: "numeric" }),
      long: new Intl.DateTimeFormat("en", { timeZone, weekday: "long", month: "long", day: "numeric" }),
    }),
    [timeZone],
  );
}

export function useBookingSales(state: RegisterState, demo: boolean) {
  const local = useMemo(() => salesByBooking(state.shifts, state.sales), [state.shifts, state.sales]);
  // Live registers already have the booking total from the server.
  return (booking: Booking) => state.me?.owner
    ? !demo && booking.sales !== undefined ? booking.sales : (booking.sales ?? 0) + (local.get(booking.id) ?? 0)
    : undefined;
}

export function DrawerDifference({ value, currency }: { value: number; currency: string }) {
  if (value === 0) return <span className="row gap-6"><span className="dot success" /> Drawer matches</span>;
  return (
    <span className={"row gap-6" + (value < 0 ? " danger" : "")}>
      <span className={"dot" + (value < 0 ? " danger" : "")} />
      {formatMoney(Math.abs(value), currency)} {value < 0 ? "short" : "over"}
    </span>
  );
}

type ShiftEntry = Booking | Shift;
type ShiftFilter = "day" | "open" | "mine";

function ShiftCard({ entry, booking, till, state, sales, onOpen }: {
  entry: ShiftEntry;
  booking?: Booking;
  till?: Shift;
  state: RegisterState;
  sales?: number;
  onOpen: () => void;
}) {
  const business = state.business!;
  const { time } = useShiftFormats(business.timeZone);
  const scheduled = "startsAt" in entry;
  const title = scheduled ? bookingTitle(entry) : booking ? bookingTitle(booking) : `Shift ${entry.number}`;
  const start = scheduled ? entry.startsAt : entry.openedAt;
  const end = scheduled ? entry.endsAt : entry.closedAt;
  const now = Date.now();
  const closed = till ? Boolean(till.closedAt) : Boolean(end && Date.parse(end) <= now);
  const mine = booking?.staff.some((s) => s.memberId === state.me?.memberId);
  const open = booking ? seatsOpen(booking) : 0;
  const profit = scheduled && closed && sales !== undefined ? bookingProfit({ ...entry, sales }) : null;
  const currency = shiftCurrency(till, business);
  return (
    <article className={"card booking" + (closed ? " past" : "")}>
      <button type="button" className="booking-body" onClick={onOpen} aria-haspopup="dialog">
        <span className="booking-time">
          <span className="strong">{time.format(new Date(start))}</span>
          {end && <span className="label">{time.format(new Date(end))}</span>}
        </span>
        <span className="grow stack gap-4">
          <span className="strong ellipsis">{title}</span>
          {booking && (
            <span className="label ellipsis">
              {[booking.place && booking.event ? booking.place.name : "", booking.organizer?.name].filter(Boolean).join(" · ") || "No location yet"}
            </span>
          )}
          {booking && (
            <span className="row booking-meta gap-6 faces">
              {booking.staff.slice(0, 4).map((s) => <Avatar key={s.memberId} id={s.memberId} name={s.name} small />)}
              {Array.from({ length: Math.min(3, open) }, (_, i) => <span key={i} className="avatar small seat" aria-hidden="true" />)}
              <span className="label">{mine ? "You're on" : open ? `${open} open` : "Full"}</span>
            </span>
          )}
          {!booking && till?.openedBy && <span className="label ellipsis">{till.openedBy}</span>}
          {!scheduled && (
            <span className="row booking-meta gap-8 label">
              <Money value={shiftTotals(entry, state.sales).total} currency={currency} className="strong" />
              {entry.difference !== undefined && <DrawerDifference value={entry.difference} currency={currency} />}
            </span>
          )}
        </span>
        {profit && (
          <span className={"pill" + (profit.net >= 0 ? " good" : " bad")}>
            {profit.net >= 0 ? "+" : "−"}{formatMoney(Math.abs(profit.net), business.currency)}
          </span>
        )}
        {!closed && open > 0 && !mine && <span className="pill">Open</span>}
      </button>
    </article>
  );
}

export function ShiftList({ entries, state, filter = "day", showDates, salesOf, onOpen, onAdd, online }: {
  entries: ShiftEntry[];
  state: RegisterState;
  filter?: ShiftFilter;
  showDates?: boolean;
  salesOf?: (booking: Booking) => number | undefined;
  onOpen: (id: string) => void;
  onAdd?: () => void;
  online?: boolean;
}) {
  const business = state.business!;
  const zone = business.timeZone;
  const { day } = useShiftFormats(zone);
  const bookings = new Map(state.bookings?.map((booking) => [booking.id, booking]));
  const tills = new Map(state.shifts.flatMap((till) => till.bookingId ? [[till.bookingId, till] as const] : []));
  if (state.shift?.bookingId) tills.set(state.shift.bookingId, state.shift);
  const groupDate = (entry: ShiftEntry) => "startsAt" in entry ? entry.startsAt : entry.closedAt ?? entry.openedAt;
  return (
    <>
      <p className="sr-only" role="status">{entries.length} {entries.length === 1 ? "shift" : "shifts"} shown</p>
      <div className="stack gap-10">
        {entries.map((entry, i) => {
          const scheduled = "startsAt" in entry;
          const booking = scheduled ? entry : bookings.get(entry.bookingId ?? "");
          const till = scheduled ? tills.get(entry.id) : entry;
          const date = groupDate(entry);
          return (
            <div className="stack gap-10" key={entry.id}>
              {showDates && (i === 0 || dayOf(groupDate(entries[i - 1]), zone) !== dayOf(date, zone)) && (
                <p className="group-title">{day.format(new Date(date))}</p>
              )}
              <ShiftCard
                entry={entry}
                booking={booking}
                till={till}
                state={state}
                sales={scheduled ? salesOf?.(entry) : undefined}
                onOpen={() => onOpen(entry.id)}
              />
            </div>
          );
        })}
        {!entries.length && (
          <EmptyState
            icon={<CalendarDays size={22} />}
            title={filter === "open" ? "No open seats" : filter === "mine" ? "You're not on any shifts yet" : "Nothing scheduled"}
            text={filter === "day"
              ? state.me?.owner
                ? "Add a shift for this day, or add a run of them for a bazaar."
                : "Pick another day, or check open seats."
              : filter === "mine"
                ? "Open seats are yours to join."
                : "Every upcoming shift is full."}
          >
            {onAdd && (
              <button type="button" className="btn secondary compact" {...blocked(!online && OFFLINE)} onClick={onAdd}>
                <Plus size={16} /> Add
              </button>
            )}
          </EmptyState>
        )}
      </div>
    </>
  );
}
