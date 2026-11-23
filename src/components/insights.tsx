"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { bestSellers, salesByHour } from "@/lib/insights";
import type { Product, RegisterState } from "@/lib/types";
import { ShiftRecordList, type ShiftRecordStatus } from "./shift-record-list";
import { buzz, EmptyRow, formatMoney, Money, progressStyle, Sheet } from "./ui";
import styles from "./operations.module.css";

const hourName = (h: number) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;

/** Sales by hour as bars, with the busiest hour in black. */
export function HourChart({
  hours,
  currency,
  title = "By hour",
  amountsHidden = false,
}: {
  hours: { hour: number; total: number }[];
  currency: string;
  title?: string;
  amountsHidden?: boolean;
}) {
  if (hours.length < 2) return null;
  const peak = Math.max(...hours.map((h) => h.total), 1);
  const busiest = hours.reduce((a, b) => (b.total > a.total ? b : a), hours[0]);
  return (
    <div className="card card-pad stack gap-12">
      <div className="between">
        <span className="label">{title}</span>
        <span className="label">
          Busiest {hourName(busiest.hour)} ·{" "}
          {amountsHidden ? (
            <>
              <span aria-hidden="true">****</span>
              <span className="sr-only">Amount hidden</span>
            </>
          ) : formatMoney(busiest.total, currency)}
        </span>
      </div>
      <div className={`hours ${styles.hourBars}`} role="img" aria-label={`Sales by hour, busiest at ${hourName(busiest.hour)}`}>
        {hours.map((h) => (
          <span key={h.hour} className="hour">
            <i
              className={h.hour === busiest.hour ? "peak" : ""}
              style={{ transform: `scaleY(${Math.max(0.04, h.total / peak)})` }}
            />
            <small>{h.hour % 3 === 0 || hours.length <= 8 ? hourName(h.hour) : ""}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

/** What sold on some tills: the top items and the busy hours. Tapping opens those receipts. */
export function ShiftSales({
  state,
  shiftIds,
  menu,
  currency,
  title,
  onAllSales,
  onSales,
}: {
  state: RegisterState;
  shiftIds: string[];
  menu: Product[];
  currency: string;
  /** The shift's name, for the item sheet. */
  title: string;
  onAllSales: () => void;
  /** Opens the Sales tab filtered to one item in this shift. */
  onSales?: (productId: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const zone = state.business!.timeZone;
  const sellers = useMemo(() => bestSellers(state.sales, shiftIds), [state.sales, shiftIds]);
  const hours = useMemo(() => salesByHour(state.sales, shiftIds, zone), [state.sales, shiftIds, zone]);
  const count = state.sales.filter((s) => shiftIds.includes(s.shiftId) && !s.reversedAt).length;
  if (!sellers.length) return null;
  const top = sellers[0].quantity;
  const image = (id: string) => menu.find((p) => p.id === id)?.image;
  return (
    <div className="stack gap-10">
      <div className="between section-head">
        <p className="group-title">Best sellers</p>
        <button type="button" className="link small-link" aria-haspopup="dialog" onClick={onAllSales}>
          All {count} {count === 1 ? "sale" : "sales"} <ChevronRight size={14} aria-hidden />
        </button>
      </div>
      <div className="card card-list">
        {sellers.slice(0, 5).map((s, i) => (
          <button
            key={s.productId}
            type="button"
            className="list-row seller"
            aria-haspopup="dialog"
            onClick={() => {
              buzz.tap();
              setPicked(s.productId);
            }}
          >
            <span className={"rank-num" + (i === 0 ? " first" : "")}>{i + 1}</span>
            {image(s.productId) ? (
              <img src={image(s.productId)} alt="" width={36} height={36} className="thumb small" />
            ) : null}
            <span className="grow stack gap-4">
              <span className="between gap-8">
                <span className="ellipsis">{s.name}</span>
                <span className="num">{s.quantity} sold</span>
              </span>
              <span className="bar" aria-hidden="true">
                <i style={progressStyle((s.quantity / top) * 100)} />
              </span>
              <span className="label">{formatMoney(s.revenue, currency)}</span>
            </span>
          </button>
        ))}
      </div>
      <HourChart hours={hours} currency={currency} />
      {picked && (
        <ItemSales
          state={state}
          shiftIds={shiftIds}
          productId={picked}
          title={title}
          currency={currency}
          onClose={() => setPicked(null)}
          onSales={onSales && (() => onSales(picked))}
        />
      )}
    </div>
  );
}

type Receipts = RegisterState["sales"];

/** A breakdown over whatever is open: one big number, a line saying what it is, and the receipts behind it. */
export function SalesSheet({
  state,
  title,
  amount,
  summary,
  status,
  sales,
  currency,
  onClose,
  onSales,
}: {
  state: RegisterState;
  title: string;
  amount: number;
  summary: string;
  status?: ShiftRecordStatus;
  sales: Receipts;
  currency: string;
  onClose: () => void;
  onSales?: () => void;
}) {
  const time = new Intl.DateTimeFormat("en", { timeZone: state.business!.timeZone, hour: "numeric", minute: "2-digit" });
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        onSales && (
          <button type="button" className="btn block" onClick={onSales}>
            See in Sales
          </button>
        )
      }
    >
      <div className="stack gap-4">
        <Money value={amount} currency={currency} className="big-num" />
        <p className="muted">{summary}</p>
      </div>
      <ShiftRecordList
        label="Sales receipts"
        status={status}
        hasRecords={sales.length > 0}
        empty={<EmptyRow object="salesReceipt" title="No sales yet" detail="Sales recorded for this shift will show here." />}
      >
        {sales.map((sale) => (
          <div key={sale.id} className="list-row">
            <span className="grow stack gap-4" style={{ minWidth: 0 }}>
              <span className="ellipsis">
                {sale.lines.map((l) => (l.quantity > 1 ? l.quantity + "× " : "") + l.name).join(", ")}
              </span>
              <span className="label">
                {time.format(new Date(sale.createdAt))} · {sale.payment.name}
              </span>
            </span>
            <Money value={sale.total} currency={currency} />
          </div>
        ))}
      </ShiftRecordList>
    </Sheet>
  );
}

export const shiftReceipts = (state: RegisterState, shiftIds: string[]) =>
  state.sales
    .filter((s) => shiftIds.includes(s.shiftId) && !s.reversedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** One item, over the shift or till sheet: how it did and the receipts it was on. Closing returns to where you were. */
export function ItemSales({
  state,
  shiftIds,
  productId,
  title,
  currency,
  onClose,
  onSales,
}: {
  state: RegisterState;
  shiftIds: string[];
  productId: string;
  title: string;
  currency: string;
  onClose: () => void;
  onSales?: () => void;
}) {
  const seller = bestSellers(state.sales, shiftIds).find((s) => s.productId === productId);
  const sales = shiftReceipts(state, shiftIds).filter((s) => s.lines.some((l) => l.productId === productId));
  if (!seller) return null;
  return (
    <SalesSheet
      state={state}
      title={seller.name}
      amount={seller.revenue}
      summary={`${seller.quantity} sold at ${title}, in ${sales.length} ${sales.length === 1 ? "sale" : "sales"}`}
      sales={sales}
      currency={currency}
      onClose={onClose}
      onSales={onSales}
    />
  );
}

/** One payment method over the till: what came in that way and the receipts. */
export function PaymentSales({
  state,
  shiftIds,
  method,
  title,
  currency,
  onClose,
  onSales,
}: {
  state: RegisterState;
  shiftIds: string[];
  method: { id: string; name: string };
  title: string;
  currency: string;
  onClose: () => void;
  onSales?: () => void;
}) {
  const sales = shiftReceipts(state, shiftIds).filter((s) => s.payment.id === method.id);
  if (!sales.length) return null;
  return (
    <SalesSheet
      state={state}
      title={method.name}
      amount={sales.reduce((t, s) => t + s.total, 0)}
      summary={`${sales.length} ${sales.length === 1 ? "sale" : "sales"} at ${title}`}
      sales={sales}
      currency={currency}
      onClose={onClose}
      onSales={onSales}
    />
  );
}

/** The till's items by how many sold: the top few, with the rest a tap away. Each opens its own breakdown. */
export function ItemsSold({
  state,
  shiftIds,
  menu,
  currency,
  title,
  onSales,
}: {
  state: RegisterState;
  shiftIds: string[];
  menu: Product[];
  currency: string;
  title: string;
  onSales: (productId: string) => void;
}) {
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const sellers = useMemo(() => bestSellers(state.sales, shiftIds), [state.sales, shiftIds]);
  const shown = all ? sellers : sellers.slice(0, 5);
  return (
    <div className="stack gap-10">
      <p className="group-title">Items sold</p>
      <div className="card card-list">
        {!sellers.length && (
          <EmptyRow object="itemsSold" title="No sales yet" detail="Each item adds up here as you sell." />
        )}
        {shown.map((s) => {
          const image = menu.find((p) => p.id === s.productId)?.image;
          return (
            <button
              key={s.productId}
              type="button"
              className="list-row"
              aria-haspopup="dialog"
              onClick={() => {
                buzz.tap();
                setPicked(s.productId);
              }}
            >
              {image ? (
                <img src={image} alt="" width={36} height={36} className="thumb small" />
              ) : (
                <span className="well">{s.name.trim().slice(0, 1).toUpperCase()}</span>
              )}
              <span className="grow stack">
                <span className="ellipsis">{s.name}</span>
                <span className="label">{s.quantity} sold</span>
              </span>
              <Money value={s.revenue} currency={currency} />
              <ChevronRight size={18} className="chev" />
            </button>
          );
        })}
        {sellers.length > 5 && (
          <button type="button" className="list-row" onClick={() => setAll(!all)} aria-expanded={all}>
            <span className="grow">{all ? "Show less" : `Show ${sellers.length - 5} more`}</span>
            <ChevronDown size={18} className={`chev ${styles.disclosure}`} />
          </button>
        )}
      </div>
      {picked && (
        <ItemSales
          state={state}
          shiftIds={shiftIds}
          productId={picked}
          title={title}
          currency={currency}
          onClose={() => setPicked(null)}
          onSales={() => {
            setPicked(null);
            onSales(picked);
          }}
        />
      )}
    </div>
  );
}
