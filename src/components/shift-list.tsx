import { useMemo, type ReactNode } from "react";
import { shiftTotals } from "@/lib/domain";
import { bookingProfit, bookingTitle, dayOf, salesByBooking, seatsOpen } from "@/lib/team";
import type { Booking, RegisterState, Shift } from "@/lib/types";
import { shiftCurrency } from "./receipt";
import { Avatar } from "./team";
import { EmptyState, formatMoney, Money } from "./ui";

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
  const pendingSales = useMemo(
    () => new Set(state.pending.filter((e) => e.type === "sale").map((e) => e.shiftId)),
    [state.pending],
  );
  const pendingBookings = useMemo(
    () => new Set(state.shifts.filter((shift) => pendingSales.has(shift.id)).map((shift) => shift.bookingId)),
    [state.shifts, pendingSales],
  );
  // Live registers already have the booking total from the server. Local sales include pending receipts.
  return (booking: Booking) => {
    if (!state.me?.owner) return undefined;
    const cached = local.get(booking.id) ?? 0;
    if (demo) return (booking.sales ?? 0) + cached;
    return pendingBookings.has(booking.id) ? cached : booking.sales ?? cached;
  };
}

export function useBookingExpenses(state: RegisterState) {
  const { expenses, shifts, shift, pending } = state;
  const { totals, changed } = useMemo(() => {
    const bookingByTill = new Map(shifts.map((s) => [s.id, s.bookingId]));
    if (shift) bookingByTill.set(shift.id, shift.bookingId);
    const totals = new Map<string, number>();
    for (const expense of expenses ?? []) {
      const bookingId = bookingByTill.get(expense.shiftId);
      if (bookingId && !expense.voidedAt)
        totals.set(bookingId, (totals.get(bookingId) ?? 0) + expense.amount);
    }
    const changed = new Set<string>();
    for (const event of pending) {
      if (event.type !== "expense" && event.type !== "editExpense" && event.type !== "unexpense") continue;
      const bookingId = bookingByTill.get(event.shiftId);
      if (bookingId) changed.add(bookingId);
    }
    return { totals, changed };
  }, [expenses, shifts, shift, pending]);
  return (booking: Booking) => changed.has(booking.id)
    ? totals.get(booking.id) ?? 0
    : booking.expenses ?? totals.get(booking.id) ?? 0;
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

function ShiftCard({ entry, booking, till, state, sales, expenses, onOpen }: {
  entry: ShiftEntry;
  booking?: Booking;
  till?: Shift;
  state: RegisterState;
  sales?: number;
  expenses?: number;
  onOpen: () => void;
}) {
  const business = state.business!;
  const { time } = useShiftFormats(business.timeZone);
  const scheduled = "startsAt" in entry;
  const title = scheduled ? bookingTitle(entry) : booking ? bookingTitle(booking) : `Shift ${entry.number}`;
  const start = scheduled ? entry.startsAt : entry.openedAt;
  const end = scheduled ? entry.endsAt : entry.closedAt;
  const now = Date.now();
  const running = till && !till.closedAt;
  const tillClosed = Boolean(till?.closedAt || booking?.tillClosed);
  const closed = tillClosed || (!till && Boolean(end && Date.parse(end) <= now));
  const mine = booking?.staff.some((s) => s.memberId === state.me?.memberId);
  const open = booking && !tillClosed ? seatsOpen(booking) : 0;
  const profit = scheduled && closed && sales !== undefined ? bookingProfit({ ...entry, sales, expenses }) : null;
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
              <span className="label">{tillClosed ? "Closed" : mine ? "You're on" : open ? `${open} open` : "Full"}</span>
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
        {running && <span className="pill good">Started</span>}
        {!running && !closed && open > 0 && !mine && <span className="pill">Open</span>}
      </button>
    </article>
  );
}

export function ShiftList({ entries, state, filter = "day", showDates, salesOf, onOpen, emptyAction, showCalendarObject }: {
  entries: ShiftEntry[];
  state: RegisterState;
  filter?: ShiftFilter;
  showDates?: boolean;
  salesOf?: (booking: Booking) => number | undefined;
  onOpen: (id: string) => void;
  emptyAction?: ReactNode;
  showCalendarObject?: boolean;
}) {
  const business = state.business!;
  const zone = business.timeZone;
  const { day } = useShiftFormats(zone);
  const expensesOf = useBookingExpenses(state);
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
                expenses={scheduled ? expensesOf(entry) : undefined}
                onOpen={() => onOpen(entry.id)}
              />
            </div>
          );
        })}
        {!entries.length && (
          <EmptyState
            key={filter}
            pose={filter === "open" ? "connect" : filter === "mine" ? "team" : "plan"}
            motion={filter === "day" ? "curiousPeek" : "idle"}
            object={showCalendarObject ? "shiftCalendar" : undefined}
            title={filter === "open" ? "No open seats" : filter === "mine" ? "You're not on any shifts yet" : "Nothing scheduled"}
            text={filter === "day"
              ? state.me?.owner
                ? "Add a shift for this day, or add a run of them for a bazaar."
                : "Pick another day, or check open seats."
              : filter === "mine"
                ? "Shifts you join or are assigned to will show here."
                : "Available seats will show here when there's a shift you can join."}
          >
            {emptyAction}
          </EmptyState>
        )}
      </div>
    </>
  );
}
