"use client";

import { useState } from "react";
import { CalendarDays, Check, ChevronDown, ChevronRight, FileText, Plus, Receipt, Trash2, Wallet } from "lucide-react";
import type { Booking, Business, Expense, RegisterState, Shift, StockItem } from "@/lib/types";
import { parseMoney, shiftTotals, stockLeft } from "@/lib/domain";
import { isSimpleMode } from "@/lib/settings";
import type { Closing, Opening } from "@/lib/demo";
import { shiftStock, stockModel, unitText } from "@/lib/stock";
import { shiftCurrency } from "./receipt";
import { ShiftDetailsSheet, TillShiftsSheet, type ScheduleProps } from "./schedule";
import { DrawerDifference, ShiftList } from "./shift-list";
import { CashCounter, type CashValue } from "./cash-count";
import { ReportSheet } from "./report";
import { SuggestInput } from "./combobox";
import { RecordEmpty } from "./records";
import { countOf, ShiftStockCount } from "./stock-count";
import { ShiftStrip } from "./sell";
import { ItemsSold, PaymentSales } from "./insights";
import { shiftKey } from "@/lib/sales-filter";
import { bookingTitle, OPEN_EARLY, startProblem, upcomingBookings } from "@/lib/team";
import {
  ConfirmSheet,
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
import styles from "./operations.module.css";

export type CloseInput = Omit<Closing, "action" | "pin">;
export type ExpenseInput = { label: string; amount: number; source: Expense["source"] };

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

/** Till shows the scheduled shift you can start now, or the next one. */
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
  const list = upcomingBookings(state);
  const ready = list.filter((b) => !startProblem(b, zone));
  const next = list.find((b) => startProblem(b, zone));
  const time = new Intl.DateTimeFormat("en", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  return (
    <div className="stack gap-18">
      <h1 className="headline">Open till</h1>
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
          text="Schedule a shift before opening the till."
        />
      ) : null}
      <button className={"btn" + (list.length ? " ghost compact" : "")} onClick={onSchedule}>
        {list.length ? "See all shifts" : "Add"}
      </button>
    </div>
  );
}

function OpenShift({
  state,
  booking,
  online,
  onOpen,
  onBack,
  onSelectBooking,
}: {
  state: RegisterState;
  booking?: Booking;
  online: boolean;
  onOpen: (opening: Opening) => Promise<void>;
  onBack: () => void;
  onSelectBooking: (bookingId: string) => void;
}) {
  const business = state.business!;
  const currency = business.currency;
  const simple = isSimpleMode(business.settings);
  const readyBookings = simple && !booking
    ? upcomingBookings(state).filter((b) => !startProblem(b, business.timeZone))
    : [];
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
      <h1 className="headline">Open till</h1>
      {(tracked.length > 0 || checklist.length > 0) && (
        <div className="steps" role="list" aria-label="Before you open">
          <span role="listitem" className={value !== undefined ? "done" : undefined}><em>Cash</em></span>
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
      {readyBookings.length > 0 && (
        <div className="stack gap-10">
          <p className="group-title">Scheduled shift (optional)</p>
          <div className="card card-list">
            {readyBookings.map((b) => (
              <BookingRow key={b.id} booking={b} zone={business.timeZone} onClick={() => onSelectBooking(b.id)} />
            ))}
          </div>
        </div>
      )}
      <div className="stack gap-10">
        <CashCounter currency={currency} label="Starting cash" onChange={setCash} totalOnly={simple} />
      </div>
      {tracked.length > 0 && (
        <ShiftStockCount
          title="Opening stock"
          items={tracked}
          counts={counts}
          uncounted={uncounted}
          onChange={(id, value) => setCounts((all) => ({ ...all, [id]: value }))}
        />
      )}
      {checklist.length > 0 && (
        <div className="stack gap-10">
          <div className="between section-head">
            <p className="group-title">Before you open</p>
            <span className="label">
              {checked.length} of {checklist.length}
            </span>
          </div>
          <span className={`bar wide ${styles.openingProgress}`} aria-hidden="true">
            <i style={progressStyle((checked.length / checklist.length) * 100)} />
          </span>
          <div className="card card-list">
            {checklist.map((c) => {
              const on = checked.includes(c.id);
              return (
                <div key={c.id} className={styles.checklistRow}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className="list-row"
                    onClick={() => {
                      setChecked(on ? checked.filter((x) => x !== c.id) : [...checked, c.id]);
                      if (on) buzz.tap();
                      else buzz.tick();
                    }}
                  >
                    <span className={"tick" + (on ? " on" : "")} aria-hidden="true">
                      <Check size={14} strokeWidth={2.6} />
                    </span>
                    <span className={"grow check-text" + (on ? " done" : "")}>{c.text}</span>
                  </button>
                  {c.image && (
                    <button
                      type="button"
                      className={styles.checklistPhoto}
                      aria-label={"See photo for " + c.text}
                      aria-haspopup="dialog"
                      onClick={() => setPhoto(c)}
                    >
                      <img src={c.image} alt="" />
                    </button>
                  )}
                </div>
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
          onClick={async (event) => {
            const origin = event.detail > 0 ? centerOf(event.currentTarget) : undefined;
            setBusy(true);
            setError("");
            try {
              await onOpen({
                openingCash: value!,
                ...(cash.count ? { openingCount: cash.count } : {}),
                stock: Object.fromEntries(tracked.map((p) => [p.id, countOf(counts[p.id])!])),
                checked,
                ...(booking ? { bookingId: booking.id } : {}),
              });
              if (origin) celebrate(origin);
              else buzz.success();
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Opening…" : "Open till"}
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
              <DrawerDifference value={counted - expected} currency={currency} />
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
        <ShiftStockCount
          title="Closing stock"
          items={tracked}
          counts={counts}
          uncounted={uncounted}
          expected={left}
          onChange={(id, value) => setCounts((all) => ({ ...all, [id]: value }))}
        />
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
          {busy ? "Logging…" : value ? `Log ${formatMoney(value, currency)}` : "Log expense"}
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
  onOpen,
  onClose,
  onExpense,
  onUnexpense,
  onSell,
  onGoMenu,
  onSchedule,
  onShift,
  compact,
  ...schedule
}: ScheduleProps & {
  onOpen: (opening: Opening) => Promise<void>;
  onClose: (closing: CloseInput, pin: string) => Promise<void>;
  onExpense: (input: ExpenseInput) => Promise<void>;
  onUnexpense: (id: string) => Promise<void>;
  onSell: () => void;
  onGoMenu?: () => void;
  onSchedule: () => void;
  onShift: (bookingId: string) => void;
  /** On Sell: just the shift, without the past ones. */
  compact?: boolean;
}) {
  const { state, online, onSales } = schedule;
  const [closing, setClosing] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [addingExpense, setAddingExpense] = useState(false);
  const [closedId, setClosedId] = useState<string | null>(null);
  const [pastShifts, setPastShifts] = useState(false);
  const [pastTillId, setPastTillId] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const [removing, setRemoving] = useState<Expense | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [allExpenses, setAllExpenses] = useState(false);
  const [allStock, setAllStock] = useState(false);
  const [allPayments, setAllPayments] = useState(false);
  const business = state.business!;
  const simple = isSimpleMode(business.settings);
  const shift = state.shift && !state.shift.closedAt ? state.shift : null;
  const activeBooking = state.bookings?.find((b) => b.id === shift?.bookingId);
  const startingBooking = starting ? upcomingBookings(state).find((b) => b.id === starting) : undefined;
  const opening = simple ? state.menu.length > 0 : Boolean(startingBooking);
  const expenses = state.expenses ?? [];
  const totals = shift ? shiftTotals(shift, state.sales, expenses) : null;
  const shiftExpenses = shift ? expenses.filter((e) => e.shiftId === shift.id && !e.voidedAt) : [];
  const remainingStock = shift ? Object.entries(stockLeft(shift, state.sales)) : [];
  const paymentMethods = totals?.methods.filter((m) => m.count) ?? [];
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
  const justClosed = closedId ? history.find((s) => s.id === closedId) : undefined;
  const time = new Intl.DateTimeFormat("en", {
    timeZone: business.timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  return (
    <div className="page">
      {state.closingShiftId && (
        <p className="notice" role="status">
          <span className="dot danger" />
          Closing is waiting for the server. Reconnect and close again to finish.
        </p>
      )}
      {(shift || (history.length > 0 && !compact && !startingBooking)) && (
        <div className="stack gap-8">
          {shift && (
            <ShiftStrip
              state={state}
              onTillPage
              onTill={activeBooking ? () => onShift(activeBooking.id) : () => setLinking(shift.id)}
            />
          )}
          {history.length > 0 && !compact && !startingBooking && (
            <button type="button" className="shift-strip" onClick={() => setPastShifts(true)} aria-haspopup="dialog">
              <Wallet size={16} strokeWidth={1.9} />
              <span className="grow">Past shifts</span>
              <span className="label">{history.length}</span>
              <ChevronRight size={16} className="chev" />
            </button>
          )}
        </div>
      )}
      {shift && totals ? (
        <>
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
          {!compact && !state.closingShiftId && (
            <button className="btn block" onClick={onSell}>Back to selling</button>
          )}
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
              {(allExpenses ? shiftExpenses : shiftExpenses.slice(0, 5)).map((e) => (
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
                  <button
                    type="button"
                    className="round flat"
                    aria-label={"Remove " + e.label}
                    onClick={() => {
                      buzz.tap();
                      setRemoving(e);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {!shiftExpenses.length && (
                <EmptyRow title="Nothing spent yet" detail="Log ice, supplies or fares so the drawer adds up." />
              )}
              {shiftExpenses.length > 5 && (
                  <button type="button" className="list-row" onClick={() => setAllExpenses(!allExpenses)} aria-expanded={allExpenses}>
                  <span className="grow">{allExpenses ? "Show less" : `Show ${shiftExpenses.length - 5} more`}</span>
                    <ChevronDown size={18} className={`chev ${styles.disclosure}`} />
                </button>
              )}
                <button type="button" className="list-row" aria-haspopup="dialog" onClick={() => setAddingExpense(true)}>
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
                {(allStock ? remainingStock : remainingStock.slice(0, 5)).map(([id, left]) => {
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
                {remainingStock.length > 5 && (
                  <button type="button" className="list-row" onClick={() => setAllStock(!allStock)} aria-expanded={allStock}>
                    <span className="grow">{allStock ? "Show less" : `Show ${remainingStock.length - 5} more`}</span>
                    <ChevronDown size={18} className={`chev ${styles.disclosure}`} />
                  </button>
                )}
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
              {(allPayments ? paymentMethods : paymentMethods.slice(0, 5)).map((m) => (
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
              {paymentMethods.length > 5 && (
                <button type="button" className="list-row" onClick={() => setAllPayments(!allPayments)} aria-expanded={allPayments}>
                  <span className="grow">{allPayments ? "Show less" : `Show ${paymentMethods.length - 5} more`}</span>
                  <ChevronDown size={18} className={`chev ${styles.disclosure}`} />
                </button>
              )}
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
              <button className="btn secondary block" disabled={!canClose} aria-haspopup="dialog" onClick={() => setClosing(true)}>
                Count drawer and close
              </button>
              {!canClose && (
                <p className="label" style={{ textAlign: "center" }}>
                  {online ? "Waiting for sales to sync." : "Connect to close the shift."}
                </p>
              )}
              <button className="btn secondary" aria-haspopup="dialog" onClick={() => setReport(true)}>
                <FileText size={17} /> Report so far
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
            onSelectBooking={setStarting}
          />
        ) : (
          <NoShift state={state} onStart={setStarting} onSchedule={onSchedule} onGoMenu={onGoMenu} />
        )
      )}
      {pastShifts && (
        <Sheet title="Past shifts" onClose={() => setPastShifts(false)}>
          <ShiftList entries={history} state={state} showDates onOpen={setPastTillId} />
        </Sheet>
      )}
      {pastTillId && (
        <ShiftDetailsSheet {...schedule} tillId={pastTillId} onClose={() => setPastTillId(null)} />
      )}
      {closing && shift && totals && (
        <CloseSheet
          shift={shift}
          state={state}
          expected={totals.expectedCash}
          currency={currency}
          onClose={async (closing, pin) => {
            await onClose(closing, pin);
            buzz.success();
            setClosedId(shift.id);
          }}
          onDismiss={() => setClosing(false)}
        />
      )}
      {linking && (
        <TillShiftsSheet {...schedule} shiftId={linking} onClose={() => setLinking(null)} />
      )}
      {addingExpense && (
        <ExpenseSheet
          currency={currency}
          suggestions={pastLabels}
          name={state.me?.name ?? ""}
          onSave={onExpense}
          onDismiss={() => setAddingExpense(false)}
        />
      )}
      {removing && (
        <ConfirmSheet
          title="Remove expense?"
          detail={`${removing.label} (${formatMoney(removing.amount, currency)}) will come out of the shift’s expense total.`}
          confirmLabel="Remove"
          onClose={() => setRemoving(null)}
          onConfirm={() => onUnexpense(removing.id)}
        />
      )}
      {report && shift && (
        <ReportSheet shift={shift} state={state} business={business} onDismiss={() => setReport(false)} />
      )}
      {justClosed && (
        <ReportSheet
          shift={justClosed}
          state={state}
          business={business}
          justClosed
          title={`Shift ${justClosed.number} closed`}
          onDismiss={() => setClosedId(null)}
        />
      )}
    </div>
  );
}
