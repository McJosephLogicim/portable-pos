"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { countTotal, denominationPhoto, denominations, type CashCount } from "@/lib/cash";
import { amountText, parseMoney } from "@/lib/domain";
import { buzz, formatMoney, MoneyField } from "./ui";

export interface CashValue {
  /** The amount, once it is known. */
  amount?: number;
  /** Coins and bills, when they were counted one by one. */
  count?: CashCount;
}

/**
 * Count cash by coin and bill, like fifteen ₱5 coins, or type the total. Used for the
 * float when a shift opens and for the cash on hand when it closes.
 */
export function CashCounter({
  currency,
  onChange,
  initial,
  initialAmount,
  label,
}: {
  currency: string;
  onChange: (value: CashValue) => void;
  initial?: CashCount;
  initialAmount?: number;
  label: string;
}) {
  const [mode, setMode] = useState<"count" | "total">(initialAmount !== undefined && !initial ? "total" : "count");
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [extra, setExtra] = useState<number[]>(() => {
    const known = new Set(denominations(currency).map((d) => d.value));
    return Object.keys(initial ?? {}).map(Number).filter((v) => !known.has(v));
  });
  const [text, setText] = useState(() => initialAmount === undefined ? "" : amountText(initialAmount, currency));
  const [adding, setAdding] = useState(false);
  const [newValue, setNewValue] = useState("");
  const [addError, setAddError] = useState("");

  const base = denominations(currency);
  const coins = [
    ...base.filter((d) => d.kind === "coin").map((d) => d.value),
    ...extra.filter((v) => v < (base.find((d) => d.kind === "bill")?.value ?? Infinity)),
  ].sort((a, b) => a - b);
  const bills = [
    ...base.filter((d) => d.kind === "bill").map((d) => d.value),
    ...extra.filter((v) => !coins.includes(v)),
  ].sort((a, b) => a - b);

  const count: CashCount = {};
  for (const [k, v] of Object.entries(qty)) if (Number(v) > 0) count[k] = Number(v);
  const counted = countTotal(count);
  let typed: number | undefined;
  try {
    typed = text.trim() ? parseMoney(text, currency) : undefined;
  } catch {}

  const key = mode === "count" ? JSON.stringify(count) : String(typed);
  useEffect(() => {
    if (mode === "count") onChange(Object.keys(count).length ? { amount: counted, count } : { amount: 0 });
    else onChange({ amount: typed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode]);

  function set(value: number, next: number) {
    setQty({ ...qty, [value]: next > 0 ? String(Math.min(next, 99999)) : "" });
  }

  function addOther() {
    setAddError("");
    try {
      const value = parseMoney(newValue, currency);
      if (!value) throw Error("Enter what one coin or bill is worth.");
      if (![...coins, ...bills].includes(value)) setExtra([...extra, value]);
      setNewValue("");
      setAdding(false);
      buzz.tick();
    } catch (e) {
      setAddError((e as Error).message);
    }
  }

  const rows = (list: number[], kind: "coin" | "bill") =>
    list.map((value) => {
      const n = Number(qty[value] || 0);
      const name = formatMoney(value, currency);
      const photo = denominationPhoto(currency, value);
      return (
        <div className="cash-row" key={value}>
          <button
            type="button"
            className={"denom " + kind + (photo ? " photo" : "")}
            aria-label={`Add one ${name} ${kind}`}
            onClick={() => {
              set(value, n + 1);
              buzz.tick();
            }}
          >
            {photo ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo} alt="" width={kind === "coin" ? 36 : 72} height={kind === "coin" ? 36 : 30} draggable={false} />
                <span>{name}</span>
              </>
            ) : (
              name
            )}
          </button>
          <div className="stepper">
            <button
              type="button"
              className="round flat"
              aria-label={`One less ${name} ${kind}`}
              disabled={!n}
              onClick={() => {
                set(value, n - 1);
                buzz.tap();
              }}
            >
              <Minus size={16} />
            </button>
            <input
              className="input count"
              inputMode="numeric"
              enterKeyHint="next"
              placeholder="0"
              aria-label={`How many ${name} ${kind}s`}
              value={qty[value] ?? ""}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setQty({ ...qty, [value]: e.target.value.replace(/\D/g, "").slice(0, 5) })}
            />
            <button
              type="button"
              className="round flat"
              aria-label={`One more ${name} ${kind}`}
              onClick={() => {
                set(value, n + 1);
                buzz.tick();
              }}
            >
              <Plus size={16} />
            </button>
          </div>
          <span className={"cash-sub num" + (n ? "" : " g")}>{n ? formatMoney(value * n, currency) : "–"}</span>
        </div>
      );
    });

  return (
    <div className="stack gap-14">
      <div className="segmented" role="group" aria-label="How to count">
        <button type="button" aria-pressed={mode === "count"} onClick={() => setMode("count")}>
          Coins and bills
        </button>
        <button type="button" aria-pressed={mode === "total"} onClick={() => setMode("total")}>
          Type the total
        </button>
      </div>
      {mode === "total" ? (
        <MoneyField label={label} value={text} onChange={setText} currency={currency} big />
      ) : (
        <>
          {coins.length > 0 && (
            <div className="stack gap-6">
              <p className="label">Coins</p>
              <div className="cash-list">{rows(coins, "coin")}</div>
            </div>
          )}
          <div className="stack gap-6">
            <p className="label">Bills</p>
            <div className="cash-list">{rows(bills, "bill")}</div>
          </div>
          {adding ? (
            <div className="stack gap-8">
              <div className="row gap-8">
                <div className="grow">
                  <MoneyField label="One coin or bill is worth" value={newValue} onChange={setNewValue} currency={currency} autoFocus />
                </div>
                <button type="button" className="btn secondary compact" style={{ alignSelf: "flex-end" }} onClick={addOther}>
                  Add
                </button>
              </div>
              {addError && (
                <p className="alert" role="alert">
                  {addError}
                </p>
              )}
            </div>
          ) : (
            <button type="button" className="link" style={{ alignSelf: "flex-start" }} onClick={() => setAdding(true)}>
              + Another coin or bill
            </button>
          )}
          <div className="cash-total">
            <span className="label">{label}</span>
            <span className="num">{formatMoney(counted, currency)}</span>
          </div>
        </>
      )}
    </div>
  );
}
