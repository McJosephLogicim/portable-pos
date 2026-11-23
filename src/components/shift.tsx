"use client";

import { useState, type ComponentProps } from "react";
import { CalendarDays, Check, ChevronDown, ChevronRight, ClipboardCheck, ClipboardList, FileText, Wallet } from "lucide-react";
import type { Booking, ExpenseInput, RegisterState, Shift } from "@/lib/types";
import { shiftTotals, stockLeft, stockReplay } from "@/lib/domain";
import type { Closing, Opening } from "@/lib/demo";
import { shiftStock, stockModel, unitText } from "@/lib/stock";
import { shiftCurrency } from "./receipt";
import { JoinTillSheet, ShiftDetailsSheet, TillShiftsSheet, type ScheduleProps } from "./schedule";
import { DrawerDifference, ShiftList } from "./shift-list";
import { CashCounter, type CashValue } from "./cash-count";
import { ReportSheet } from "./report";
import { Popo } from "./popo";
import { ExpensesSection } from "./expenses";
import { countedOnly, countOf, OptionalStockCount } from "./stock-count";
import { ShiftStrip } from "./sell";
import { ItemsSold, PaymentSales } from "./insights";
import { shiftKey } from "@/lib/sales-filter";
import { isOnShift, OPEN_EARLY, startProblem, upcomingBookings } from "@/lib/team";
import { shiftName } from "@/lib/shift-name";
import { blocked, OFFLINE, type Reason } from "@/lib/reject";
import {
  errorText,
  formatMoney,
  MethodIcon,
  Money,
  Notice,
  Sheet,
  buzz,
  centerOf,
  EmptyRow,
  EmptyState,
  progressStyle,
  useCelebrate,
  useCountUp,
  usePin,
} from "./ui";
import styles from "./operations.module.css";

export type CloseInput = Omit<Closing, "action" | "pin">;

function BookingRow({ booking: b, state, note, onClick, refuse }: {
  booking: Booking;
  state: RegisterState;
  note?: string;
  onClick?: () => void;
  /** Why it can't be tapped yet. The row stays tappable so it can say so. */
  refuse?: Reason;
}) {
  const time = new Intl.DateTimeFormat("en", { timeZone: state.business!.timeZone, hour: "numeric", minute: "2-digit" });
  const body = (
    <>
      <span className="well">
        <CalendarDays size={18} strokeWidth={1.8} />
      </span>
      <span className="grow stack">
        <span>{shiftName(b, state)}</span>
        <span className="label ellipsis">
          {time.format(new Date(b.startsAt))} to {time.format(new Date(b.endsAt))}
          {b.place && b.event ? " · " + b.place.name : ""}
        </span>
        {note && <span className="label">{note}</span>}
      </span>
      {onClick && <ChevronRight size={18} className="chev" />}
    </>
  );
  return refuse ? (
    <button type="button" className="list-row plain" {...blocked(refuse)}>
      {body}
    </button>
  ) : onClick ? (
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
  onJoin,
  onSchedule,
  onGoMenu,
}: {
  state: RegisterState;
  onStart: (bookingId: string) => void;
  onJoin?: (shiftId: string) => Promise<void>;
  onSchedule: () => void;
  onGoMenu?: () => void;
}) {
  const zone = state.business!.timeZone;
  const [joining, setJoining] = useState<Shift | null>(null);
  if (!state.menu.length) {
    return (
      <EmptyState
        heading="h1"
        pose={onGoMenu ? "menu" : "team"}
        object="itemsSold"
        title={onGoMenu ? "Add what you sell before the first shift" : "Waiting for the first menu item"}
        text={onGoMenu ? "A name and a price is enough. Photos and options can come later." : "Ask the owner to add the first menu item before you open the till."}
      >
        {onGoMenu && <button type="button" className="btn compact" onClick={onGoMenu}>Add menu items</button>}
      </EmptyState>
    );
  }
  // Booths other phones are running now. This phone can sell on one, or start its own.
  const running = new Map(state.shifts.flatMap((s) => (!s.closedAt && s.bookingId ? [[s.bookingId, s] as const] : [])));
  const memberId = state.me?.memberId;
  const now = Date.now();
  const list = upcomingBookings(state, -Infinity).filter((b) => isOnShift(b, memberId));
  const live = (state.bookings ?? []).filter((b) => running.has(b.id) && isOnShift(b, memberId));
  const scheduled = list.filter((b) => !running.has(b.id) && Date.parse(b.endsAt) > now);
  const missed = list.filter((b) => !running.has(b.id) && Date.parse(b.endsAt) <= now).reverse();
  const ready = scheduled.filter((b) => !startProblem(b, zone, now));
  const next = scheduled.find((b) => startProblem(b, zone, now));
  const time = new Intl.DateTimeFormat("en", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  const weekday = new Intl.DateTimeFormat("en", { timeZone: zone, weekday: "long" });
  const opensAt = next ? Date.parse(next.startsAt) - OPEN_EARLY : 0;
  const opensToday = next && weekday.format(opensAt) === weekday.format(Date.now()) && opensAt - Date.now() < 86_400_000;
  return (
    <div className="stack gap-18">
      <div className={styles.tillHeading}>
        <h1 className="headline">Open till</h1>
        {(list.length > 0 || live.length > 0) && <Popo pose="connect" size={68} className={styles.tillMascot} />}
      </div>
      {live.length > 0 && (
        <div className="stack gap-10">
          <p className="group-title">Open on another phone</p>
          <div className="card card-list">
            {live.map((b) => {
              const till = running.get(b.id)!;
              return (
                <BookingRow
                  key={b.id}
                  booking={b}
                  state={state}
                  note={till.openedBy && `Opened by ${till.openedBy.split(" ")[0]}`}
                  onClick={onJoin ? () => setJoining(till) : undefined}
                />
              );
            })}
          </div>
        </div>
      )}
      {joining && onJoin && (
        <JoinTillSheet till={joining} name={shiftName(joining, state)} onClose={() => setJoining(null)} onJoin={onJoin} />
      )}
      {ready.length > 0 && (
        <div className="stack gap-10">
          <p className="group-title">Ready to start</p>
          <div className="card card-list">
            {ready.map((b) => (
              <BookingRow key={b.id} booking={b} state={state} onClick={() => onStart(b.id)} />
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
              state={state}
              note={`Till opens from ${time.format(opensAt)}`}
              refuse={`Not yet. The till opens ${opensToday ? "" : weekday.format(opensAt) + " "}at ${time.format(opensAt)}.`}
            />
          </div>
        </div>
      )}
      {missed.length > 0 && (
        <div className="stack gap-10">
          <p className="group-title">Missed shifts</p>
          <div className="card card-list">
            {missed.map((b) => (
              <BookingRow key={b.id} booking={b} state={state} onClick={() => onStart(b.id)} />
            ))}
          </div>
        </div>
      )}
      {!list.length && !live.length ? (
        <EmptyState
          pose="plan"
          object="shiftCalendar"
          title="No shifts assigned to you"
          text="Join an open seat on Shifts or ask an owner to assign you."
        >
          <button type="button" className="btn compact" onClick={onSchedule}>Go to Shifts</button>
        </EmptyState>
      ) : (
        <button type="button" className="btn ghost compact" onClick={onSchedule}>See all shifts</button>
      )}
    </div>
  );
}

function OpenShift({
  state,
  booking,
  online,
  onOpen,
  openTill,
  onJoin,
  onBack,
}: {
  state: RegisterState;
  booking: Booking;
  online: boolean;
  onOpen: (opening: Opening) => Promise<void>;
  openTill?: Shift;
  onJoin?: (shiftId: string) => Promise<void>;
  onBack: () => void;
}) {
  const business = state.business!;
  const currency = business.currency;
  const [cash, setCash] = useState<CashValue>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmJoin, setConfirmJoin] = useState(false);
  const { items: tracked, limits } = stockModel(business.settings.stockItems, state.menu);
  const checklist = business.settings.checklist ?? [];
  const saved = Object.fromEntries(tracked.flatMap((i) => (i.onHand === undefined ? [] : [[i.id, i.onHand]])));
  const [counting, setCounting] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<string[]>([]);
  const value = cash.amount;
  const unticked = checklist.filter((c) => !checked.includes(c.id)).length;
  const uncounted = tracked.filter((i) => limits.has(i.id) && countOf(counts[i.id]) === undefined).length;
  const OpeningClipboard = value !== undefined && !unticked && !uncounted ? ClipboardCheck : ClipboardList;
  const celebrate = useCelebrate();
  const [photo, setPhoto] = useState<{ text: string; image?: string } | null>(null);
  if (openTill && onJoin) {
    return (
      <div className="stack gap-18">
        <h1 className="headline">This shift is already open</h1>
        <div className="card card-list"><BookingRow booking={booking} state={state} /></div>
        <p className="muted">The till is using the opening counts from the other device.</p>
        <button type="button" className="btn block" aria-haspopup="dialog" {...blocked(!online && OFFLINE)} onClick={() => setConfirmJoin(true)}>
          Join till
        </button>
        <button type="button" className="btn ghost compact" onClick={onBack}>Change shift</button>
        {confirmJoin && <JoinTillSheet till={openTill} name={shiftName(booking, state)} onClose={() => setConfirmJoin(false)} onJoin={onJoin} />}
      </div>
    );
  }
  return (
    <div className="stack gap-18">
      <h1 className="headline">Open till</h1>
      {(limits.size > 0 || checklist.length > 0) && (
        <div className={styles.openingProgress}>
          <div className="steps" role="list" aria-label="Before you open">
            <span role="listitem" className={value !== undefined ? "done" : undefined}><em>Cash</em></span>
            {limits.size > 0 && <span role="listitem" className={!uncounted ? "done" : undefined}><em>Stock</em></span>}
            {checklist.length > 0 && <span role="listitem" className={!unticked ? "done" : undefined}><em>Checklist</em></span>}
          </div>
          <span className={styles.openingArt} aria-hidden="true">
            <Popo pose="plan" motion="curiousPeek" size={58} />
            <OpeningClipboard className={styles.openingClipboard} size={22} strokeWidth={1.7} />
          </span>
        </div>
      )}
      <div className="stack gap-10">
        <div className="between section-head">
          <p className="group-title">Shift</p>
          <button type="button" className="link small-link" onClick={onBack}>
            Change
          </button>
        </div>
        <div className="card card-list">
          <BookingRow booking={booking} state={state} />
        </div>
      </div>
      <CashCounter currency={currency} label="Starting cash" onChange={setCash} />
      {tracked.length > 0 && (
        <OptionalStockCount
          title="Opening stock"
          help="Menu items set to Count it are always counted. Stock and prep items are optional: anything you don't count starts from the amount saved on it, and sales take from it either way."
          items={tracked}
          required={limits}
          counts={counts}
          expected={saved}
          on={counting}
          onToggle={setCounting}
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
          disabled={busy}
          {...blocked(
            value === undefined ? "Count the starting cash first."
              : uncounted ? `Count ${uncounted === 1 ? "the item" : `the ${uncounted} items`} marked Count it first.`
                : unticked ? `Tick ${unticked === 1 ? "the last checklist item" : `the ${unticked} checklist items left`} first.`
                  : !online && "Connect to the internet to open the shift.",
          )}
          onClick={async (event) => {
            const origin = event.detail > 0 ? centerOf(event.currentTarget) : undefined;
            setBusy(true);
            setError("");
            try {
              await onOpen({
                openingCash: value!,
                ...(cash.count ? { openingCount: cash.count } : {}),
                stock: countedOnly(tracked.filter((i) => counting || limits.has(i.id)), counts),
                checked,
                bookingId: booking.id,
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
          {busy
            ? "Opening…"
            : uncounted && value !== undefined && !unticked
              ? `Count ${uncounted} more ${uncounted === 1 ? "item" : "items"}`
              : "Open till"}
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

export function CloseSheet({
  shift,
  state,
  expected,
  currency,
  expenseProps,
  onClose,
  onDismiss,
}: {
  shift: Shift;
  state: RegisterState;
  expected: number;
  currency: string;
  expenseProps: ComponentProps<typeof ExpensesSection>;
  onClose: (closing: CloseInput, pin: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const [cash, setCash] = useState<CashValue>({});
  const [counting, setCounting] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const withPin = usePin();
  const { items, limits } = shiftStock(shift);
  const left = stockLeft(shift, state.sales);
  const tracked = items.filter((i) => i.id in left);
  const counted = cash.amount;
  const closingStock = countedOnly(tracked.filter((i) => counting || limits.has(i.id)), counts);
  const uncounted = tracked.filter((i) => limits.has(i.id) && countOf(counts[i.id]) === undefined).length;
  return (
    <Sheet
      title="Close shift"
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
            disabled={busy}
            {...blocked(
              counted === undefined ? "Count the cash in the drawer first."
                : uncounted > 0 && `Count ${uncounted === 1 ? "the last item" : `the ${uncounted} items left`} first.`,
            )}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const closing: CloseInput = {
                  countedCash: counted!,
                  ...(cash.count ? { closingCount: cash.count } : {}),
                  ...(Object.keys(closingStock).length ? { closingStock } : {}),
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
                ? `Count ${uncounted} more ${uncounted === 1 ? "item" : "items"}`
                : "Close shift and see report"}
          </button>
        </div>
      }
    >
      <p className="strong">{shiftName(shift, state)}</p>
      <div className="tile">
        <span className="label">Expected in the drawer</span>
        <Money value={expected} currency={currency} className="big-num" />
      </div>
      <ExpensesSection {...expenseProps} disabled={busy || expenseProps.disabled} />
      <div className="stack gap-10">
        <p className="group-title">Cash on hand</p>
        <CashCounter currency={currency} label="Cash on hand" onChange={setCash} />
      </div>
      {tracked.length > 0 && (
        <OptionalStockCount
          title="Closing stock"
          help="Menu items set to Count it are always counted. Stock and prep items are optional: anything you don't count is saved as what today's sales left, and the next shift starts from there."
          items={tracked}
          required={limits}
          counts={counts}
          expected={left}
          on={counting}
          onToggle={setCounting}
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

export function ShiftScreen({
  onOpen,
  onJoin,
  onClose,
  onExpense,
  onEditExpense,
  onUnexpense,
  onSell,
  onGoMenu,
  onSchedule,
  onStart,
  onBack,
  openingId,
  sellLabel,
  ...scheduleProps
}: ScheduleProps & {
  onOpen: (opening: Opening) => Promise<void>;
  onJoin?: (shiftId: string) => Promise<void>;
  onClose: (closing: CloseInput, pin: string) => Promise<void>;
  onExpense: (input: ExpenseInput) => Promise<void>;
  onEditExpense: (id: string, input: ExpenseInput) => Promise<void>;
  onUnexpense: (id: string) => Promise<void>;
  onSell: () => void;
  onGoMenu?: () => void;
  onSchedule: () => void;
  onStart: (bookingId: string) => void;
  onBack: () => void;
  openingId?: string;
  sellLabel: string;
}) {
  const schedule = { ...scheduleProps, onEditExpense, onUnexpense };
  const { state, online, onSales } = schedule;
  const [closing, setClosing] = useState<string | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [closedId, setClosedId] = useState<string | null>(null);
  const [pastShifts, setPastShifts] = useState(false);
  const [pastTillId, setPastTillId] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [allStock, setAllStock] = useState(false);
  const [allPayments, setAllPayments] = useState(false);
  const business = state.business!;
  const shift = state.shift && !state.shift.closedAt ? state.shift : null;
  const activeBooking = state.bookings?.find((b) => b.id === shift?.bookingId);
  const openingTill = openingId ? state.shifts.find((record) => record.bookingId === openingId) : undefined;
  const startingBooking = openingId && !openingTill?.closedAt
    ? state.bookings?.find((b) => b.id === openingId && !b.tillClosed && isOnShift(b, state.me?.memberId))
    : undefined;
  const recoveryTills = state.shifts.filter((record) => !record.closedAt && state.recoveryTillIds?.includes(record.id));
  const closingTill = [shift, ...recoveryTills].find((till) =>
    till && till.id === closing && state.bookings?.some((b) => b.id === till.bookingId));
  const expenses = state.expenses ?? [];
  const totals = shift ? shiftTotals(shift, state.sales, expenses) : null;
  const replay = shift ? stockReplay(shift, state.sales) : undefined;
  const remainingStock = replay ? Object.entries(replay.left) : [];
  const paymentMethods = totals?.methods.filter((m) => m.count) ?? [];
  const total = useCountUp(totals?.total ?? 0);
  const currency = shiftCurrency(shift ?? undefined, business);
  const expenseProps = {
    expenses: expenses.filter((e) => e.shiftId === shift?.id && !e.voidedAt),
    suggestions: expenses.map((e) => e.label),
    name: state.me?.name ?? "",
    timeZone: business.timeZone,
    currency,
    disabled: Boolean(state.closingShiftId),
    onExpense,
    onEditExpense,
    onUnexpense,
  };
  const canClose = online && !state.pending.length;
  const closeReason = !canClose && (online ? "Wait for sales to sync, then close." : "Connect to the internet to close the till.");
  const needsShift = "Link this till to a shift before closing.";
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
        <Notice tone="danger">Closing is waiting for the server. Reconnect and close again to finish.</Notice>
      )}
      {(shift || (history.length > 0 && !startingBooking)) && (
        <div className="stack gap-8">
          {shift && (
            <ShiftStrip
              state={state}
              onTillPage
              onTill={activeBooking ? () => setBookingId(activeBooking.id) : () => setLinking(shift.id)}
            />
          )}
          {history.length > 0 && !startingBooking && (
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
          <div className={`hero ${styles.tillDrawer}`}>
            <div className={`stack gap-10 ${styles.tillDrawerTotal}`}>
              <span className="hero-label">Expected in the drawer</span>
              <Money value={totals.expectedCash} currency={currency} className="big-num" />
              <span className="hero-label">
                {formatMoney(shift.openingCash, currency)} float + {formatMoney(totals.cash, currency)} cash sales
                {totals.tillExpenses ? ` − ${formatMoney(totals.tillExpenses, currency)} expenses` : ""}
              </span>
            </div>
            <Popo key={shift.id} motion="curiousPeek" size={212} className={styles.drawerMascot} />
          </div>
          {!state.closingShiftId && (
            <button className="btn block" onClick={onSell}>{sellLabel}</button>
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
          <ExpensesSection key={shift.id} {...expenseProps} />
          {remainingStock.length > 0 && (
            <div className="stack gap-10">
              <p className="group-title">Stock left</p>
              <div className="card card-list">
                {(allStock ? remainingStock : remainingStock.slice(0, 5)).map(([id, left]) => {
                  const item = shiftStock(shift).items.find((i) => i.id === id);
                  const opened = replay!.start[id];
                  const out = left <= 0 || replay!.short.has(id);
                  return (
                    <div className="list-row" key={id}>
                      <span className="grow stack">
                        <span className="ellipsis">{item?.name ?? "Stock item"}</span>
                        <span className="meter" aria-hidden="true">
                          <i style={progressStyle(opened ? Math.max(0, left / opened) * 100 : 0)} />
                        </span>
                      </span>
                      <span className={"num" + (out ? " g" : "")}>
                        {out ? "Ran out" : `${unitText(left, item?.unit ?? "piece")} left`}
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
              {!totals.count && <EmptyRow object="payment" title="No sales yet" detail="Each payment method adds up here as you sell." />}
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
                }}
              />
            )}
          </div>
          <div className="stack gap-8">
              <button
                className="btn secondary block"
                {...blocked(activeBooking ? closeReason : needsShift)}
                aria-haspopup="dialog"
                onClick={() => setClosing(shift.id)}
              >
                Count drawer and close
              </button>
              {(!activeBooking || !canClose) && (
                <p className="label" style={{ textAlign: "center" }}>
                  {!activeBooking ? needsShift : online ? "Waiting for sales to sync." : "Connect to close the shift."}
                </p>
              )}
              <button className="btn secondary" aria-haspopup="dialog" onClick={() => setReport(true)}>
                <FileText size={17} /> Report so far
              </button>
            </div>
        </>
      ) : (
        startingBooking ? (
          <OpenShift
            key={startingBooking.id}
            state={state}
            booking={startingBooking}
            online={online}
            onOpen={onOpen}
            openTill={openingTill}
            onJoin={onJoin}
            onBack={onBack}
          />
        ) : (
          <NoShift state={state} onStart={onStart} onJoin={onJoin} onSchedule={onSchedule} onGoMenu={onGoMenu} />
        )
      )}
      {recoveryTills.length > 0 && !startingBooking && (
        <div className="stack gap-10">
          <p className="group-title">Tills needing attention</p>
          <div className="card card-list">
            {recoveryTills.map((record) => {
              const linked = state.bookings?.some((b) => b.id === record.bookingId);
              return (
                <button key={record.id} type="button" className="list-row" aria-haspopup="dialog"
                  {...blocked(linked && closeReason)}
                  onClick={() => linked ? setClosing(record.id) : setLinking(record.id)}>
                  <Wallet size={17} aria-hidden="true" />
                  <span className="grow stack">
                    <span>{shiftName(record, state)}</span>
                    {!linked && <span className="label">No shift. Tap to link this till.</span>}
                  </span>
                  <ChevronRight size={16} className="chev" />
                </button>
              );
            })}
          </div>
        </div>
      )}
      {bookingId && <ShiftDetailsSheet {...schedule} bookingId={bookingId} onClose={() => setBookingId(null)} />}
      {pastShifts && (
        <Sheet title="Past shifts" onClose={() => setPastShifts(false)}>
          <ShiftList entries={history} state={state} showDates onOpen={setPastTillId} />
        </Sheet>
      )}
      {pastTillId && (
        <ShiftDetailsSheet {...schedule} tillId={pastTillId} onClose={() => setPastTillId(null)} />
      )}
      {closingTill && (
        <CloseSheet
          key={closingTill.id}
          shift={closingTill}
          state={state}
          expected={shiftTotals(closingTill, state.sales, expenses).expectedCash}
          currency={shiftCurrency(closingTill, business)}
          expenseProps={closingTill.id === shift?.id ? expenseProps : {
            ...expenseProps,
            expenses: expenses.filter((expense) => expense.shiftId === closingTill.id && !expense.voidedAt),
            disabled: true,
          }}
          onClose={async (closing, pin) => {
            await onClose({ ...closing, shiftId: closingTill.id }, pin);
            buzz.success();
            setClosedId(closingTill.id);
          }}
          onDismiss={() => setClosing(null)}
        />
      )}
      {linking && (
        <TillShiftsSheet {...schedule} shiftId={linking} onClose={() => setLinking(null)} onSchedule={onSchedule} />
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
          onDismiss={() => setClosedId(null)}
        />
      )}
    </div>
  );
}
