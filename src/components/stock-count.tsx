import { useId, useRef, useState, type ComponentProps, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { round, unitText } from "@/lib/stock";
import type { StockItem } from "@/lib/types";
import { Explain, Switch } from "./ui";

export function countOf(text: string | undefined) {
  const t = (text ?? "").trim();
  if (!t || t === ".") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? round(n) : undefined;
}

export function StockQuantityInput({
  unit,
  onChange,
  ...props
}: Omit<ComponentProps<"input">, "inputMode" | "onChange"> & {
  unit: string;
  onChange: (value: string) => void;
}) {
  const mode = ["kg", "g", "L", "mL"].includes(unit) ? "decimal" : "numeric";
  return (
    <input
      key={mode}
      {...props}
      inputMode={mode}
      onChange={(e) => {
        const text = e.target.value;
        onChange(mode === "decimal"
          ? text.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 9)
          : text.replace(/\D/g, "").slice(0, 6));
      }}
    />
  );
}

export function StockCount({
  item,
  value,
  onChange,
}: {
  item: StockItem;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="list-row">
      <span className="well">{item.name.slice(0, 1).toUpperCase()}</span>
      <span className="grow stack">
        <span className="ellipsis">{item.name}</span>
        <span className="label">{item.unit}</span>
      </span>
      <StockQuantityInput
        className="input count"
        unit={item.unit}
        enterKeyHint="next"
        placeholder="0"
        aria-label={`How many ${item.unit} of ${item.name}`}
        value={value}
        onChange={onChange}
      />
    </label>
  );
}

/** The shift keeps its counts while the seller moves through one shared field. */
export function ShiftStockCount({
  items,
  counts,
  expected,
  onChange,
}: {
  items: StockItem[];
  counts: Record<string, string>;
  /** What the till expects, by stock item id. An item left uncounted keeps it. */
  expected?: Record<string, number>;
  onChange: (id: string, value: string) => void;
}) {
  const [activeId, setActiveId] = useState(items[0].id);
  const input = useRef<HTMLInputElement>(null);
  const review = useRef<HTMLDetailsElement>(null);
  const reviewSummary = useRef<HTMLElement>(null);
  const id = useId();
  const index = Math.max(0, items.findIndex((item) => item.id === activeId));
  const item = items[index];
  const value = counts[item.id] ?? "";
  const hasCount = countOf(value) !== undefined;
  const previous = items[index - 1];
  // Counting is optional, so an item can be skipped and the count moves on in order.
  const next = items[index + 1];

  function edit(itemId: string) {
    // Commit the label, value and keypad before focusing within the same tap.
    flushSync(() => setActiveId(itemId));
    input.current?.focus();
    input.current?.select();
  }

  function advance() {
    if (next) {
      edit(next.id);
    } else if (review.current) {
      review.current.open = true;
      reviewSummary.current?.focus();
    }
  }

  function keepKeypad(event: MouseEvent<HTMLButtonElement>) {
    if (document.activeElement === input.current) event.preventDefault();
  }

  return (
    <div className="stack gap-10">
      <div className="card card-pad stack gap-12">
        <label className="stock-count-item stack gap-6" htmlFor={id} aria-live="polite" aria-atomic="true">
          <span className="stock-count-name">{item.name}</span>
          {expected?.[item.id] !== undefined ? (
            <span className="label" id={id + "-expected"}>Expected {unitText(Math.max(0, expected[item.id]), item.unit)}</span>
          ) : (
            <span className="label">{item.unit}</span>
          )}
        </label>
        <div className="stock-count-controls" data-input-options="">
          <button
            className="round flat"
            type="button"
            aria-label="Previous stock item"
            disabled={!previous}
            onMouseDown={keepKeypad}
            onClick={() => previous && edit(previous.id)}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <StockQuantityInput
            id={id}
            ref={input}
            className="input stock-count-value"
            unit={item.unit}
            aria-label={`How many ${item.unit} of ${item.name}`}
            aria-describedby={expected?.[item.id] !== undefined ? id + "-expected" : undefined}
            enterKeyHint={next ? "next" : "done"}
            placeholder="Count"
            value={value}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(text) => onChange(item.id, text)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              advance();
            }}
          />
          <button className={`btn compact ${hasCount || !next ? "secondary" : "ghost"}`} type="button" onMouseDown={keepKeypad} onClick={advance}>
            {next ? (hasCount ? "Next" : "Skip") : "Review"}
          </button>
        </div>
      </div>
      <details className="card card-list stock-count-review" ref={review}>
        <summary className="list-row between" ref={reviewSummary}>
          Review counts
          <ChevronDown className="chev" size={18} aria-hidden="true" />
        </summary>
        {items.map((row) => {
          const count = countOf(counts[row.id]);
          return (
            <button
              key={row.id}
              className="list-row"
              type="button"
              aria-current={row.id === item.id ? "true" : undefined}
              onClick={() => {
                if (review.current) review.current.open = false;
                edit(row.id);
              }}
            >
              <span className="grow">{row.name}</span>
              {count !== undefined
                ? <span className="strong">{unitText(count, row.unit)}</span>
                : expected?.[row.id] !== undefined
                  ? <span className="label">Keeps {unitText(Math.max(0, expected[row.id]), row.unit)}</span>
                  : <span className="label">Not counted</span>}
              <ChevronRight className="chev" size={16} aria-hidden="true" />
            </button>
          );
        })}
      </details>
    </div>
  );
}

/**
 * Menu items set to "Count it" are always counted at opening and closing. Counting stock
 * and prep items is optional. Left off, the till keeps what it expects: the saved amounts
 * at opening, what sales left at closing.
 */
export function OptionalStockCount({
  title,
  items,
  required,
  counts,
  expected,
  on,
  help,
  onToggle,
  onChange,
}: {
  title: string;
  items: StockItem[];
  /** Ids that must be counted: menu items set to "Count it". */
  required: Set<string>;
  counts: Record<string, string>;
  expected?: Record<string, number>;
  on: boolean;
  help: string;
  onToggle: (on: boolean) => void;
  onChange: (id: string, value: string) => void;
}) {
  const optional = items.filter((item) => !required.has(item.id));
  const shown = on ? items : items.filter((item) => required.has(item.id));
  const counted = shown.filter((item) => countOf(counts[item.id]) !== undefined).length;
  return (
    <section className="stack gap-10" aria-label={title}>
      <div className="between section-head">
        <h2 className="group-title stock-count-title">{title}</h2>
        {shown.length > 0 && <span className="label">{counted} of {shown.length} counted</span>}
      </div>
      {optional.length > 0 && (
        <div className="card card-pad between gap-12">
          <span className="row gap-6">
            {optional.length < items.length ? "Count stock and prep too" : "Count stock and prep"}
            <Explain title={title}>{help}</Explain>
          </span>
          <Switch checked={on} onChange={onToggle} label="Count stock and prep" />
        </div>
      )}
      {!on && optional.length > 0 && (
        <details className="card card-list stock-count-review">
          <summary className="list-row between">
            Stock and prep
            <ChevronDown className="chev" size={18} aria-hidden="true" />
          </summary>
          {optional.map((item) => (
            <div key={item.id} className="list-row">
              <span className="grow ellipsis">{item.name}</span>
              {expected?.[item.id] !== undefined
                ? <span className="strong">{unitText(Math.max(0, expected[item.id]), item.unit)}</span>
                : <span className="label">Not tracked</span>}
            </div>
          ))}
        </details>
      )}
      {shown.length > 0 && (
        <ShiftStockCount key={on ? "all" : "required"} items={shown} counts={counts} expected={expected} onChange={onChange} />
      )}
    </section>
  );
}

/** Only the stock items given a count. */
export function countedOnly(items: StockItem[], counts: Record<string, string>) {
  return Object.fromEntries(items.flatMap((i) => {
    const n = countOf(counts[i.id]);
    return n === undefined ? [] : [[i.id, n]];
  }));
}
