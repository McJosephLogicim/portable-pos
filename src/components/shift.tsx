"use client";

import { useState } from "react";
import { CalendarDays, Check, ChevronRight, FileText, Plus, Receipt, Trash2, Wallet } from "lucide-react";
import type { Booking, Business, Expense, RegisterState, Shift, StockItem } from "@/lib/types";
import { parseMoney, shiftTotals, stockLeft } from "@/lib/domain";
import { isSimpleMode } from "@/lib/settings";
import type { Closing, Opening, WalkIn } from "@/lib/demo";
import type { SalesFocus } from "./sales";
import { round, shiftStock, stockModel, unitText } from "@/lib/stock";
import { shiftCurrency } from "./receipt";
import { CashCounter, type CashValue } from "./cash-count";
import { ReportSheet } from "./report";
import { SuggestInput } from "./combobox";
import { RecordEmpty } from "./records";
import { countOf, StockCount } from "./stock-settings";
import { ShiftStrip } from "./sell";
import { ItemsSold, PaymentSales } from "./insights";
import { shiftKey } from "@/lib/sales-filter";
import { OPEN_EARLY, startProblem } from "@/lib/team";
import {
  errorText,
  formatMoney,
  MethodIcon,
  Money,
  MoneyField,
  Sheet,
  buzz,
  centerOf,
  EmptyRow,
  progressStyle,
  useCelebrate,
  useCountUp,
  usePin,
} from "./ui";

export type CloseInput = Omit<Closing, "action" | "pin">;
export type ExpenseInput = { label: string; amount: number; source: Expense["source"] };

/** Where and how long a shift started on the spot runs. */
function WalkInFields({
  state,
  value,
  onChange,
}: {
  state: RegisterState;
  value: WalkIn;
  onChange: (value: WalkIn) => void;
}) {
  const places = [...new Set((state.bookings ?? []).map((b) => b.place?.name).filter(Boolean) as string[])];
  return (
    <div className="card card-pad stack gap-12">
      <div className="field">
        <span>Where</span>
        <SuggestInput
          label="Where"
          value={value.place ?? ""}
          onChange={(place) => onChange({ ...value, place })}
          suggestions={places.map((p) => ({ key: p, name: p }))}
          placeholder="e.g. SM Fairview - Atrium"
          maxLength={120}
        />
      </div>
      <div className="stack gap-8">
        <span className="label">How long</span>
        <div className="quick hours" role="group" aria-label="How long">
          {[4, 6, 8, 10, 12].map((h) => (
            <button key={h} type="button" aria-pressed={value.hours === h} onClick={() => onChange({ ...value, hours: h })}>
              {h}h
            </button>
          ))}
        </div>
      </div>
      <p className="label">It goes on the Shifts page with you on it, so sales and pay add up.</p>
    </div>
  );
}

/** Put a till that opened without a shift onto the Shifts page. */
function LinkSheet({
  state,
  onLink,
  onDismiss,
}: {
  state: RegisterState;
  onLink: (walkIn: WalkIn) => Promise<void>;
  onDismiss: () => void;
}) {
  const [walkIn, setWalkIn] = useState<WalkIn>({ hours: 8 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet
      title="Add this till to Shifts"
      onClose={onDismiss}
      busy={busy}
      footer={
        <button
          className="btn block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onLink(walkIn);
              buzz.success();
              onDismiss();
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Adding…" : "Add shift"}
        </button>
      }
    >
      <p className="muted">It starts when the till opened.</p>
      <WalkInFields state={state} value={walkIn} onChange={setWalkIn} />
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

function Difference({ value, currency }: { value: number; currency: string }) {
  if (value === 0)
    return (
      <span className="row gap-6">
        <span className="dot success" /> Drawer matches
      </span>
    );
  return (
    <span className={"row gap-6" + (value < 0 ? " danger" : "")}>
      <span className={"dot" + (value < 0 ? " danger" : "")} />
      {formatMoney(Math.abs(value), currency)} {value < 0 ? "short" : "over"}
    </span>
  );
}

/** Scheduled shifts that haven't ended, soonest first, with the ones you're on ahead of others at the same time. */
function upcoming(state: RegisterState) {
  const now = Date.now();
  const mine = (b: Booking) => (b.staff.some((s) => s.memberId === state.me?.memberId) ? 0 : 1);
  return (state.bookings ?? [])
    .filter((b) => Date.parse(b.endsAt) > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || mine(a) - mine(b));
}

function BookingRow({ booking: b, zone, note, onClick }: { booking: Booking; zone: string; note?: string; onClick?: () => void }) {
  const time = new Intl.DateTimeFormat("en", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  const day = new Intl.DateTimeFormat("en", { timeZone: zone, weekday: "short", month: "short", day: "numeric" });
  const today = day.format(Date.now()) === day.format(new Date(b.startsAt));
  const body = (
    <>
      <span className="well">
        <CalendarDays size={18} strokeWidth={1.8} />
      </span>
      <span className="grow stack">
        <span className="ellipsis">{bookingTitle(b)}</span>
        <span className="label ellipsis">
          {today ? "" : day.format(new Date(b.startsAt)) + " · "}
          {time.format(new Date(b.startsAt))} to {time.format(new Date(b.endsAt))}
          {b.place && b.event ? " · " + b.place.name : ""}
        </span>
        {note && <span className="label">{note}</span>}
      </span>
      {onClick && <ChevronRight size={18} className="chev" />}
    </>
  );
  return onClick ? (
    <button type="button" className="list-row" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="list-row">{body}</div>
  );
}

/** What Sell and the Till show when no shift is running: the shift you can start now, or the next one. */
function NoShift({
  state,
  onStart,
  onSchedule,
  onGoMenu,
}: {
  state: RegisterState;
  onStart: (bookingId: string) => void;
  onSchedule: () => void;
  onGoMenu?: () => void;
}) {
  const zone = state.business!.timeZone;
  if (!state.menu.length)
    return (
      <div className="stack gap-18">
        <h1 className="headline">
          Add what you sell <span className="g">before the first shift.</span>
        </h1>
        <div className="card card-pad stack gap-12">
          {onGoMenu ? (
            <>
              <p className="muted">A name and a price is enough. Photos and options can come later.</p>
              <button className="btn" onClick={onGoMenu}>Add menu items</button>
            </>
          ) : (
            <p className="muted">Ask the owner to add the first menu item.</p>
          )}
        </div>
      </div>
    );
  const list = upcoming(state);
  const ready = list.filter((b) => !startProblem(b, zone));
  const next = list.find((b) => startProblem(b, zone));
  const time = new Intl.DateTimeFormat("en", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  return (
    <div className="stack gap-18">
      <h1 className="headline">
        No shift running.{" "}
        <span className="g">
          {ready.length
            ? ready.length === 1
              ? "Start it when the stall is set up."
              : "Start the one you're working."
            : next
              ? "The till opens when the next one starts."
              : "Add one on Shifts to open the till."}
        </span>
      </h1>
      {ready.length > 0 && (
        <div className="stack gap-10">
          <p className="group-title">Ready to start</p>
          <div className="card card-list">
            {ready.map((b) => (
              <BookingRow key={b.id} booking={b} zone={zone} onClick={() => onStart(b.id)} />
            ))}
          </div>
        </div>
      )}
      {next && (
        <div className="stack gap-10">
          <p className="group-title">Next shift</p>
          <div className="card card-list">
            <BookingRow
              booking={next}
              zone={zone}
              note={`Till opens from ${time.format(Date.parse(next.startsAt) - OPEN_EARLY)}`}
            />
          </div>
        </div>
      )}
      {!list.length ? (
        <RecordEmpty
          icon={<CalendarDays size={22} />}
          title="Nothing scheduled"
          text="Each till runs for a shift on the schedule. Add one, and it shows up here when it's time to open."
        />
      ) : null}
      <button className={"btn" + (list.length ? " ghost compact" : "")} onClick={onSchedule}>
        {list.length ? "See all shifts" : "Add a shift"}
      </button>
    </div>
  );
}

export function bookingTitle(b: Booking) {
  return b.event?.name ?? b.place?.name ?? b.organizer?.name ?? "Shift";
}

function OpenShift({
  state,
  booking,
  online,
  onOpen,
  onBack,
}: {
  state: RegisterState;
  booking?: Booking;
  online: boolean;
  onOpen: (opening: Opening) => Promise<void>;
  onBack: () => void;
}) {
  const business = state.business!;
  const currency = business.currency;
  const [cash, setCash] = useState<CashValue>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tracked = stockModel(business.settings.stockItems, state.menu).items;
  const checklist = business.settings.checklist ?? [];
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<string[]>([]);
  const value = cash.amount;
  const uncounted = tracked.filter((p) => countOf(counts[p.id]) === undefined).length;
  const unticked = checklist.filter((c) => !checked.includes(c.id)).length;
  const ready = value !== undefined && !uncounted && !unticked;
  const celebrate = useCelebrate();
  const [photo, setPhoto] = useState<{ text: string; image?: string } | null>(null);
  return (
    <div className="stack gap-18">
      <h1 className="headline">
        Count the drawer{tracked.length ? " and stock" : ""}. <span className="g">Then open the shift.</span>
      </h1>
      {(tracked.length > 0 || checklist.length > 0) && (
        <div className="steps" role="list" aria-label="Before you open">
          <span role="listitem" className={value !== undefined ? "done" : undefined}><em>Cash float</em></span>
          {tracked.length > 0 && <span role="listitem" className={!uncounted ? "done" : undefined}><em>Stock</em></span>}
          {checklist.length > 0 && <span role="listitem" className={!unticked ? "done" : undefined}><em>Checklist</em></span>}
        </div>
      )}
      {booking && (
        <div className="stack gap-10">
          <div className="between section-head">
            <p className="group-title">Shift</p>
            <button type="button" className="link small-link" onClick={onBack}>
              Change
            </button>
          </div>
          <div className="card card-list">
            <BookingRow booking={booking} zone={business.timeZone} />
          </div>
        </div>
      )}
      <div className="stack gap-10">
        <p className="group-title">Cash float</p>
        <CashCounter currency={currency} label="Float" onChange={setCash} totalOnly={isSimpleMode(business.settings)} />
      </div>
      {tracked.length > 0 && (
        <div className="stack gap-10">
          <div className="between section-head">
            <p className="group-title">Opening stock</p>
            <span className="label">
              {tracked.length - uncounted} of {tracked.length}
            </span>
          </div>
          <div className="card card-list">
            {tracked.map((item) => (
              <StockCount
                key={item.id}
                item={item}
                value={counts[item.id] ?? ""}
                onChange={(v) => setCounts({ ...counts, [item.id]: v })}
              />
            ))}
          </div>
        </div>
      )}
      {checklist.length > 0 && (
        <div className="stack gap-10">
          <div className="between section-head">
            <p className="group-title">Before you open</p>
            <span className="label">
              {checked.length} of {checklist.length}
            </span>
          </div>
          <span className="bar wide" aria-hidden="true">
            <i style={progressStyle((checked.length / checklist.length) * 100)} />
          </span>
          <div className="card card-list">
            {checklist.map((c) => {
              const on = checked.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  className="list-row"
                  onClick={(e) => {
                    const next = on ? checked.filter((x) => x !== c.id) : [...checked, c.id];
                    setChecked(next);
                    if (on) buzz.tap();
                    else if (next.length === checklist.length) celebrate(centerOf(e.currentTarget));
                    else buzz.tick();
                  }}
                >
                  <span className={"tick" + (on ? " on" : "")}>
                    <Check size={14} strokeWidth={2.6} />
                  </span>
                  <span className={"grow check-text" + (on ? " done" : "")}>{c.text}</span>
                  {c.image && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="check-photo"
                      aria-label={"See photo for " + c.text}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPhoto(c);
                      }}
                    >
                      <img src={c.image} alt="" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="stack gap-10">
        {!online && (
          <p className="label row gap-6">
            <span className="dot danger" /> Connect once to open the shift. Sales
            work offline after that.
          </p>
        )}
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <button
          className="btn block"
          disabled={!online || busy || !ready}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const button = document.activeElement;
              await onOpen({
                openingCash: value!,
                ...(cash.count ? { openingCount: cash.count } : {}),
                stock: Object.fromEntries(tracked.map((p) => [p.id, countOf(counts[p.id])!])),
                checked,
                ...(booking ? { bookingId: booking.id } : {}),
              });
              celebrate(centerOf(button));
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? "Opening…"
            : value === undefined
              ? "Count the cash float"
              : uncounted
                ? `Count ${uncounted} more stock ${uncounted === 1 ? "item" : "items"}`
                : unticked
                  ? `Tick ${unticked} more ${unticked === 1 ? "step" : "steps"}`
                  : `Open with ${formatMoney(value, currency)}`}
        </button>
      </div>
      {photo?.image && (
        <Sheet title={photo.text} onClose={() => setPhoto(null)}>
          <img src={photo.image} alt={photo.text} className="photo-full" />
        </Sheet>
      )}
    </div>
  );
}

function CloseSheet({
  shift,
  state,
  expected,
  currency,
  onClose,
  onDismiss,
}: {
  shift: Shift;
  state: RegisterState;
  expected: number;
  currency: string;
  onClose: (closing: CloseInput, pin: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const [cash, setCash] = useState<CashValue>({});
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const withPin = usePin();
  const { items } = shiftStock(shift);
  const opened = Object.keys(shift.stock ?? {});
  const tracked = items.filter((i) => opened.includes(i.id));
  const left = stockLeft(shift, state.sales);
  const counted = cash.amount;
  const uncounted = tracked.filter((i) => countOf(counts[i.id]) === undefined).length;
  return (
    <Sheet
      title={`Close shift ${shift.number}`}
      onClose={onDismiss}
      busy={busy}
      footer={
        <div className="stack gap-8">
          {counted !== undefined && (
            <p className="between strong">
              <span className="label">Expected {formatMoney(expected, currency)}</span>
              <Difference value={counted - expected} currency={currency} />
            </p>
          )}
          <button
            className="btn block"
            disabled={counted === undefined || uncounted > 0 || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const closing: CloseInput = {
                  countedCash: counted!,
                  ...(cash.count ? { closingCount: cash.count } : {}),
                  ...(tracked.length
                    ? { closingStock: Object.fromEntries(tracked.map((i) => [i.id, countOf(counts[i.id])!])) }
                    : {}),
                };
                if (await withPin((pin) => onClose(closing, pin))) onDismiss();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "Closing…"
              : uncounted
                ? `Count ${uncounted} more stock ${uncounted === 1 ? "item" : "items"}`
                : "Close shift and see report"}
          </button>
        </div>
      }
    >
      <div className="tile">
        <span className="label">Expected in the drawer</span>
        <Money value={expected} currency={currency} className="big-num" />
      </div>
      <div className="stack gap-10">
        <p className="group-title">Cash on hand</p>
        <CashCounter currency={currency} label="Cash on hand" onChange={setCash} totalOnly={isSimpleMode(state.business?.settings)} />
      </div>
      {tracked.length > 0 && (
        <div className="stack gap-10">
          <p className="group-title">Stock left</p>
          <p className="label">The grey number is what should be left after today's sales.</p>
          <div className="card card-list">
            {tracked.map((item) => (
              <StockCount
                key={item.id}
                item={item}
                value={counts[item.id] ?? ""}
                placeholder={String(round(Math.max(0, left[item.id] ?? 0)))}
                onChange={(v) => setCounts({ ...counts, [item.id]: v })}
              />
            ))}
          </div>
        </div>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

function ExpenseSheet({
  currency,
  suggestions,
  name,
  onSave,
  onDismiss,
}: {
  currency: string;
  suggestions: string[];
  name: string;
  onSave: (input: ExpenseInput) => Promise<void>;
  onDismiss: () => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<Expense["source"]>("till");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  let value: number | undefined;
  try {
    value = amount.trim() ? parseMoney(amount, currency) : undefined;
  } catch {}
  const ready = label.trim() && value;
  return (
    <Sheet
      title="Log an expense"
      onClose={onDismiss}
      busy={busy}
      footer={
        <button
          className="btn block"
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onSave({ label: label.trim(), amount: value!, source });
              buzz.success();
              onDismiss();
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {value ? `Log ${formatMoney(value, currency)}` : "Log expense"}
        </button>
      }
    >
      <div className="field">
        <span>What for</span>
        <SuggestInput
          label="What for"
          value={label}
          onChange={setLabel}
          suggestions={suggestions.map((s) => ({ key: s, name: s }))}
          placeholder="Rent, Lalamove, ice…"
          maxLength={80}
          autoFocus
        />
      </div>
      <MoneyField label="Amount" value={amount} onChange={setAmount} currency={currency} big />
      <div className="stack gap-8">
        <span className="label">Paid with</span>
        <div className="segmented" role="group" aria-label="Paid with">
          <button type="button" aria-pressed={source === "till"} onClick={() => setSource("till")}>
            Cash from the till
          </button>
          <button type="button" aria-pressed={source === "pocket"} onClick={() => setSource("pocket")}>
            Own pocket
          </button>
        </div>
        <p className="label">
          {source === "till"
            ? "Takes it out of the cash expected in the drawer."
            : `Leaves the drawer alone. The report says to pay back ${name && name !== "You" ? name.split(" ")[0] : "you"}.`}
        </p>
      </div>
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

const expenseIdeas = ["Rent", "Lalamove", "Grab", "Ice", "Supplies", "Parking", "Food", "Gas"];

export function ShiftScreen({
  state,
  online,
  onOpen,
  onClose,
  onExpense,
  onUnexpense,
  onLink,
  onSell,
  onGoMenu,
  onSchedule,
  onSales,
  demo,
  compact,
}: {
  state: RegisterState;
  online: boolean;
  onOpen: (opening: Opening) => Promise<void>;
  onClose: (closing: CloseInput, pin: string) => Promise<void>;
  onExpense: (input: ExpenseInput) => Promise<void>;
  onUnexpense: (id: string) => Promise<void>;
  onLink: (walkIn: WalkIn) => Promise<void>;
  onSell: () => void;
  onGoMenu?: () => void;
  onSchedule: () => void;
  onSales: (focus: SalesFocus) => void;
  demo: boolean;
  /** On Sell: just the shift, without the past ones. */
  compact?: boolean;
}) {
  const [closing, setClosing] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [addingExpense, setAddingExpense] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [method, setMethod] = useState<string | null>(null);
  const business = state.business!;
  const simple = isSimpleMode(business.settings);
  const shift = state.shift && !state.shift.closedAt ? state.shift : null;
  const startingBooking = !simple && starting ? state.bookings?.find((b) => b.id === starting) : undefined;
  const opening = simple ? state.menu.length > 0 : Boolean(startingBooking);
  const expenses = state.expenses ?? [];
  const totals = shift ? shiftTotals(shift, state.sales, expenses) : null;
  const shiftExpenses = shift ? expenses.filter((e) => e.shiftId === shift.id && !e.voidedAt) : [];
  const pastLabels = [...new Set([...expenses.map((e) => e.label), ...expenseIdeas])];
  const total = useCountUp(totals?.total ?? 0);
  const currency = shiftCurrency(shift ?? undefined, business);
  const canClose = online && !state.pending.length;
  const history = [
    ...new Map(
      [...state.shifts, ...(state.shift ? [state.shift] : [])].map((s) => [s.id, s]),
    ).values(),
  ]
    .filter((s) => s.closedAt)
    .sort((a, b) => b.number - a.number);
  const detailShift = detail ? history.find((s) => s.id === detail) : undefined;
  const time = new Intl.DateTimeFormat("en", {
    timeZone: business.timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  const day = new Intl.DateTimeFormat("en", {
    timeZone: business.timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return (
    <div className="page">
      {state.closingShiftId && (
        <p className="notice" role="status">
          <span className="dot danger" />
          Closing is waiting for the server. Reconnect and close again to finish.
        </p>
      )}
      {shift && totals ? (
        <>
          {!simple && (
            <ShiftStrip
              state={state}
              onTillPage
              onTill={shift.bookingId && (state.bookings ?? []).some((b) => b.id === shift.bookingId) ? onSchedule : () => setLinking(true)}
            />
          )}
          <h1 className="headline">
            <Money value={total} currency={currency} />{" "}
            <span className="g">
              sold since {time.format(new Date(shift.openedAt))}.
            </span>
          </h1>
          <div className="hero stack gap-10">
            <span className="hero-label">Expected in the drawer</span>
            <Money value={totals.expectedCash} currency={currency} className="big-num" />
            <span className="hero-label">
              {formatMoney(shift.openingCash, currency)} float + {formatMoney(totals.cash, currency)} cash sales
              {totals.tillExpenses ? ` − ${formatMoney(totals.tillExpenses, currency)} expenses` : ""}
            </span>
          </div>
          <div className="grid-2">
            <div className="tile">
              <span className="label">Sales</span>
              <span className="num" style={{ fontSize: 28 }}>
                {totals.count}
              </span>
              <span className="micro">
                {totals.reversed ? `${totals.reversed} reversed` : "None reversed"}
              </span>
            </div>
            <div className="tile">
              <span className="label">Discounts given</span>
              <Money value={totals.discounts} currency={currency} className="tile-num" />
              <span className="micro">
                {totals.count
                  ? "Avg " + formatMoney(Math.round(totals.total / totals.count), currency) + " a sale"
                  : "No sales yet"}
              </span>
            </div>
          </div>
          <div className="stack gap-10">
            <div className="between section-head">
              <p className="group-title">Expenses</p>
              {shiftExpenses.length > 0 && (
                <span className="label">{formatMoney(totals.tillExpenses + totals.pocketExpenses, currency)}</span>
              )}
            </div>
            <div className="card card-list">
              {shiftExpenses.map((e) => (
                <div className="list-row" key={e.id}>
                  <span className="well">
                    <Receipt size={18} strokeWidth={1.8} />
                  </span>
                  <span className="grow stack">
                    <span className="ellipsis">{e.label}</span>
                    <span className="label ellipsis">
                      {e.source === "till" ? "From the till" : `Paid by ${e.by ? e.by.split(" ")[0] : "staff"}`}
                      {" · "}
                      {time.format(new Date(e.createdAt))}
                    </span>
                  </span>
                  <Money value={e.amount} currency={currency} />
                  {removing === e.id ? (
                      <button
                        type="button"
                        className="btn ghost danger compact"
                        onClick={async () => {
                          setRemoving(null);
                          await onUnexpense(e.id);
                        }}
                      >
                        Remove
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="round flat"
                        aria-label={"Remove " + e.label}
                        onClick={() => {
                          buzz.tap();
                          setRemoving(e.id);
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                  )}
                </div>
              ))}
              {!shiftExpenses.length && (
                <EmptyRow title="Nothing spent yet" detail="Log ice, supplies or fares so the drawer adds up." />
              )}
              <button type="button" className="list-row" onClick={() => setAddingExpense(true)}>
                <span className="well">
                  <Plus size={18} strokeWidth={1.8} />
                </span>
                <span className="grow stack">
                  <span>Log an expense</span>
                  <span className="label">Paid from the till or out of pocket</span>
                </span>
                <ChevronRight size={18} className="chev" />
              </button>
            </div>
          </div>
          {shift.stock && Object.keys(shift.stock).length > 0 && (
            <div className="stack gap-10">
              <p className="group-title">Stock left</p>
              <div className="card card-list">
                {Object.entries(stockLeft(shift, state.sales)).map(([id, left]) => {
                  const item = shiftStock(shift).items.find((i) => i.id === id);
                  const opened = shift.stock![id];
                  return (
                    <div className="list-row" key={id}>
                      <span className="grow stack">
                        <span className="ellipsis">{item?.name ?? "Stock item"}</span>
                        <span className="meter" aria-hidden="true">
                          <i style={progressStyle(opened ? Math.max(0, left / opened) * 100 : 0)} />
                        </span>
                      </span>
                      <span className={"num" + (left <= 0 ? " g" : "")}>
                        {left <= 0 ? "Out" : `${unitText(left, item?.unit ?? "piece")} left`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <ItemsSold
            state={state}
            shiftIds={[shift.id]}
            menu={shift.menu}
            currency={currency}
            title="this till"
            onSales={(productId) => onSales({ filter: { shift: [shiftKey(shift)], item: [productId] } })}
          />
          <div className="stack gap-10">
            <p className="group-title">By payment</p>
            <div className="card card-list">
              {!totals.count && <EmptyRow title="No sales yet" detail="Each payment method adds up here as you sell." />}
              {totals.methods.filter((m) => m.count).map((m) => (
                <button
                  type="button"
                  className="list-row"
                  key={m.id}
                  onClick={() => {
                    buzz.tap();
                    setMethod(m.id);
                  }}
                >
                  <span className="well">
                    <MethodIcon kind={m.kind as never} size={18} />
                  </span>
                  <span className="grow stack">
                    <span>{m.name}</span>
                    <span className="label">
                      {m.count} {m.count === 1 ? "sale" : "sales"}
                    </span>
                  </span>
                  <Money value={m.amount} currency={currency} />
                  <ChevronRight size={18} className="chev" />
                </button>
              ))}
            </div>
            {method && totals.methods.some((m) => m.id === method) && (
              <PaymentSales
                state={state}
                shiftIds={[shift.id]}
                method={totals.methods.find((m) => m.id === method)!}
                title="this till"
                currency={currency}
                onClose={() => setMethod(null)}
                onSales={() => {
                  onSales({ filter: { shift: [shiftKey(shift)], payment: [method] } });
                  setMethod(null);
                }}
              />
            )}
          </div>
          <div className="stack gap-8">
              <button className="btn block" disabled={!canClose} onClick={() => setClosing(true)}>
                Count drawer and close
              </button>
              {!canClose && (
                <p className="label" style={{ textAlign: "center" }}>
                  {online ? "Waiting for sales to sync." : "Connect to close the shift."}
                </p>
              )}
              <button className="btn secondary" onClick={() => setReport(true)}>
                <FileText size={17} /> Report so far
              </button>
              <button className="btn ghost compact" onClick={onSell}>
                Back to selling
              </button>
            </div>
        </>
      ) : (
        opening ? (
          <OpenShift
            state={state}
            booking={startingBooking}
            online={online}
            onOpen={async (input) => {
              await onOpen(input);
              setStarting(null);
            }}
            onBack={() => setStarting(null)}
          />
        ) : (
          <NoShift state={state} onStart={setStarting} onSchedule={onSchedule} onGoMenu={onGoMenu} />
        )
      )}
      {history.length > 0 && !compact && !startingBooking && (
        <div className="stack gap-10">
          <p className="group-title">Past shifts</p>
          <div className="card card-list">
            {history.slice(0, 30).map((s) => {
              const t = shiftTotals(s, state.sales);
              return (
                <button key={s.id} className="list-row" onClick={() => setDetail(s.id)}>
                  <span className="well">
                    <Wallet size={18} strokeWidth={1.8} />
                  </span>
                  <span className="grow stack">
                    <span>
                      Shift {s.number}{" "}
                      <span className="g">· {day.format(new Date(s.closedAt!))}</span>
                    </span>
                    {s.difference !== undefined && (
                      <span className="label">
                        <Difference value={s.difference} currency={shiftCurrency(s, business)} />
                      </span>
                    )}
                  </span>
                  <Money value={t.total} currency={shiftCurrency(s, business)} />
                  <ChevronRight size={18} className="chev" />
                </button>
              );
            })}
          </div>
        </div>
      )}
      {closing && shift && totals && (
        <CloseSheet
          shift={shift}
          state={state}
          expected={totals.expectedCash}
          currency={currency}
          onClose={async (closing, pin) => {
            await onClose(closing, pin);
            setDetail(shift.id);
          }}
          onDismiss={() => setClosing(false)}
        />
      )}
      {!simple && linking && <LinkSheet state={state} onLink={onLink} onDismiss={() => setLinking(false)} />}
      {addingExpense && (
        <ExpenseSheet
          currency={currency}
          suggestions={pastLabels}
          name={state.me?.name ?? ""}
          onSave={onExpense}
          onDismiss={() => setAddingExpense(false)}
        />
      )}
      {report && shift && (
        <ReportSheet shift={shift} state={state} business={business} onDismiss={() => setReport(false)} />
      )}
      {detailShift && (
        <ReportSheet
          shift={detailShift}
          state={state}
          business={business}
          title={detailShift.closedAt ? `Shift ${detailShift.number} closed` : undefined}
          onDismiss={() => setDetail(null)}
        />
      )}
    </div>
  );
}
