"use client";

import { useState } from "react";
import { ChevronRight, Wallet } from "lucide-react";
import type { Business, RegisterState, Shift } from "@/lib/types";
import { parseMoney, shiftTotals } from "@/lib/domain";
import { currencyDigits } from "@/lib/settings";
import { shiftCurrency } from "./receipt";
import {
  errorText,
  formatMoney,
  MethodIcon,
  Money,
  MoneyField,
  Sheet,
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

function OpenShift({
  state,
  online,
  onOpen,
  onGoMenu,
}: {
  state: RegisterState;
  online: boolean;
  onOpen: (openingCash: number) => Promise<void>;
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
  let value: number | undefined;
  try {
    value = amount.trim() ? parseMoney(amount, currency) : undefined;
  } catch {}
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
        Count the drawer. <span className="g">Then open the shift.</span>
      </h1>
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
          disabled={!online || busy || value === undefined}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onOpen(value!);
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
              : `Open with ${formatMoney(value, currency)}`}
        </button>
      </div>
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
}: {
  shift: Shift;
  state: RegisterState;
  business: Business;
  onDismiss: () => void;
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
}: {
  state: RegisterState;
  online: boolean;
  onOpen: (openingCash: number) => Promise<void>;
  onClose: (countedCash: number, pin: string) => Promise<void>;
  onSell: () => void;
  onGoMenu: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const [detail, setDetail] = useState<Shift | null>(null);
  const business = state.business!;
  const shift = state.shift && !state.shift.closedAt ? state.shift : null;
  const totals = shift ? shiftTotals(shift, state.sales) : null;
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
            <Money value={totals.total} currency={currency} />{" "}
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
          <div className="stack gap-10">
            <p className="group-title">By payment</p>
            <div className="card card-list">
              {totals.methods.map((m) => (
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
        />
      )}
    </div>
  );
}
