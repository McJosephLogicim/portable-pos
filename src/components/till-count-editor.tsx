"use client";

import { useState } from "react";
import { parseMoney, stockLeft, validCount } from "@/lib/domain";
import { round, unitText } from "@/lib/stock";
import { tillStockItems, type TillCount } from "@/lib/till-counts";
import type { RegisterState, Shift } from "@/lib/types";
import { blocked } from "@/lib/reject";
import { CashCounter, type CashValue } from "./cash-count";
import { useRecordSave } from "./records";
import { countOf, StockQuantityInput } from "./stock-count";
import { formatMoney, MoneyField, Sheet } from "./ui";

export function TillCountEditor({ kind, shift, state, currency, onSave, onClose }: {
  kind: TillCount["kind"];
  shift: Shift;
  state: RegisterState;
  currency: string;
  onSave: (change: TillCount, requestId: string) => Promise<void>;
  onClose: () => void;
}) {
  // Keep the values seen at entry so a refresh cannot silently overwrite a newer count.
  const [initial] = useState(() => ({
    shift,
    requestId: crypto.randomUUID(),
    items: tillStockItems(shift, state.business?.settings.stockItems),
    left: stockLeft(shift, state.sales),
    newId: crypto.randomUUID(),
  }));
  const [itemId, setItemId] = useState(initial.items[0]?.id ?? initial.newId);
  const item = initial.items.find((entry) => entry.id === itemId);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("piece");
  const [mode, setMode] = useState<"add" | "set">(kind === "float" ? "set" : "add");
  const [quantity, setQuantity] = useState("");
  const [cash, setCash] = useState<CashValue>({});
  const { busy, error, run } = useRecordSave(onClose);
  const isCash = kind === "float";
  const previous = isCash ? initial.shift.openingCash : initial.left[itemId] ?? null;
  let entered = countOf(quantity);
  if (isCash && mode === "add") {
    try { entered = quantity.trim() ? parseMoney(quantity, currency) : undefined; } catch { entered = undefined; }
  } else if (isCash) entered = cash.amount;
  const amount = entered === undefined ? undefined : mode === "add" ? round((previous ?? 0) + entered) : entered;
  const display = (n: number) => isCash ? formatMoney(n, currency) : unitText(round(n), item?.unit ?? unit);
  const reason = !isCash && !item && (!name.trim() || !unit.trim()) ? "Enter an item name and unit."
    : amount === undefined ? "Enter an amount."
    : mode === "add" && !entered ? "Enter an amount to add."
    : !isCash && !validCount(amount) ? "Enter a stock count from 0 to 1,000,000."
    : isCash && amount > 2147483647 ? "Amount is too large." : false;

  function select(nextId: string, nextMode: typeof mode) {
    setItemId(nextId);
    setMode(nextMode);
    const left = initial.left[nextId];
    setQuantity(!isCash && nextMode === "set" && left !== undefined ? String(round(Math.max(0, left))) : "");
  }

  return (
    <Sheet title={isCash ? "Cash float" : "Adjust stock"} onClose={onClose} busy={busy}
      footer={<button className="btn block" disabled={busy} {...blocked(reason)} onClick={() => void run(async () => {
        if (amount === undefined) return false;
        await onSave(isCash
          ? { kind: "float", previous: initial.shift.openingCash, previousCount: initial.shift.openingCount, amount, count: mode === "set" ? cash.count : undefined }
          : { kind: "stock", stockId: itemId, previous, amount, ...(!item ? { newItem: { name: name.trim(), unit: unit.trim() } } : {}) }, initial.requestId);
        return true;
      })}>{busy ? "Saving…" : "Save changes"}</button>}
    >
      {!isCash && (
        <label className="field">Stock item
          <select className="input" value={itemId} onChange={(e) => select(e.target.value, mode)}>
            {initial.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            <option value={initial.newId}>New item for this till</option>
          </select>
        </label>
      )}
      {!isCash && !item && <>
        <label className="field">Item name<input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">Counted in<input className="input" maxLength={16} value={unit} onChange={(e) => setUnit(e.target.value)} /></label>
      </>}
      {previous !== null && <p className="between"><span className="label">{isCash ? "Current float" : "On hand"}</span><strong>{display(previous)}</strong></p>}
      <div className="segmented" role="group" aria-label="Adjustment">
        <button type="button" aria-pressed={mode === "add"} onClick={() => mode !== "add" && select(itemId, "add")}>Add</button>
        <button type="button" aria-pressed={mode === "set"} onClick={() => mode !== "set" && select(itemId, "set")}>Set total</button>
      </div>
      {isCash ? mode === "set"
        ? <CashCounter currency={currency} label="Cash float" initialAmount={initial.shift.openingCash} initial={initial.shift.openingCount} onChange={setCash} />
        : <MoneyField label="Cash to add" value={quantity} onChange={setQuantity} currency={currency} />
        : <label className="field">{mode === "set" ? "New count" : "Quantity to add"}
            <StockQuantityInput className="input" unit={item?.unit ?? unit} value={quantity} placeholder="0" onFocus={(e) => e.target.select()} onChange={setQuantity} />
          </label>}
      {mode === "add" && entered !== undefined && entered > 0 && amount !== undefined &&
        <p className="between"><span className="label">{isCash ? "New float" : "New count"}</span><strong>{display(amount)}</strong></p>}
      {error && <p className="alert" role="alert">{error}</p>}
    </Sheet>
  );
}
