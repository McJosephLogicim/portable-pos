"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  FileText,
  Link2,
  MapPin,
  Minus,
  Plus,
  Trash2,
  Trophy,
  Share2,
  X,
} from "lucide-react";
import type { OwnerAction } from "@/lib/demo";
import { amountText, parseMoney, shiftTotals } from "@/lib/domain";
import { OFFLINE } from "@/lib/reject";
import { scheduleText, scheduledShiftText } from "@/lib/report";
import { shiftKey } from "@/lib/sales-filter";
import { slugId } from "@/lib/settings";
import {
  addDays,
  bookingProfit,
  bookingTitle,
  dayOf,
  daysBetween,
  linkBookingProblem,
  rolesOf,
  seatsOpen,
  shiftRole,
  shiftRoleNames,
  shiftTimes,
  timeOf,
  upcomingBookings,
  weekday,
  type BookingInput,
} from "@/lib/team";
import type {
  Booking,
  BookingRecordKind,
  BookingRecords,
  ExpenseInput,
  Member,
  Organizer,
  Place,
  RegisterState,
  Role,
  Shift,
  ShiftRole,
  StaffSlot,
  Tag,
} from "@/lib/types";
import { SuggestInput } from "./combobox";
import { AddMenu } from "./add-menu";
import { SalesSheet, ShiftSales, shiftReceipts } from "./insights";
import type { ShiftRecordStatus } from "./shift-record-list";
import { ShiftExpensesSheet } from "./expenses";
import { LiquidSegments } from "./liquid-segments";
import type { SalesFocus } from "./sales";
import { LocationPicker, MapPreview, mapsLink } from "./places";
import { DrawerDifference, ShiftList, useBookingExpenses, useBookingSales, useShiftFormats } from "./shift-list";
import { shiftCurrency } from "./receipt";
import { ReportSheet } from "./report";
import { CopyButton } from "./share";
import { Avatar, RolePicker } from "./team";
import { buzz, centerOf, ConfirmSheet, EmptyState, errorText, Explain, formatMoney, Money, MoneyField, progressStyle, Sheet, useCelebrate, usePin } from "./ui";
import styles from "./operations.module.css";

type Act = (input: OwnerAction) => Promise<void>;

export interface ScheduleProps {
  state: RegisterState;
  online: boolean;
  demo: boolean;
  sharedSchedule?: { bookingId: string | null } | null;
  onAction: Act;
  onSaved: (text: string) => void;
  onSales: (focus: SalesFocus) => void;
  onLoadBookingRecords?: (bookingId: string, kind: BookingRecordKind) => Promise<BookingRecords>;
  onEditExpense?: (id: string, input: ExpenseInput) => Promise<void>;
  onUnexpense?: (id: string) => Promise<void>;
}

const weekdayLetters = ["S", "M", "T", "W", "T", "F", "S"];

/** "Sat 22" style, for a plain "YYYY-MM-DD" date. */
function plainDay(day: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
}

/* ---------- calendar ---------- */

function MonthCalendar({
  month,
  selected,
  today,
  marks,
  onMonth,
  onSelect,
}: {
  month: string; // YYYY-MM-01
  selected: string;
  today: string;
  marks: Map<string, { count: number; open: boolean; mine: boolean }>;
  onMonth: (month: string) => void;
  onSelect: (day: string) => void;
}) {
  const first = weekday(month);
  const start = addDays(month, -first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const rows = days[35].slice(0, 7) === month.slice(0, 7) ? 6 : 5;
  const visibleDays = days.slice(0, rows * 7);
  const focusDay = visibleDays.includes(selected) ? selected : month;
  const focused = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    focused.current?.focus({ preventScroll: true });
  }, [focusDay]);
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    onMonth(d.toISOString().slice(0, 10));
  };
  return (
    <div className="card calendar">
      <div className="between cal-head">
        <span className="strong" role="status">{plainDay(month, { month: "long", year: "numeric" })}</span>
        <span className="row gap-4">
          <button type="button" className="round flat" aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft size={19} />
          </button>
          <button type="button" className="round flat" aria-label="Next month" onClick={() => shift(1)}>
            <ChevronRight size={19} />
          </button>
        </span>
      </div>
      <div className="cal-grid" role="group" aria-label="Shifts by day">
        {weekdayLetters.map((d, i) => (
          <span key={i} className="cal-dow" aria-hidden="true">
            {d}
          </span>
        ))}
        {visibleDays.map((day) => {
          const mark = marks.get(day);
          const outside = day.slice(0, 7) !== month.slice(0, 7);
          return (
            <button
              key={day}
              type="button"
              ref={day === focusDay ? focused : undefined}
              tabIndex={day === focusDay ? 0 : -1}
              className={
                "cal-day " + styles.calendarDay +
                (outside ? " outside" : "") +
                (day === today ? " today" : "") +
                (mark?.mine ? " mine" : "")
              }
              aria-pressed={day === selected}
              aria-current={day === today ? "date" : undefined}
              aria-label={
                plainDay(day, { weekday: "long", month: "long", day: "numeric" }) +
                (mark ? `, ${mark.count} ${mark.count === 1 ? "shift" : "shifts"}${mark.open ? ", open seats" : ""}` : "")
              }
              onClick={() => onSelect(day)}
              onKeyDown={(event) => {
                const delta = {
                  ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
                  Home: -weekday(day), End: 6 - weekday(day),
                }[event.key];
                if (delta === undefined) return;
                event.preventDefault();
                if (!delta) return;
                moveFocus.current = true;
                onSelect(addDays(day, delta));
              }}
            >
              <span className="cal-num">{Number(day.slice(8))}</span>
              <span className="cal-dots" aria-hidden="true">
                {mark &&
                  Array.from({ length: Math.min(3, mark.count) }, (_, i) => (
                    <i key={i} className={mark.open && i === 0 ? "open" : ""} />
                  ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- people ---------- */

function PersonPicker({
  team,
  myMemberId,
  currency,
  title,
  exclude,
  roleHint,
  onPick,
  onClose,
}: {
  team: Member[];
  myMemberId?: string;
  currency: string;
  title: string;
  exclude: string[];
  roleHint?: ShiftRole;
  onPick: (member: Member, role: ShiftRole) => void;
  onClose: () => void;
}) {
  const [member, setMember] = useState<Member | null>(null);
  const [role, setRole] = useState<Role[]>([]);
  const people = team.filter((m) => !exclude.includes(m.id));
  return (
    <Sheet
      title={member ? member.name : title}
      onClose={onClose}
      footer={
        member && (
          <button className="btn block" aria-label={role.length ? "Add as " + shiftRoleNames[shiftRole(role)].toLowerCase() : "Pick a role"} disabled={!role.length} onClick={() => onPick(member, shiftRole(role))}>
            Add
          </button>
        )
      }
    >
      {member ? (
        <div className="field">
          <span className="field-head">
            Working as
            <Explain title="Working as">Pick both if they run the till and serve.</Explain>
          </span>
          <RolePicker value={role} onChange={setRole} />
        </div>
      ) : people.length ? (
        <div className="card card-list">
          {people.map((m) => (
            <button
              key={m.id}
              type="button"
              className="list-row"
              onClick={() => {
                buzz.tap();
                setMember(m);
                setRole(rolesOf(roleHint ?? "cashier"));
              }}
            >
              <Avatar id={m.id} name={m.name} dim={!m.joined} />
              <span className="grow stack">
                <span className="ellipsis">{m.id === myMemberId ? m.name + " (you)" : m.name}</span>
                <span className="label">
                  {m.rate ? formatMoney(m.rate, currency) + " a shift" : "No set pay"}
                  {m.joined ? "" : " · invite pending"}
                </span>
              </span>
              <ChevronRight size={18} className="chev" />
            </button>
          ))}
        </div>
      ) : (
        <EmptyState pose="team" title="Everyone is already assigned" text="Invite more people in Settings › Team." />
      )}
    </Sheet>
  );
}

const roleNotes: Record<ShiftRole, string> = {
  cashier: "Runs the till: sells, opens and closes it.",
  server: "Serves and preps. Someone else runs the till.",
  both: "Runs the till and serves.",
};

/** Pick what someone does on a shift: cashier, server or both. */
function RoleSheet({
  title,
  start,
  action,
  onSave,
  onClose,
}: {
  title: string;
  start: Role[];
  action: (role: ShiftRole) => string;
  onSave: (role: ShiftRole, from: Element) => void;
  onClose: () => void;
}) {
  const [roles, setRoles] = useState<Role[]>(start);
  const role = shiftRole(roles);
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <button className="btn block" disabled={!roles.length} onClick={(e) => onSave(role, e.currentTarget)}>
          {roles.length ? action(role) : "Pick a role"}
        </button>
      }
    >
      <div className="field">
        <span>Working as</span>
        <RolePicker value={roles} onChange={setRoles} />
      </div>
      <p className="muted">{roles.length ? roleNotes[role] : "Pick cashier, server or both."}</p>
    </Sheet>
  );
}

/* ---------- details ---------- */

function useBookingHistory(
  bookingId: string,
  kind: BookingRecordKind,
  amount: number,
  enabled: boolean,
  online: boolean,
  load: ScheduleProps["onLoadBookingRecords"],
): { records?: BookingRecords; status?: ShiftRecordStatus } {
  const [result, setResult] = useState<{ amount: number; attempt: number; data?: BookingRecords; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{ amount: number; attempt: number; load: typeof load; promise: Promise<BookingRecords> } | null>(null);
  useEffect(() => {
    if (!online) request.current = null;
    if (!enabled || !online || !load) return;
    let current = true;
    if (request.current?.amount !== amount || request.current.attempt !== attempt || request.current.load !== load) {
      request.current = { amount, attempt, load, promise: load(bookingId, kind) };
    }
    request.current.promise.then(
      (data) => { if (current) setResult({ amount, attempt, data }); },
      (failure) => { if (current) setResult({ amount, attempt, error: errorText(failure) }); },
    );
    return () => { current = false; };
  }, [amount, attempt, bookingId, enabled, kind, load, online]);
  if (!enabled || !load) return {};
  const latest = result?.amount === amount && result.attempt === attempt ? result : undefined;
  if (latest?.data) return { records: latest.data };
  if (!online) return { status: { kind: "unavailable", message: "Connect to see the full shift history." } };
  if (latest?.error) return { status: { kind: "unavailable", message: latest.error, retry: () => setAttempt((n) => n + 1) } };
  return { status: { kind: "loading" } };
}

function BookingSheet({
  booking: b,
  props,
  sales,
  expenses,
  till,
  onLinkTill,
  onEdit,
  onClose,
}: {
  booking: Booking;
  props: ScheduleProps;
  sales?: number;
  expenses: number;
  till?: Shift;
  onLinkTill?: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { state, online } = props;
  const business = state.business!;
  const currency = business.currency;
  const me = state.me!;
  const f = useShiftFormats(business.timeZone);
  const withPin = usePin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [breakdown, setBreakdown] = useState<BookingRecordKind | null>(null);
  const [picking, setPicking] = useState<{ replace?: StaffSlot } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [managing, setManaging] = useState<StaffSlot | null>(null);
  const [leaving, setLeaving] = useState<StaffSlot | null>(null);
  const [takingOver, setTakingOver] = useState(false);
  const mine = b.staff.find((s) => s.memberId === me.memberId);
  const open = seatsOpen(b);
  const started = Date.parse(b.startsAt) <= Date.now();
  const over = Date.parse(b.endsAt) <= Date.now();
  const p = me.owner ? bookingProfit({ ...b, sales: sales ?? 0, expenses }) : null;
  const team = state.team ?? [];
  const joinable = !mine && open > 0 && !over;
  const [joining, setJoining] = useState(false);
  const [roleFor, setRoleFor] = useState<StaffSlot | null>(null);
  const celebrate = useCelebrate();
  const [switching, setSwitching] = useState(false);
  const tills = useMemo(
    () => state.shifts.filter((s) => s.bookingId === b.id).map((s) => s.id),
    [state.shifts, b.id],
  );

  // Recent records are already on the register. Fetch uncached history as soon as the shift opens.
  const cachedSales = useMemo(() => shiftReceipts(state, tills), [state, tills]);
  const cachedExpenses = useMemo(
    () => (state.expenses ?? []).filter((entry) => tills.includes(entry.shiftId) && !entry.voidedAt),
    [state.expenses, tills],
  );
  const salesAmount = p?.sales ?? 0;
  const recent = till && (!till.closedAt || state.shifts.filter((s) => s.closedAt && s.number > till.number).length < 30);
  const pendingSales = state.pending.some((event) => event.type === "sale" && tills.includes(event.shiftId));
  const pendingExpenses = state.pending.some((event) =>
    (event.type === "expense" || event.type === "editExpense" || event.type === "unexpense") && tills.includes(event.shiftId));
  const hasHistory = me.owner && Boolean(till || started || salesAmount || expenses);
  const salesHistory = useBookingHistory(
    b.id, "sales", salesAmount,
    hasHistory && !pendingSales &&
      (!recent || (Boolean(till?.closedAt) && salesAmount !== cachedSales.reduce((sum, entry) => sum + entry.total, 0))),
    online, props.onLoadBookingRecords,
  );
  const expenseHistory = useBookingHistory(
    b.id, "expenses", expenses,
    hasHistory && !pendingExpenses && (expenses > 0 || cachedExpenses.length > 0) &&
      (!recent || (Boolean(till?.closedAt) && expenses !== cachedExpenses.reduce((sum, entry) => sum + entry.amount, 0))),
    online, props.onLoadBookingRecords,
  );
  const title = bookingTitle(b);
  const receipts = salesHistory.records
    ? [...salesHistory.records.sales].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : cachedSales;
  const spent = expenseHistory.records?.expenses ?? cachedExpenses;
  const salesStatus = salesHistory.status ?? (props.demo && !receipts.length && salesAmount > 0
    ? { kind: "unavailable" as const, message: "This sample shift only has a sales total." }
    : undefined);
  const editableTillId = state.shift && !state.shift.closedAt && !state.closingShiftId ? state.shift.id : undefined;

  async function run(input: OwnerAction, label: string, owner = true, from?: Element | null) {
    const origin = centerOf(from);
    setBusy(true);
    setError("");
    try {
      const done = owner
        ? await withPin((pin) => props.onAction({ ...input, pin } as OwnerAction))
        : (await props.onAction(input), true);
      if (done) {
        props.onSaved(label);
        if (origin) celebrate(origin);
        else buzz.tick();
      }
      return done;
    } catch (e) {
      setError(errorText(e));
      buzz.error();
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet
        title={bookingTitle(b)}
        onClose={onClose}
        busy={busy}
        action={me.owner && (
          <button type="button" className="btn small secondary" disabled={!online || busy} onClick={onEdit}>
            Edit
          </button>
        )}
        footer={
          onLinkTill ? (
            <button type="button" className="btn block" disabled={!online || busy} aria-haspopup="dialog" onClick={onLinkTill}>
              <Link2 size={17} aria-hidden="true" /> Add till
            </button>
          ) : !me.owner &&
          (mine ? (
            !over && (
              <div className="grid-2">
                <button className="btn block" disabled={!online || busy} onClick={() => setSwitching(true)}>
                  {busy ? "Updating…" : "Change role"}
                </button>
                <button
                  className="btn secondary block"
                  disabled={!online || busy || started}
                  onClick={() => setLeaving(mine)}
                >
                  {started ? "Started" : "Leave"}
                </button>
              </div>
            )
          ) : joinable ? (
            <button className="btn block" disabled={!online || busy} onClick={() => setJoining(true)}>
              {busy ? "Joining…" : "Join this shift"}
            </button>
          ) : null)
        }
      >
        <div className="stack gap-4">
          <p className="strong">{f.long.format(new Date(b.startsAt))}</p>
          <p className="label">
            {f.time.format(new Date(b.startsAt))} to {f.time.format(new Date(b.endsAt))}
            {b.organizer ? " · " + b.organizer.name : ""}
          </p>
        </div>
        {b.place && (
          <div className="card place-card">
            {b.place.lat !== undefined && b.place.lon !== undefined && (
              <MapPreview lat={b.place.lat} lon={b.place.lon} height={140} />
            )}
            <a className="row gap-10 place-meta" href={mapsLink(b.place)} target="_blank" rel="noreferrer">
              <MapPin size={18} strokeWidth={1.8} />
              <span className="grow stack">
                <span className="ellipsis">{b.place.name}</span>
                {b.place.address && <span className="label ellipsis">{b.place.address}</span>}
              </span>
              <span className="label">Directions</span>
            </a>
          </div>
        )}

        <div className="stack gap-10">
          <p className="group-title">
            People · {b.staff.length} of {b.seats}
          </p>
          <div className="card card-list">
            {b.staff.map((s) => {
              const Row = me.owner ? "button" : "div";
              return (
                <Row
                  className="list-row"
                  key={s.memberId}
                  type={me.owner ? "button" : undefined}
                  disabled={me.owner ? !online || busy : undefined}
                  aria-haspopup={me.owner ? "dialog" : undefined}
                  onClick={me.owner ? () => setManaging(s) : undefined}
                >
                  <Avatar id={s.memberId} name={s.name} />
                  <span className="grow stack">
                    <span className="ellipsis">
                      {s.memberId === me.memberId ? s.name + " (you)" : s.name}
                    </span>
                    <span className="label">
                      {shiftRoleNames[s.role]}
                      {s.salary !== undefined ? " · " + formatMoney(s.salary, currency) : ""}
                    </span>
                  </span>
                  {me.owner && <ChevronRight size={18} className="chev" />}
                </Row>
              );
            })}
            {Array.from({ length: open }, (_, i) => (
              <div className="list-row" key={"open" + i}>
                <span className="avatar seat" aria-hidden="true" />
                <span className="grow g">Open seat</span>
                {me.owner && (
                  <button
                    type="button"
                    className="btn small secondary"
                    disabled={!online || busy}
                    onClick={() => setPicking({})}
                  >
                    Assign
                  </button>
                )}
              </div>
            ))}
            {me.owner && !open && (
              <button type="button" className="list-row" aria-label="Add someone" disabled={!online || busy} onClick={() => setPicking({})}>
                <span className="avatar seat" aria-hidden="true">
                  <Plus size={16} />
                </span>
                <span className="grow">Add</span>
              </button>
            )}
          </div>
        </div>

        {b.quota > 0 && (
          <div className="tile">
            <span className="between">
              <span className="field-head">
                Quota
                <Explain title="Quota">
                  <p>The sales this shift aims for.</p>
                  <p>{b.incentive
                    ? <>When sales reach it, everyone on the shift earns <strong>{formatMoney(b.incentive, currency)}</strong> on top of their pay.</>
                    : "No incentive is set, so reaching it doesn't change anyone's pay."}</p>
                  <p>The bar fills as the till sells. Incentives count against the shift's profit.</p>
                </Explain>
              </span>
              {p?.hit && (
                <span className="pill good">
                  <Trophy size={13} /> Hit
                </span>
              )}
            </span>
            <span className="row gap-6">
              <Money value={b.quota} currency={currency} className="tile-num" />
            </span>
            {p && (
              <span className="meter" aria-label={`${Math.min(100, Math.round((p.sales / b.quota) * 100))}% of quota`}>
                <i style={progressStyle(Math.min(100, (p.sales / b.quota) * 100))} />
              </span>
            )}
            <span className="micro">
              {b.incentive
                ? `${formatMoney(b.incentive, currency)} each when sales reach it.`
                : "No incentive set."}
            </span>
          </div>
        )}

        {p && (
          <div className="stack gap-10">
            <p className="group-title title-help">
              {over ? "How it did" : started ? "So far" : "Break-even"}
              <Explain title="Profit for this shift">
                <p>Profit subtracts rent, salaries, earned incentives and logged expenses from net sales. It excludes cost of goods.</p>
                <p>Enter each rent payment once, under scheduled rent or as a logged expense.</p>
              </Explain>
            </p>
            <div className={`card card-list ${styles.profitRows}`}>
              <button type="button" className="list-row" aria-haspopup="dialog" onClick={() => {
                buzz.tap();
                setBreakdown("sales");
              }}>
                <span className="grow">Sales</span>
                <Money value={p.sales} currency={currency} />
                <ChevronRight size={16} className="chev" aria-hidden />
              </button>
              <div className="list-row">
                <span className="grow">Rent</span>
                <Money value={-p.rent} currency={currency} sign />
              </div>
              <div className="list-row">
                <span className="grow">Salaries</span>
                <Money value={-p.salaries} currency={currency} sign />
              </div>
              {p.hit && (
                <div className="list-row">
                  <span className="grow">Incentives · {b.staff.length} people</span>
                  <Money value={-p.incentives} currency={currency} sign />
                </div>
              )}
              <button type="button" className="list-row" aria-haspopup="dialog" onClick={() => {
                buzz.tap();
                setBreakdown("expenses");
              }}>
                <span className="grow">Expenses</span>
                <Money value={-p.expenses} currency={currency} sign />
                <ChevronRight size={16} className="chev" aria-hidden />
              </button>
              <div className="list-row">
                <span className="grow strong">
                  {!started && !p.sales ? "Sales needed to cover costs" : p.net >= 0 ? "Profit" : "Loss"}
                </span>
                {!started && !p.sales ? (
                  <Money value={p.costs} currency={currency} className="strong" />
                ) : (
                  <span className={"row gap-6 strong" + (p.net < 0 ? " danger" : "")}>
                    <span className={"dot " + (p.net >= 0 ? "success" : "danger")} />
                    <Money value={p.net} currency={currency} />
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        <ShiftSales
          state={state}
          shiftIds={tills}
          menu={state.menu}
          currency={currency}
          title={bookingTitle(b)}
          onSales={(productId) => {
            props.onSales({ filter: { shift: [b.id], ...(productId ? { item: [productId] } : {}) } });
          }}
        />

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <ShiftSheetActions
          state={state}
          title={bookingTitle(b)}
          till={till}
          shareText={() => scheduledShiftText(b, business, location.origin)}
          busy={busy}
          onDelete={me.owner ? () => setConfirmDelete(true) : undefined}
          deleteDisabled={!online}
        />
      </Sheet>
      {p && breakdown === "sales" && (
        <SalesSheet
          state={state}
          title="Sales"
          amount={salesHistory.records ? receipts.reduce((total, entry) => total + entry.total, 0) : salesAmount}
          summary={salesStatus ? title : `${receipts.length} ${receipts.length === 1 ? "sale" : "sales"} at ${title}`}
          status={salesStatus}
          sales={receipts}
          currency={currency}
          onClose={() => setBreakdown(null)}
          onSales={cachedSales.length && !salesStatus && !salesHistory.records ? () => props.onSales({ filter: { shift: [b.id] } }) : undefined}
        />
      )}
      {p && breakdown === "expenses" && (
        <ShiftExpensesSheet
          title={title}
          expenses={spent}
          total={expenseHistory.records ? spent.reduce((total, entry) => total + entry.amount, 0) : expenses}
          currency={currency}
          timeZone={business.timeZone}
          status={expenseHistory.status}
          editableTillId={editableTillId}
          onEdit={props.onEditExpense}
          onRemove={props.onUnexpense}
          onClose={() => setBreakdown(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmSheet
          title="Delete shift?"
          detail={`${bookingTitle(b)} on ${f.day.format(new Date(b.startsAt))} at ${f.time.format(new Date(b.startsAt))} will be removed from everyone's schedule. You can undo the deletion from the toast.`}
          confirmLabel="Delete"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            const done = await withPin((pin) => props.onAction({ action: "deleteBooking", bookingId: b.id, pin }));
            if (done) {
              buzz.tick();
              onClose();
            }
            return done;
          }}
        />
      )}
      {managing && (
        <Sheet
          title={managing.name}
          onClose={() => setManaging(null)}
          footer={
            <>
              {managing.memberId !== me.memberId && (
                <button
                  className="btn block"
                  onClick={() => setTakingOver(true)}
                >
                  Take over this shift
                </button>
              )}
              <button
                className="btn secondary block"
                onClick={() => {
                  setRoleFor(managing);
                  setManaging(null);
                }}
              >
                Change role
              </button>
              <button
                className="btn secondary block"
                onClick={() => {
                  setPicking({ replace: managing });
                  setManaging(null);
                }}
              >
                Give it to someone else
              </button>
              <button
                className="btn ghost danger compact block"
                onClick={() => setLeaving(managing)}
              >
                {managing.memberId === me.memberId ? "Leave" : "Remove"}
              </button>
            </>
          }
        >
          <p className="label">
            {shiftRoleNames[managing.role]}
            {managing.salary !== undefined ? " · " + formatMoney(managing.salary, currency) + " for this shift" : ""}.{" "}
            {managing.memberId !== me.memberId
              ? "Taking over puts you in their seat, at your own pay."
              : ""}
          </p>
        </Sheet>
      )}
      {takingOver && managing && (
        <ConfirmSheet
          title="Take over this shift?"
          detail={`You’ll take ${managing.name}’s seat at your own pay.`}
          confirmLabel="Take over"
          onClose={() => setTakingOver(false)}
          onConfirm={async () => {
            const done = await withPin((pin) => props.onAction({
              action: "assign",
              bookingId: b.id,
              memberId: me.memberId,
              role: managing.role,
              replace: managing.memberId,
              pin,
            }));
            if (done) {
              props.onSaved("You took over from " + managing.name);
              setManaging(null);
            }
            return done;
          }}
        />
      )}
      {leaving && (
        <ConfirmSheet
          title={leaving.memberId === me.memberId ? "Leave this shift?" : "Remove from shift?"}
          detail={leaving.memberId === me.memberId
            ? "Your seat will open up for someone else."
            : `${leaving.name}'s seat will open up for someone else.`}
          confirmLabel={leaving.memberId === me.memberId ? "Leave" : "Remove"}
          onClose={() => setLeaving(null)}
          onConfirm={async () => {
            const mine = leaving.memberId === me.memberId;
            const action = { action: "leave" as const, bookingId: b.id, memberId: leaving.memberId };
            const done = me.owner
              ? await withPin((pin) => props.onAction({ ...action, pin }))
              : (await props.onAction(action), true);
            if (done) {
              props.onSaved(mine ? "You left the shift" : leaving.name + " is off the shift");
              setManaging(null);
            }
            return done;
          }}
        />
      )}
      {switching && mine && (
        <RoleSheet
          title="Your role"
          start={rolesOf(mine.role)}
          onClose={() => setSwitching(false)}
          action={(r) => (r === mine.role ? "Keep " + shiftRoleNames[r].toLowerCase() : "Switch to " + shiftRoleNames[r].toLowerCase())}
          onSave={(role, from) => {
            setSwitching(false);
            if (role === mine.role) return;
            void run({ action: "role", bookingId: b.id, memberId: me.memberId, role }, "You're " + shiftRoleNames[role].toLowerCase() + " on this shift", false, from);
          }}
        />
      )}
      {joining && (
        <RoleSheet
          title="Join this shift"
          start={me.roles.length ? me.roles : ["cashier"]}
          onClose={() => setJoining(false)}
          action={(r) => "Join as " + shiftRoleNames[r].toLowerCase()}
          onSave={(role, from) => {
            setJoining(false);
            void run({ action: "join", bookingId: b.id, role }, "You're on the shift", false, from);
          }}
        />
      )}
      {roleFor && (
        <RoleSheet
          title={roleFor.name}
          start={rolesOf(roleFor.role)}
          onClose={() => setRoleFor(null)}
          action={(r) => "Make " + shiftRoleNames[r].toLowerCase()}
          onSave={(role) => {
            const s = roleFor;
            setRoleFor(null);
            if (role === s.role) return;
            void run({ action: "role", bookingId: b.id, memberId: s.memberId, role }, `${s.name} is now ${shiftRoleNames[role].toLowerCase()}`);
          }}
        />
      )}
      {picking && (
        <PersonPicker
          team={team}
          myMemberId={me.memberId}
          currency={state.business!.currency}
          title={picking.replace ? "Swap " + picking.replace.name + " for" : "Assign someone"}
          exclude={b.staff.map((s) => s.memberId)}
          roleHint={picking.replace?.role}
          onClose={() => setPicking(null)}
          onPick={async (m, role) => {
            setPicking(null);
            await run(
              { action: "assign", bookingId: b.id, memberId: m.id, role, replace: picking.replace?.memberId },
              picking.replace ? `${m.name} replaces ${picking.replace.name}` : `${m.name} is on the shift`,
            );
          }}
        />
      )}
    </>
  );
}

/* ---------- create and edit ---------- */

interface Draft {
  day: string;
  until: string;
  weekdays: number[];
  start: string;
  end: string;
  place: Place | null;
  /** Typed or picked. A name that isn't on the list yet is added when the shift saves. */
  organizer: string;
  event: string;
  seats: number;
  staff: { memberId: string; name: string; role: ShiftRole; salary: string }[];
  rent: string;
  quota: string;
  incentive: string;
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * Turns the typed organizer and event into tags. Names already on the list are reused;
 * new ones are added to it.
 */
function resolveOrganizer(list: Organizer[], d: Pick<Draft, "organizer" | "event">, booking?: Booking) {
  let organizers = list;
  const ids = () => organizers.flatMap((o) => [o.id, ...o.events.map((e) => e.id)]);
  const name = d.organizer.trim().slice(0, 80);
  const eventName = d.event.trim().slice(0, 80);
  if (!name) {
    if (eventName) throw Error("Type the organizer of " + eventName + " too.");
    return { organizers, organizer: null, event: null };
  }
  let found = organizers.find((o) => same(o.name, name));
  // A shift keeps an organizer that was since removed from the list, unless it's retyped.
  if (!found && booking?.organizer && same(booking.organizer.name, name)) {
    const keepEvent = booking.event && same(booking.event.name, eventName) ? booking.event : null;
    if (keepEvent || !eventName) return { organizers, organizer: booking.organizer, event: keepEvent };
  }
  if (!found) {
    found = { id: slugId(name, ids()), name, events: [] };
    organizers = [...organizers, found];
  }
  const organizer: Tag = { id: found.id, name: found.name };
  if (!eventName) return { organizers, organizer, event: null };
  let event = found.events.find((e) => same(e.name, eventName));
  if (!event) {
    event = { id: slugId(eventName, ids()), name: eventName };
    const added = { ...found, events: [...found.events, event] };
    organizers = organizers.map((o) => (o.id === found!.id ? added : o));
  }
  return { organizers, organizer, event: { id: event.id, name: event.name } };
}

export function BookingEditor({
  booking,
  bulk = false,
  props,
  defaultDay,
  onClose,
}: {
  booking?: Booking;
  bulk?: boolean;
  props: ScheduleProps;
  defaultDay: string;
  onClose: () => void;
}) {
  const { state } = props;
  const business = state.business!;
  const zone = business.timeZone;
  const currency = business.currency;
  const team = state.team ?? [];
  const withPin = usePin();
  const organizers = state.organizers ?? [];
  const money = (v?: number) => (v ? amountText(v, currency).replace(/\.0+$/, "") : "");
  const [d, setD] = useState<Draft>(() => {
    const last = [...(state.bookings ?? [])].sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
    const base = booking ?? last;
    return {
      day: booking ? dayOf(booking.startsAt, zone) : defaultDay,
      until: addDays(defaultDay, 6),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      start: base ? timeOf(base.startsAt, zone) : "10:00",
      end: base ? timeOf(base.endsAt, zone) : "20:00",
      place: booking ? booking.place : null,
      organizer: booking?.organizer?.name ?? "",
      event: booking?.event?.name ?? "",
      seats: booking?.seats ?? base?.seats ?? 2,
      staff: (booking?.staff ?? []).map((s) => ({ ...s, salary: money(s.salary) })),
      rent: money(booking?.rent),
      quota: money(booking?.quota),
      incentive: money(booking?.incentive),
    };
  });
  const [locating, setLocating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [staffing, setStaffing] = useState<string | null>(null);
  const celebrate = useCelebrate();
  const staffed = d.staff.find((x) => x.memberId === staffing);
  const setStaff = (memberId: string, patch: Partial<Draft["staff"][number]>) =>
    setD((x) => ({ ...x, staff: x.staff.map((y) => (y.memberId === memberId ? { ...y, ...patch } : y)) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const organizer = organizers.find((o) => same(o.name, d.organizer));
  const days = bulk ? daysBetween(d.day, d.until, d.weekdays) : [d.day];
  const recent = useMemo(() => {
    const seen = new Map<string, Place>();
    for (const b of [...(state.bookings ?? [])].reverse()) if (b.place) seen.set(b.place.name, b.place);
    return [...seen.values()].slice(0, 8);
  }, [state.bookings]);

  function parse(v: string) {
    return v.trim() ? parseMoney(v, currency) : 0;
  }

  async function save(from?: Element) {
    const origin = centerOf(from);
    setBusy(true);
    setError("");
    try {
      const staff = d.staff.map((s) => ({ memberId: s.memberId, name: s.name, role: s.role, salary: parse(s.salary) }));
      if (staff.length > d.seats) throw Error("More people than seats. Add a seat or take someone off.");
      const rent = parse(d.rent);
      const quota = parse(d.quota);
      const incentive = parse(d.incentive);
      if (bulk && !days.length) throw Error("No days match. Check the dates and weekdays.");
      if (bulk && days.length > 120) throw Error("Add up to 120 shifts at a time.");
      const tags = resolveOrganizer(organizers, d, booking);
      const make = (day: string, id: string): BookingInput => ({
        id,
        ...shiftTimes(day, d.start, d.end, zone),
        place: d.place,
        organizer: tags.organizer,
        event: tags.event,
        seats: d.seats,
        staff,
        rent,
        quota,
        incentive,
      });
      const done = await withPin(async (pin) => {
        if (tags.organizers !== organizers) await props.onAction({ action: "organizers", organizers: tags.organizers, pin });
        if (bulk)
          await props.onAction({
            action: "bulkBookings",
            bookings: days.map((day) => make(day, crypto.randomUUID())),
            pin,
          });
        else await props.onAction({ action: "booking", booking: make(d.day, booking?.id ?? crypto.randomUUID()), pin });
      });
      if (done) {
        props.onSaved(bulk ? `Added ${days.length} shifts` : booking ? "Shift saved" : "Shift added");
        if (!booking && origin) celebrate(origin);
        else buzz.tick();
        onClose();
      }
    } catch (e) {
      setError(errorText(e));
      buzz.error();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Sheet
        title={bulk ? "Add many shifts" : booking ? "Edit shift" : "New shift"}
        onClose={onClose}
        busy={busy}
        footer={
          <button
            className="btn block"
            aria-label={bulk ? `Add ${days.length} ${days.length === 1 ? "shift" : "shifts"}` : booking ? "Save shift" : "Add shift"}
            disabled={busy || !props.online || !days.length}
            onClick={(e) => void save(e.detail > 0 ? e.currentTarget : undefined)}
          >
            {busy ? "Saving…" : booking ? "Save" : "Add"}
          </button>
        }
      >
        <div className="card card-pad stack gap-14">
          <div className="field">
            <span>Organizer</span>
            <SuggestInput
              label="Organizer"
              placeholder="Who runs the market"
              maxLength={80}
              value={d.organizer}
              newText="New organizer"
              suggestions={organizers.map((o) => ({
                key: o.id,
                name: o.name,
                detail: o.events.length ? o.events.map((e) => e.name).join(", ") : undefined,
              }))}
              onChange={(organizer) => set({ organizer })}
            />
          </div>
          <div className="field">
            <span className="field-head">
              Event
              <Explain title="Organizers and events">
                New names are added to your list when you save. Rename or remove them in Settings.
              </Explain>
            </span>
            <SuggestInput
              label="Event"
              placeholder="e.g. Christmas Bazaar"
              maxLength={80}
              value={d.event}
              newText="New event"
              suggestions={(organizer?.events ?? []).map((e) => ({ key: e.id, name: e.name }))}
              onChange={(event) => set({ event })}
            />
          </div>
          <div className="field">
            <span>Location</span>
            <div className={styles.locationRow}>
              <button type="button" className="input place-button" aria-haspopup="dialog" onClick={() => setLocating(true)}>
                <MapPin size={18} strokeWidth={1.8} />
                <span className={"grow ellipsis" + (d.place ? "" : " g")}>
                  {d.place ? d.place.name : "Search a venue or address"}
                </span>
              </button>
              {d.place && (
                <button
                  type="button"
                  className="round flat"
                  aria-label="Clear location"
                  onClick={() => set({ place: null })}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            {d.place?.address && <p className="label">{d.place.address}</p>}
          </div>
        </div>

        <div className="card card-pad stack gap-14">
          {bulk ? (
            <>
              <div className="grid-2 dates">
                <label className="field">
                  <span>From</span>
                  <input className="input" type="date" value={d.day} onChange={(e) => e.target.value && set({ day: e.target.value })} />
                </label>
                <label className="field">
                  <span>Until</span>
                  <input
                    className="input"
                    type="date"
                    value={d.until}
                    min={d.day}
                    onChange={(e) => e.target.value && set({ until: e.target.value })}
                  />
                </label>
              </div>
              <div className="field">
                <span>On these days</span>
                <div className="weekdays" role="group" aria-label="Weekdays">
                  {weekdayLetters.map((w, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={d.weekdays.includes(i)}
                      aria-label={plainDay(addDays("2026-11-01", i), { weekday: "long" })}
                      onClick={() =>
                        set({
                          weekdays: d.weekdays.includes(i) ? d.weekdays.filter((x) => x !== i) : [...d.weekdays, i],
                        })
                      }
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <label className="field">
              <span>Date</span>
              <input className="input" type="date" value={d.day} onChange={(e) => e.target.value && set({ day: e.target.value })} />
            </label>
          )}
          <div className="grid-2 time-pair">
            <label className="field">
              <span>Starts</span>
              <input className="input" type="time" value={d.start} onChange={(e) => e.target.value && set({ start: e.target.value })} />
            </label>
            <label className="field">
              <span>Ends</span>
              <input className="input" type="time" value={d.end} onChange={(e) => e.target.value && set({ end: e.target.value })} />
            </label>
          </div>
          {d.end <= d.start && <p className="label">Ends the next morning.</p>}
          {bulk && (
            <p className="label">
              {days.length
                ? `${days.length} ${days.length === 1 ? "shift" : "shifts"}: ${plainDay(days[0], { weekday: "short", month: "short", day: "numeric" })}${
                    days.length > 1
                      ? " to " + plainDay(days[days.length - 1], { weekday: "short", month: "short", day: "numeric" })
                      : ""
                  }`
                : "No days match."}
            </p>
          )}
        </div>

        <div className="stack gap-10">
          <p className="group-title">People</p>
          <div className="card card-list">
            <div className="list-row">
              <span className="grow stack">
                <span>People needed</span>
                <span className="label">Open seats show up for the team to join.</span>
              </span>
              <div className="stepper" role="group" aria-label="People needed">
                <button
                  type="button"
                  aria-label="One fewer"
                  disabled={d.seats <= Math.max(1, d.staff.length)}
                  onClick={() => set({ seats: d.seats - 1 })}
                >
                  <Minus size={16} />
                </button>
                <span aria-live="polite">{d.seats}</span>
                <button type="button" aria-label="One more" disabled={d.seats >= 50} onClick={() => set({ seats: d.seats + 1 })}>
                  <Plus size={16} />
                </button>
              </div>
            </div>
            {d.staff.map((s) => (
              <button type="button" className="list-row" key={s.memberId} onClick={() => setStaffing(s.memberId)}>
                <Avatar id={s.memberId} name={s.name} />
                <span className="grow stack">
                  <span className="ellipsis">{s.name}</span>
                  <span className="label ellipsis">
                    {shiftRoleNames[s.role]} · {s.salary.trim() ? formatMoney(parse(s.salary), currency) : "No pay set"}
                  </span>
                </span>
                <ChevronRight size={18} className="chev" />
              </button>
            ))}
            <button type="button" className="list-row" onClick={() => setAdding(true)}>
              <span className="avatar seat" aria-hidden="true">
                <Plus size={16} />
              </span>
              <span className="grow">{bulk ? "Put someone on every shift" : "Assign someone"}</span>
            </button>
          </div>
        </div>

        <div className="stack gap-10">
          <p className="group-title">Money</p>
          <div className="card card-pad stack gap-14">
            <MoneyField label={bulk ? "Rent for each shift" : "Rent or booth fee"} value={d.rent} onChange={(v) => set({ rent: v })} currency={currency} />
            <div className="grid-2">
              <MoneyField
                label="Sales quota"
                value={d.quota}
                onChange={(v) => set({ quota: v })}
                currency={currency}
                help={{
                  title: "Sales quota",
                  body: (
                    <>
                      <p>The sales this shift aims for. Leave it at 0 for no quota.</p>
                      <p>The shift shows a bar that fills as the till sells, so the team can see how close they are.</p>
                    </>
                  ),
                }}
              />
              <MoneyField
                label="Incentive"
                value={d.incentive}
                onChange={(v) => set({ incentive: v })}
                currency={currency}
                help={{
                  title: "Incentive",
                  body: (
                    <>
                      <p>A bonus each person on the shift earns when sales reach the quota, on top of their pay.</p>
                      <p>With 2 people and {formatMoney(currency === "PHP" ? 10000 : 1000, currency)} each, the shift pays {formatMoney(currency === "PHP" ? 20000 : 2000, currency)} in incentives.</p>
                      <p>Profit is net sales minus rent, salaries, incentives and logged expenses.</p>
                    </>
                  ),
                }}
              />
            </div>
          </div>
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
      </Sheet>
      {locating && (
        <LocationPicker
          recent={recent}
          timeZone={zone}
          onClose={() => setLocating(false)}
          onPick={(place) => {
            set({ place });
            setLocating(false);
          }}
        />
      )}
      {staffed && (
        <Sheet
          title={staffed.name}
          onClose={() => setStaffing(null)}
          footer={
            <>
              <button className="btn block" onClick={() => setStaffing(null)}>
                Done
              </button>
              <button
                className="btn ghost danger compact block"
                onClick={() => {
                  setStaffing(null);
                  set({ staff: d.staff.filter((x) => x.memberId !== staffed.memberId) });
                }}
              >
                <X size={16} /> Remove
              </button>
            </>
          }
        >
          <div className="field">
            <span>Working as</span>
            <RolePicker
              value={rolesOf(staffed.role)}
              onChange={(r) => r.length && setStaff(staffed.memberId, { role: shiftRole(r) })}
            />
          </div>
          <MoneyField
            label="Pay for this shift"
            value={staffed.salary}
            onChange={(v) => setStaff(staffed.memberId, { salary: v })}
            currency={currency}
          />
        </Sheet>
      )}
      {adding && (
        <PersonPicker
          team={team}
          myMemberId={state.me?.memberId}
          currency={state.business!.currency}
          title="Assign someone"
          exclude={d.staff.map((s) => s.memberId)}
          onClose={() => setAdding(false)}
          onPick={(m, role) => {
            set({
              staff: [...d.staff, { memberId: m.id, name: m.name, role, salary: money(m.rate) }],
              seats: Math.max(d.seats, d.staff.length + 1),
            });
            setAdding(false);
          }}
        />
      )}
    </>
  );
}

/* ---------- share ---------- */

function ShareShift({ text, onClose }: { text: string; onClose: () => void }) {
  const [error, setError] = useState("");
  return (
    <Sheet title="Share this shift" onClose={onClose} footer={<CopyButton text={text} onError={setError} />}>
      <pre className="schedule-text">{text}</pre>
      {error && <p className="alert" role="alert">{error}</p>}
    </Sheet>
  );
}

function ShiftSheetActions({ state, title, till, shareText, busy, onDelete, deleteDisabled }: {
  state: RegisterState;
  title: string;
  till?: Shift;
  shareText: () => string;
  busy?: boolean;
  onDelete?: () => void;
  deleteDisabled?: boolean;
}) {
  const [action, setAction] = useState<"share" | "report" | null>(null);
  return (
    <>
      <div className="card card-list" role="group" aria-label="Shift actions">
        <button type="button" className="list-row" disabled={busy} aria-haspopup="dialog" onClick={() => {
          buzz.tap();
          setAction("share");
        }}>
          <Share2 size={17} aria-hidden="true" />
          <span className="grow">Share</span>
          <ChevronRight size={16} className="chev" aria-hidden="true" />
        </button>
        <button type="button" className="list-row" disabled={busy} aria-haspopup="dialog" onClick={() => setAction("report")}>
          <FileText size={17} aria-hidden="true" />
          <span className="grow">Report</span>
          <ChevronRight size={16} className="chev" aria-hidden="true" />
        </button>
        {onDelete && (
          <button type="button" className="list-row danger" disabled={busy || deleteDisabled} aria-haspopup="dialog" onClick={onDelete}>
            <Trash2 size={17} aria-hidden="true" /> Delete
          </button>
        )}
      </div>
      {action === "share" && <ShareShift text={shareText()} onClose={() => setAction(null)} />}
      {action === "report" && (till ? (
        <ReportSheet shift={till} state={state} business={state.business!} onDismiss={() => setAction(null)} />
      ) : (
        <Sheet title={`${title} report`} onClose={() => setAction(null)}>
          <EmptyState pose="close" object="checklistClipboard" title="No till report is available for this shift." text="A report appears once a till is linked to the shift." />
        </Sheet>
      ))}
    </>
  );
}

function ShareSchedule({
  bookings,
  businessId,
  zone,
  month,
  onClose,
}: {
  bookings: Booking[];
  businessId: string;
  zone: string;
  month: string;
  onClose: () => void;
}) {
  const [range, setRange] = useState<"upcoming" | "month">("upcoming");
  const [error, setError] = useState("");
  const shown =
    range === "upcoming"
      ? bookings.filter((b) => Date.parse(b.endsAt) > Date.now())
      : bookings.filter((b) => dayOf(b.startsAt, zone).slice(0, 7) === month.slice(0, 7));
  const text = scheduleText(shown, zone, { origin: location.origin, businessId });
  return (
    <Sheet
      title="Share the schedule"
      onClose={onClose}
      footer={shown.length > 0 && <CopyButton text={text} onError={setError} />}
    >
      <LiquidSegments
        label="Which shifts"
        value={range}
        onChange={(value) => {
          setError("");
          setRange(value);
        }}
        options={[
          { value: "upcoming", label: "Upcoming" },
          { value: "month", label: plainDay(month, { month: "long" }) },
        ]}
      />
      {shown.length ? (
        <pre className="schedule-text">{text}</pre>
      ) : (
        <EmptyState pose="plan" object="shiftCalendar" title="No shifts to share" text="Add shifts first, or pick the other range." />
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

function AddShiftMenu({ disabled, onAdd, className }: {
  disabled: boolean;
  onAdd: (mode: "new" | "bulk") => void;
  className?: string;
}) {
  return (
    <AddMenu
      singleLabel="Add a shift"
      onSingle={() => onAdd("new")}
      onBulk={() => onAdd("bulk")}
      blockedReason={disabled && OFFLINE}
      className={className}
      SingleIcon={CalendarPlus}
      BulkIcon={CalendarRange}
    />
  );
}

/* ---------- screen ---------- */

export function TillShiftsSheet({ shiftId, onClose, onSchedule, practice = false, ...props }: ScheduleProps & {
  shiftId: string;
  practice?: boolean;
  onClose: () => void;
  onSchedule: () => void;
}) {
  const { state, online, onAction, onSaved } = props;
  const zone = state.business!.timeZone;
  const now = Date.now();
  const today = dayOf(now, zone);
  const openShifts = practice
    ? upcomingBookings(state, -Infinity)
    : upcomingBookings(state, now).filter((booking) => !linkBookingProblem(booking, zone, now));
  const [selection, setSelection] = useState<{ bookingId: string; confirming?: boolean } | null>(null);
  const [adding, setAdding] = useState<"new" | "bulk" | null>(null);
  const selected = openShifts.find((booking) => booking.id === selection?.bookingId);

  return (
    <>
      <Sheet
        title="Shifts"
        onClose={onClose}
        action={!practice && (
          <button type="button" className="btn secondary compact" onClick={() => {
            onClose();
            onSchedule();
          }}>
            Go to Shifts <ChevronRight size={16} aria-hidden="true" />
          </button>
        )}
      >
        <ShiftList
          entries={openShifts}
          state={state}
          showCalendarObject
          onOpen={(bookingId) => setSelection({ bookingId, confirming: practice })}
          emptyAction={!practice && state.me?.owner ? <AddShiftMenu disabled={!online} onAdd={setAdding} /> : undefined}
        />
      </Sheet>
      {selected && !practice && (
        <ShiftDetailsSheet
          {...props}
          bookingId={selected.id}
          onClose={() => setSelection(null)}
          onLinkTill={() => setSelection({ bookingId: selected.id, confirming: true })}
        />
      )}
      {selected && selection?.confirming && (
        <ConfirmSheet
          title="Add till to this shift?"
          detail={<>This till and its sales will be linked to <strong>{bookingTitle(selected)}</strong>.</>}
          confirmLabel="Add till"
          destructive={false}
          onClose={() => setSelection(practice ? null : { bookingId: selected.id })}
          onConfirm={async () => {
            await onAction({ action: "linkBooking", shiftId, bookingId: selected.id });
            buzz.success();
            onSaved("Till added to shift");
            onClose();
          }}
        />
      )}
      {adding && <BookingEditor props={props} bulk={adding === "bulk"} defaultDay={today} onClose={() => setAdding(null)} />}
    </>
  );
}

export function ShiftDetailsSheet({
  bookingId,
  tillId,
  onClose,
  onLinkTill,
  ...props
}: ScheduleProps & (
  { bookingId: string; tillId?: never; onLinkTill?: () => void } |
  { bookingId?: never; tillId: string; onLinkTill?: never }
) & { onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const { state, demo } = props;
  const salesOf = useBookingSales(state, demo);
  const expensesOf = useBookingExpenses(state);
  const matchesTill = (shift: Shift) => tillId ? shift.id === tillId : shift.bookingId === bookingId;
  const till = state.shift && matchesTill(state.shift) ? state.shift : state.shifts.find(matchesTill);
  const booking = state.bookings?.find((b) => b.id === (bookingId ?? till?.bookingId));
  if (!booking) return till ? <TillDetailsSheet till={till} props={props} onClose={onClose} /> : null;
  return (
    <>
      <BookingSheet
        key={booking.id}
        booking={booking}
        props={props}
        sales={salesOf(booking)}
        expenses={expensesOf(booking)}
        till={till}
        onLinkTill={onLinkTill}
        onEdit={() => setEditing(true)}
        onClose={onClose}
      />
      {editing && (
        <BookingEditor
          booking={booking}
          props={props}
          defaultDay={dayOf(booking.startsAt, state.business!.timeZone)}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

function TillDetailsSheet({ till, props, onClose }: { till: Shift; props: ScheduleProps; onClose: () => void }) {
  const { state, onSales } = props;
  const business = state.business!;
  const { long, time } = useShiftFormats(business.timeZone);
  const title = `Shift ${till.number}`;
  const date = long.format(new Date(till.openedAt));
  const hours = time.format(new Date(till.openedAt)) + (till.closedAt ? ` to ${time.format(new Date(till.closedAt))}` : "");
  const currency = shiftCurrency(till, business);
  const total = shiftTotals(till, state.sales, state.expenses).total;
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="stack gap-4">
        <p className="strong">{date}</p>
        <p className="label">{hours}{till.openedBy ? ` · ${till.openedBy}` : ""}</p>
      </div>
      <div className="card card-list">
        <div className="list-row">
          <span className="grow">Sales</span>
          <Money value={total} currency={currency} />
        </div>
        {till.difference !== undefined && (
          <div className="list-row"><DrawerDifference value={till.difference} currency={currency} /></div>
        )}
      </div>
      <ShiftSales
        state={state}
        shiftIds={[till.id]}
        menu={state.menu}
        currency={currency}
        title={title}
        onSales={(productId) => {
          onSales({ filter: { shift: [shiftKey(till)], ...(productId ? { item: [productId] } : {}) } });
        }}
      />
      <ShiftSheetActions
        state={state}
        title={title}
        till={till}
        shareText={() => [
          `${business.name} — ${title}`,
          `${date} · ${hours}`,
          till.openedBy ? `Opened by ${till.openedBy}` : "",
        ].filter(Boolean).join("\n")}
      />
    </Sheet>
  );
}

type Filter = "day" | "open" | "mine";

export function ScheduleScreen(props: ScheduleProps & { onLeaderboard: () => void }) {
  const { state, demo, sharedSchedule } = props;
  const business = state.business!;
  const zone = business.timeZone;
  const me = state.me;
  const f = useShiftFormats(zone);
  const today = dayOf(Date.now(), zone);
  const [selected, setSelected] = useState(() => {
    const initial = state.bookings?.find((b) => b.id === sharedSchedule?.bookingId);
    return initial ? dayOf(initial.startsAt, zone) : today;
  });
  const [month, setMonth] = useState(selected.slice(0, 8) + "01");
  const [filter, setFilter] = useState<Filter>(sharedSchedule && !sharedSchedule.bookingId ? "open" : "day");
  const [sharing, setSharing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(sharedSchedule?.bookingId ?? null);
  const [editing, setEditing] = useState<"new" | "bulk" | null>(null);
  const bookings = useMemo(
    () => [...(state.bookings ?? [])].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [state.bookings],
  );
  const salesOf = useBookingSales(state, demo);
  const expensesOf = useBookingExpenses(state);

  const marks = useMemo(() => {
    const map = new Map<string, { count: number; open: boolean; mine: boolean }>();
    for (const b of bookings) {
      const day = dayOf(b.startsAt, zone);
      const m = map.get(day) ?? { count: 0, open: false, mine: false };
      m.count++;
      if (seatsOpen(b) > 0 && Date.parse(b.endsAt) > Date.now()) m.open = true;
      if (b.staff.some((s) => s.memberId === me?.memberId)) m.mine = true;
      map.set(day, m);
    }
    return map;
  }, [bookings, zone, me?.memberId]);

  const upcoming = bookings.filter((b) => Date.parse(b.endsAt) > Date.now());
  const openSeats = upcoming.filter((b) => seatsOpen(b) > 0 && !b.staff.some((s) => s.memberId === me?.memberId));
  const mineNext = upcoming.filter((b) => b.staff.some((s) => s.memberId === me?.memberId));
  const list =
    filter === "open" ? openSeats : filter === "mine" ? mineNext : bookings.filter((b) => dayOf(b.startsAt, zone) === selected);

  // Owner summary: what finished shifts this month earned.
  const monthDone = bookings.filter(
    (b) => Date.parse(b.endsAt) < Date.now() && dayOf(b.startsAt, zone).slice(0, 7) === month.slice(0, 7),
  );
  const monthProfit = monthDone.map((b) => bookingProfit({ ...b, sales: salesOf(b) ?? 0, expenses: expensesOf(b) }).net);
  const monthNet = monthProfit.reduce((sum, net) => sum + net, 0);
  const winners = monthProfit.filter((net) => net >= 0).length;
  const next = mineNext[0];
  return (
    <div className="page">
      <div className={`page-top tight ${styles.scheduleHeader}`}>
        <div className="grow page-title">
          <h1 className="headline">Shifts</h1>
          <Explain title="Shifts" label="How shifts work">
            {me?.owner ? (
              <p>Use Add to schedule a shift or a series. The trophy opens the leaderboard.</p>
            ) : (
              <p>Your shifts and who works with you. The trophy opens the leaderboard.</p>
            )}
          </Explain>
        </div>
        <button
          className="round"
          aria-label="Share the schedule"
          aria-haspopup="dialog"
          onClick={() => {
            buzz.tap();
            setSharing(true);
          }}
        >
          <Share2 size={19} />
        </button>
        <button
          className="round"
          aria-label="Leaderboard"
          onClick={(event) => {
            buzz.tap();
            event.currentTarget.focus({ preventScroll: true });
            props.onLeaderboard();
          }}
        >
          <Trophy size={19} />
        </button>
        {me?.owner && (
          <AddShiftMenu
            disabled={!props.online}
            onAdd={setEditing}
            className={`btn add-shift responsive-icon ${styles.addShift}`}
          />
        )}
      </div>

      {me?.owner && monthDone.length > 0 ? (
        <div className="hero stack gap-8">
          <span className="hero-label">
            {plainDay(month, { month: "long" })} so far · {monthDone.length} {monthDone.length === 1 ? "shift" : "shifts"}
          </span>
          <Money value={monthNet} currency={business.currency} className="big-num" sign />
          <span className="hero-label">
            {winners} of {monthDone.length} paid for themselves after rent, salaries, incentives and expenses.
          </span>
        </div>
      ) : next ? (
        <p className="headline small-head">
          Next up: {f.day.format(new Date(next.startsAt))}, {f.time.format(new Date(next.startsAt))}{" "}
          <span className="g">at {next.place?.name ?? bookingTitle(next)}.</span>
        </p>
      ) : null}

      <MonthCalendar
        month={month}
        selected={selected}
        today={today}
        marks={marks}
        onMonth={(nextMonth) => {
          setMonth(nextMonth);
          setSelected(today.startsWith(nextMonth.slice(0, 7)) ? today : nextMonth);
        }}
        onSelect={(day) => {
          setSelected(day);
          setMonth(day.slice(0, 8) + "01");
          setFilter("day");
        }}
      />

      <LiquidSegments
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "day", label: selected === today ? "Today" : plainDay(selected, { weekday: "short", day: "numeric" }) },
          { value: "open", label: openSeats.length ? `Open seats · ${openSeats.length}` : "Open seats" },
          { value: "mine", label: mineNext.length ? `Mine · ${mineNext.length}` : "Mine" },
        ]}
      />
      <ShiftList
        entries={list}
        state={state}
        filter={filter}
        showCalendarObject
        emptyAction={filter !== "open" && openSeats.length > 0 && (
          <button type="button" className="btn compact" onClick={() => setFilter("open")}>See open seats</button>
        )}
        showDates={filter !== "day"}
        salesOf={salesOf}
        onOpen={setOpenId}
      />

      {sharing && (
        <ShareSchedule
          bookings={bookings}
          businessId={business.id}
          zone={zone}
          month={month}
          onClose={() => setSharing(false)}
        />
      )}
      {openId && (
        <ShiftDetailsSheet
          {...props}
          bookingId={openId}
          onClose={() => setOpenId(null)}
        />
      )}
      {editing && (
        <BookingEditor
          bulk={editing === "bulk"}
          props={props}
          defaultDay={selected < today ? today : selected}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
