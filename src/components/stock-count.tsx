import { useId, useRef, useState, type ComponentProps, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { round, unitText } from "@/lib/stock";
import type { StockItem } from "@/lib/types";

export function countOf(text: string | undefined) {
  const t = (text ?? "").trim();
  if (!t || t === ".") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? round(n) : undefined;
}

function StockQuantityInput({
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
  title,
  items,
  counts,
  uncounted,
  expected,
  onChange,
}: {
  title: string;
  items: StockItem[];
  counts: Record<string, string>;
  uncounted: number;
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
  const next = items[index + 1] ?? items.find((other) =>
    other.id !== item.id && countOf(counts[other.id]) === undefined,
  );

  function edit(itemId: string) {
    // Commit the label, value and keypad before focusing within the same tap.
    flushSync(() => setActiveId(itemId));
    input.current?.focus();
    input.current?.select();
  }

  function advance() {
    if (!hasCount) return;
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
    <section className="stack gap-10" aria-labelledby={id + "-title"}>
      <div className="between section-head">
        <h2 className="group-title stock-count-title" id={id + "-title"}>{title}</h2>
        <span className="label">{items.length - uncounted} of {items.length} counted</span>
      </div>
      <div className="card card-pad stack gap-12">
        <label className="stock-count-item stack gap-6" htmlFor={id} aria-live="polite" aria-atomic="true">
          <span className="stock-count-name">{item.name}</span>
          {expected ? (
            <span className="label" id={id + "-expected"}>Expected {unitText(Math.max(0, expected[item.id] ?? 0), item.unit)}</span>
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
            aria-describedby={expected ? id + "-expected" : undefined}
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
          <button className="btn compact" type="button" disabled={!hasCount} onMouseDown={keepKeypad} onClick={advance}>
            {next ? "Next" : "Review"}
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
              {count === undefined
                ? <span className="label">Not counted</span>
                : <span className="strong">{unitText(count, row.unit)}</span>}
              <ChevronRight className="chev" size={16} aria-hidden="true" />
            </button>
          );
        })}
      </details>
    </section>
  );
}
