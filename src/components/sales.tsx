"use client";

import { useState } from "react";
import { ChevronRight, ReceiptText, Search, X } from "lucide-react";
import type { RegisterState, Shift } from "@/lib/types";
import { ReceiptSheet, receiptNumber, shiftCurrency } from "./receipt";
import { formatMoney, Money } from "./ui";

/** Narrow the sales list to some tills, and optionally one item, from a shift's summary. */
export interface SalesFocus {
  shiftIds: string[];
  productId?: string;
  label: string;
}

export function SalesScreen({
  state,
  online,
  onReverse,
  onSell,
  focus,
  onFocus,
}: {
  state: RegisterState;
  online: boolean;
  onReverse: (saleId: string, reason: string, pin: string) => Promise<void>;
  onSell: () => void;
  focus: SalesFocus | null;
  onFocus: (focus: SalesFocus | null) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [scope, setScope] = useState<"shift" | "all">("shift");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const business = state.business!;
  const shift = state.shift && !state.shift.closedAt ? state.shift : null;
  const shifts = new Map<string, Shift>(
    [...state.shifts, ...(state.shift ? [state.shift] : [])].map((s) => [s.id, s]),
  );
  const pending = new Set(state.pending.map((e) => e.id));
  const mine = Boolean(shift && shift.deviceId === state.deviceId);
  const canReverse = Boolean(online && mine && state.pending.length === 0);
  const listScope = focus ? "all" : shift ? scope : "all";
  const q = query.trim().toLowerCase();
  const sales = [...state.sales]
    .filter((s) => !focus || focus.shiftIds.includes(s.shiftId))
    .filter((s) => !focus?.productId || s.lines.some((l) => l.productId === focus.productId))
    .filter((s) => listScope === "all" || s.shiftId === shift!.id)
    .filter((s) => shifts.has(s.shiftId))
    .filter((s) => {
      if (!q) return true;
      const sh = shifts.get(s.shiftId)!;
      return (
        receiptNumber(sh.number, s.sequence) +
        " " +
        s.payment.name +
        " " +
        s.lines.map((l) => l.name).join(" ")
      )
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const live = sales.filter((s) => !s.reversedAt);
  const sum = live.reduce((t, s) => t + s.total, 0);
  const currency = shiftCurrency(shift ?? undefined, business);
  const time = new Intl.DateTimeFormat("en", {
    timeZone: business.timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  const day = new Intl.DateTimeFormat("en", {
    timeZone: business.timeZone,
    month: "short",
    day: "numeric",
  });
  const open = state.sales.find((s) => s.id === openId);
  const openShift = open && shifts.get(open.shiftId);
  return (
    <div className="page">
      <div className="page-top">
        <h1 className="headline grow">
          {sales.length ? (
            <>
              <Money value={sum} currency={currency} />{" "}
              <span className="g">
                from {live.length} {live.length === 1 ? "sale" : "sales"}
                {focus ? "." : listScope === "shift" ? " this shift." : "."}
              </span>
            </>
          ) : (
            <>
              Sales <span className="g">show up here.</span>
            </>
          )}
        </h1>
        {state.sales.length > 0 && (
          <button
            className="round"
            aria-label="Search receipts"
            aria-pressed={searching}
            onClick={() => {
              setSearching(!searching);
              setQuery("");
            }}
          >
            {searching ? <X size={19} /> : <Search size={19} />}
          </button>
        )}
      </div>
      {searching && (
        <input
          className="input"
          type="search"
          autoFocus
          placeholder="Receipt number, item or payment"
          aria-label="Search receipts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {focus && (
        <div className="chips" role="group" aria-label="Filter">
          <button type="button" aria-pressed="true" onClick={() => onFocus(null)}>
            {focus.label} <X size={14} aria-label="Show all sales" />
          </button>
        </div>
      )}
      {!focus && shift && state.sales.some((s) => s.shiftId !== shift.id) && (
        <div className="segmented" role="group" aria-label="Show">
          <button aria-pressed={scope === "shift"} onClick={() => setScope("shift")}>
            This shift
          </button>
          <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>
            All shifts
          </button>
        </div>
      )}
      {sales.length ? (
        <div className="card card-list">
          {sales.map((sale) => {
            const sh = shifts.get(sale.shiftId)!;
            const items = sale.lines
              .map((l) => (l.quantity > 1 ? l.quantity + "× " : "") + l.name)
              .join(", ");
            const when = new Date(sale.createdAt);
            return (
              <button
                key={sale.id}
                className="list-row"
                onClick={() => setOpenId(sale.id)}
                aria-label={`Receipt ${receiptNumber(sh.number, sale.sequence)}, ${formatMoney(sale.total, shiftCurrency(sh, business))}`}
              >
                <span className="grow stack gap-4">
                  <span className="ellipsis" style={{ fontWeight: 500 }}>
                    {items}
                  </span>
                  <span className="label row gap-6">
                    {sale.reversedAt ? (
                      <>
                        <span className="dot danger" /> Reversed ·
                      </>
                    ) : pending.has(sale.id) ? (
                      <>
                        <span className="dot" /> Not synced ·
                      </>
                    ) : null}
                    <span className="ellipsis">
                      {listScope === "all" ? day.format(when) + ", " : ""}
                      {time.format(when)} · {sale.payment.name}
                      {sale.discount ? " · " + sale.discount.name : ""}
                    </span>
                  </span>
                </span>
                <span className="end">
                  <Money
                    value={sale.total}
                    currency={shiftCurrency(sh, business)}
                    className={sale.reversedAt ? "struck" : ""}
                  />
                </span>
                <ChevronRight size={18} className="chev" />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty card">
          <span className="well">
            <ReceiptText size={22} />
          </span>
          <p className="strong">{q ? "No receipts match" : "No sales yet"}</p>
          <p className="label">
            {q
              ? "Try a receipt number like #3-012, an item, or GCash."
              : "Every sale you ring up lands here with its receipt."}
          </p>
          {!q && mine && (
            <button className="btn compact" style={{ marginTop: 8 }} onClick={onSell}>
              Start selling
            </button>
          )}
        </div>
      )}
      {open && openShift && (
        <ReceiptSheet
          sale={open}
          shift={openShift}
          business={business}
          pending={pending.has(open.id)}
          pastReasons={Array.from(
            new Set(
              state.sales
                .filter((s) => s.reversedAt && s.reason)
                .sort((a, b) => (b.reversedAt ?? "").localeCompare(a.reversedAt ?? ""))
                .map((s) => s.reason!.trim()),
            ),
          ).slice(0, 3)}
          canReverse={canReverse && open.shiftId === shift?.id}
          reverseBlocked={
            open.shiftId !== shift?.id
              ? undefined
              : !mine
                ? "Reverse it on the phone running this shift."
                : !online
                  ? "Connect to reverse a sale."
                  : state.pending.length
                    ? "Waiting for sales to sync first."
                    : undefined
          }
          onReverse={(reason, pin) => onReverse(open.id, reason, pin)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
