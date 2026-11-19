"use client";

import { useState } from "react";
import { CalendarDays, Check, ChevronRight, Wallet } from "lucide-react";
import type { Booking, Business, RegisterState, Shift } from "@/lib/types";
import { parseMoney, shiftTotals, stockLeft } from "@/lib/domain";
import type { Opening } from "@/lib/demo";
import type { SalesFocus } from "./sales";
import { currencyDigits } from "@/lib/settings";
import { shiftCurrency } from "./receipt";
import {
  errorText,
  formatMoney,
  MethodIcon,
  Money,
  MoneyField,
  Sheet,
  buzz,
  centerOf,
  useCelebrate,
  useCountUp,
  usePin,
} from "./ui";

const floats: Record<string, number> = { PHP: 1000, USD: 100, JPY: 10000, IDR: 500000, VND: 1000000 };

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

/** Scheduled shifts a till opened now is most likely for: running now or starting within three hours. */
function nearBookings(state: RegisterState) {
  const now = Date.now();
  return (state.bookings ?? []).filter(
    (b) => Date.parse(b.endsAt) > now && Date.parse(b.startsAt) - now < 3 * 3600000,
  );
}

export function bookingTitle(b: Booking) {
  return b.event?.name ?? b.place?.name ?? b.organizer?.name ?? "Shift";
}

function OpenShift({
  state,
  online,
  onOpen,
  onGoMenu,
}: {
  state: RegisterState;
  online: boolean;
  onOpen: (opening: Opening) => Promise<void>;
  onGoMenu: () => void;
}) {
  const business = state.business!;
  const currency = business.currency;
  const unit = 10 ** currencyDigits(currency);
  const base = (floats[currency] ?? 100) * unit;
  const presets = [0, base / 2, base, base * 2];
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const tracked = state.menu.filter((p) => p.stock);
  const checklist = business.settings.checklist ?? [];
  const near = nearBookings(state);
  const mine = near.find((b) => b.staff.some((s) => s.memberId === state.me?.memberId));
  const [bookingId, setBookingId] = useState<string | null>((mine ?? near[0])?.id ?? null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<string[]>([]);
  let value: number | undefined;
  try {
    value = amount.trim() ? parseMoney(amount, currency) : undefined;
  } catch {}
  const uncounted = tracked.filter((p) => !(counts[p.id] ?? "").trim()).length;
  const unticked = checklist.filter((c) => !checked.includes(c.id)).length;
  const ready = value !== undefined && !uncounted && !unticked;
  const celebrate = useCelebrate();
  const [photo, setPhoto] = useState<{ text: string; image?: string } | null>(null);
  const time = new Intl.DateTimeFormat("en", { timeZone: business.timeZone, hour: "numeric", minute: "2-digit" });
  if (!state.menu.length)
    return (
      <div className="stack gap-18">
        <h1 className="headline">
          Add what you sell <span className="g">before the first shift.</span>
        </h1>
        <div className="card card-pad stack gap-12">
          <p className="muted">
            A name and a price is enough. Photos and options can come later.
          </p>
          <button className="btn" onClick={onGoMenu}>
            Add menu items
          </button>
        </div>
      </div>
    );
  return (
    <div className="stack gap-18">
      <h1 className="headline">
        Count the drawer{tracked.length ? " and stock" : ""}. <span className="g">Then open the shift.</span>
      </h1>
      {near.length > 0 && (
        <div className="stack gap-10">
          <p className="group-title">This till is for</p>
          <div className="card card-list">
            {[...near, null].map((b) => (
              <button
                key={b?.id ?? "none"}
                type="button"
                className="list-row"
                aria-pressed={bookingId === (b?.id ?? null)}
                onClick={() => setBookingId(b?.id ?? null)}
              >
                <span className="well">
                  <CalendarDays size={18} strokeWidth={1.8} />
                </span>
                <span className="grow stack">
                  <span className="ellipsis">{b ? bookingTitle(b) : "Not a scheduled shift"}</span>
                  {b && (
                    <span className="label ellipsis">
                      {time.format(new Date(b.startsAt))} to {time.format(new Date(b.endsAt))}
                      {b.place && b.event ? " · " + b.place.name : ""}
                    </span>
                  )}
                </span>
                <span className={"tick" + (bookingId === (b?.id ?? null) ? " on" : "")}>
                  <Check size={14} strokeWidth={2.6} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="card card-pad stack gap-14">
        <p className="label">Cash in the drawer right now</p>
        <div className="quick">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={value === p}
              onClick={() => setAmount(String(p / unit))}
            >
              {p ? formatMoney(p, currency) : "None"}
            </button>
          ))}
        </div>
        <MoneyField
          label="Or count it"
          value={amount}
          onChange={setAmount}
          currency={currency}
        />
      </div>
      {tracked.length > 0 && (
        <div className="stack gap-10">
          <p className="group-title">Stock on hand</p>
          <div className="card card-list">
            {tracked.map((p) => (
              <label className="list-row" key={p.id}>
                {p.image ? (
                  <img src={p.image} alt="" width={40} height={40} className="thumb" />
                ) : (
                  <span className="well">{p.name.slice(0, 1)}</span>
                )}
                <span className="grow ellipsis">{p.name}</span>
                <input
                  className="input count"
                  inputMode="numeric"
                  placeholder="0"
                  aria-label={"How many " + p.name}
                  value={counts[p.id] ?? ""}
                  onChange={(e) =>
                    setCounts({ ...counts, [p.id]: e.target.value.replace(/\D/g, "").slice(0, 5) })
                  }
                />
              </label>
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
            <i style={{ width: `${(checked.length / checklist.length) * 100}%` }} />
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
                stock: Object.fromEntries(tracked.map((p) => [p.id, Number(counts[p.id])])),
                checked,
                ...(bookingId ? { bookingId } : {}),
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
              ? "Open shift"
              : uncounted
                ? `Count ${uncounted} more ${uncounted === 1 ? "item" : "items"}`
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
  expected,
  currency,
  onClose,
  onDismiss,
}: {
  shift: Shift;
  expected: number;
  currency: string;
  onClose: (counted: number, pin: string) => Promise<void>;
  onDismiss: () => void;
}) {
  const [count, setCount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const withPin = usePin();
  let counted: number | undefined;
  try {
    counted = count.trim() ? parseMoney(count, currency) : undefined;
  } catch {}
  return (
    <Sheet
      title={`Close shift ${shift.number}`}
      onClose={onDismiss}
      busy={busy}
      footer={
        <button
          className="btn block"
          disabled={counted === undefined || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              if (await withPin((pin) => onClose(counted!, pin))) onDismiss();
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Closing…" : "Close shift"}
        </button>
      }
    >
      <div className="tile">
        <span className="label">Expected in the drawer</span>
        <Money value={expected} currency={currency} className="big-num" />
      </div>
      <MoneyField
        label="Cash you counted"
        value={count}
        onChange={setCount}
        currency={currency}
        big
        autoFocus
      />
      {counted !== undefined && (
        <p className="strong">
          <Difference value={counted - expected} currency={currency} />
        </p>
      )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
    </Sheet>
  );
}

function ShiftDetails({
  shift,
  state,
  business,
  onDismiss,
  onSales,
}: {
  shift: Shift;
  state: RegisterState;
  business: Business;
  onDismiss: () => void;
  onSales: (focus: SalesFocus) => void;
}) {
  const totals = shiftTotals(shift, state.sales);
  const currency = shiftCurrency(shift, business);
  const when = new Intl.DateTimeFormat("en", {
    timeZone: business.timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <Sheet title={`Shift ${shift.number}`} onClose={onDismiss}>
      <p className="label">
        {when.format(new Date(shift.openedAt))} to{" "}
        {shift.closedAt && when.format(new Date(shift.closedAt))}
      </p>
      <div className="card card-list">
        {totals.methods
          .filter((m) => m.count)
          .map((m) => (
            <div className="list-row" key={m.id}>
              <span className="grow">{m.name}</span>
              <Money value={m.amount} currency={currency} />
            </div>
          ))}
        <div className="list-row">
          <span className="grow strong">Net sales</span>
          <Money value={totals.total} currency={currency} />
        </div>
      </div>
      <div className="card card-list">
        <div className="list-row">
          <span className="grow">Opening cash</span>
          <Money value={shift.openingCash} currency={currency} />
        </div>
        <div className="list-row">
          <span className="grow">Expected cash</span>
          <Money value={totals.expectedCash} currency={currency} />
        </div>
        {shift.countedCash !== undefined && (
          <div className="list-row">
            <span className="grow">Counted</span>
            <Money value={shift.countedCash} currency={currency} />
          </div>
        )}
        {shift.difference !== undefined && (
          <div className="list-row">
            <span className="grow">Difference</span>
            <Difference value={shift.difference} currency={currency} />
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function ShiftScreen({
  state,
  online,
  onOpen,
  onClose,
  onSell,
  onGoMenu,
  onSchedule,
  onSales,
  demo,
}: {
  state: RegisterState;
  online: boolean;
  onOpen: (opening: Opening) => Promise<void>;
  onClose: (countedCash: number, pin: string) => Promise<void>;
  onSell: () => void;
  onGoMenu: () => void;
  onSchedule: () => void;
  onSales: (focus: SalesFocus) => void;
  demo: boolean;
}) {
  const [closing, setClosing] = useState(false);
  const [detail, setDetail] = useState<Shift | null>(null);
  const business = state.business!;
  const shift = state.shift && !state.shift.closedAt ? state.shift : null;
  const totals = shift ? shiftTotals(shift, state.sales) : null;
  const total = useCountUp(totals?.total ?? 0);
  const currency = shiftCurrency(shift ?? undefined, business);
  const external = Boolean(shift && shift.deviceId !== state.deviceId);
  const canClose = online && !state.pending.length && !external;
  const history = [
    ...new Map(
      [...state.shifts, ...(state.shift ? [state.shift] : [])].map((s) => [s.id, s]),
    ).values(),
  ]
    .filter((s) => s.closedAt)
    .sort((a, b) => b.number - a.number);
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
              {formatMoney(shift.openingCash, currency)} opening +{" "}
              {formatMoney(totals.cash, currency)} cash sales
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
          {shift.stock && Object.keys(shift.stock).length > 0 && (
            <div className="stack gap-10">
              <p className="group-title">Stock left</p>
              <div className="card card-list">
                {Object.entries(stockLeft(shift, state.sales)).map(([id, left]) => {
                  const p = shift.menu.find((m) => m.id === id);
                  const opened = shift.stock![id];
                  return (
                    <div className="list-row" key={id}>
                      <span className="grow stack">
                        <span className="ellipsis">{p?.name ?? "Item"}</span>
                        <span className="meter" aria-hidden="true">
                          <i style={{ width: `${opened ? Math.max(0, left / opened) * 100 : 0}%` }} />
                        </span>
                      </span>
                      <span className={"num" + (left <= 0 ? " g" : "")}>
                        {left <= 0 ? "Sold out" : `${left} of ${opened}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {shift.bookingId && (state.bookings ?? []).some((b) => b.id === shift.bookingId) && (
            <button className="notice" onClick={onSchedule}>
              <CalendarDays size={18} strokeWidth={1.8} />
              <span className="grow" style={{ textAlign: "left" }}>
                For {bookingTitle(state.bookings!.find((b) => b.id === shift.bookingId)!)}
              </span>
              <ChevronRight size={18} className="chev" />
            </button>
          )}
          <div className="stack gap-10">
            <p className="group-title">By payment</p>
            <div className="card card-list">
              {!totals.count && (
                <p className="label" style={{ padding: "18px 0" }}>
                  No sales yet this shift.
                </p>
              )}
              {totals.methods.filter((m) => m.count).map((m) => (
                <div className="list-row" key={m.id}>
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
                </div>
              ))}
            </div>
          </div>
          {external ? (
            <p className="notice">This shift is open on another phone. Close it there.</p>
          ) : (
            <div className="stack gap-8">
              <button className="btn block" disabled={!canClose} onClick={() => setClosing(true)}>
                Count drawer and close
              </button>
              {!canClose && (
                <p className="label" style={{ textAlign: "center" }}>
                  {online ? "Waiting for sales to sync." : "Connect to close the shift."}
                </p>
              )}
              <button className="btn ghost compact" onClick={onSell}>
                Back to selling
              </button>
            </div>
          )}
        </>
      ) : (
        <OpenShift state={state} online={online} onOpen={onOpen} onGoMenu={onGoMenu} />
      )}
      {history.length > 0 && (
        <div className="stack gap-10">
          <p className="group-title">Past shifts</p>
          <div className="card card-list">
            {history.slice(0, 30).map((s) => {
              const t = shiftTotals(s, state.sales);
              return (
                <button key={s.id} className="list-row" onClick={() => setDetail(s)}>
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
          expected={totals.expectedCash}
          currency={currency}
          onClose={onClose}
          onDismiss={() => setClosing(false)}
        />
      )}
      {detail && (
        <ShiftDetails
          shift={detail}
          state={state}
          business={business}
          onDismiss={() => setDetail(null)}
          onSales={(f) => {
            setDetail(null);
            onSales(f);
          }}
        />
      )}
    </div>
  );
}
