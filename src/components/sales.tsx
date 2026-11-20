"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, ReceiptText, Search, SlidersHorizontal, X } from "lucide-react";
import type { Booking, RegisterState, Shift } from "@/lib/types";
import { HourChart } from "./insights";
import { bestSellers, salesByHour } from "@/lib/insights";
import { isSimpleMode } from "@/lib/settings";
import {
  activeCount,
  filterKeys,
  filterNames,
  filterOptions,
  matchesFilter,
  saleFacets,
  shiftKey,
  type FilterKey,
  type FilterOption,
  type SalesFilter,
} from "@/lib/sales-filter";
import { ReceiptSheet, receiptNumber, shiftCurrency } from "./receipt";
import { buzz, formatMoney, Money, Sheet } from "./ui";

/** Opens Sales already filtered, like from a best seller on a shift, with a way back to it. */
export interface SalesFocus {
  filter: SalesFilter;
  back?: { bookingId: string; label: string };
}

export function SalesScreen({
  state,
  online,
  onReverse,
  onSell,
  focus,
  onBack,
}: {
  state: RegisterState;
  online: boolean;
  onReverse: (saleId: string, reason: string, pin: string) => Promise<void>;
  onSell: () => void;
  focus: SalesFocus | null;
  /** Back to the shift the focus came from. */
  onBack: () => void;
}) {
  const business = state.business!;
  const shift = state.shift && !state.shift.closedAt ? state.shift : null;
  const [openId, setOpenId] = useState<string | null>(null);
  // Starts on the running shift, like the till does; one tap on its chip shows everything.
  const [filter, setFilter] = useState<SalesFilter>(() => focus?.filter ?? (shift ? { shift: [shiftKey(shift)] } : {}));
  const [filtering, setFiltering] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const shifts = useMemo(
    () => new Map<string, Shift>([...state.shifts, ...(state.shift ? [state.shift] : [])].map((s) => [s.id, s])),
    [state.shifts, state.shift],
  );
  const bookings = useMemo(() => new Map<string, Booking>((state.bookings ?? []).map((b) => [b.id, b])), [state.bookings]);
  const all = useMemo(
    () =>
      state.sales
        .filter((s) => shifts.has(s.shiftId))
        .map((sale) => ({ sale, facets: saleFacets(sale, shifts, bookings) })),
    [state.sales, shifts, bookings],
  );
  const options = useMemo(() => filterOptions(all, filter), [all, filter]);
  const pending = new Set(state.pending.map((e) => e.id));
  const mine = Boolean(shift);
  const canReverse = Boolean(online && mine && state.pending.length === 0);
  const q = query.trim().toLowerCase();
  const sales = all
    .filter((x) => matchesFilter(x.facets, filter))
    .map((x) => x.sale)
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
  const tills = [...new Set(live.map((x) => x.shiftId))];
  const multiDay = new Set(sales.map((s) => s.shiftId)).size > 1;
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
  const picked = filter.item ?? [];
  const items = picked.length ? bestSellers(live, tills).filter((x) => picked.includes(x.productId)) : [];
  const itemQty = items.reduce((t, x) => t + x.quantity, 0);
  const itemRevenue = items.reduce((t, x) => t + x.revenue, 0);
  const active = activeCount(filter);
  const onlyThisShift = active === 1 && Boolean(shift) && filter.shift?.[0] === shiftKey(shift!);
  const chips = filterKeys.flatMap((key) =>
    (filter[key] ?? []).map((value) => ({
      key,
      value,
      label: options[key].find((o) => o.value === value)?.label ?? value,
    })),
  );
  const open = state.sales.find((s) => s.id === openId);
  const openShift = open && shifts.get(open.shiftId);
  return (
    <div className="page">
      {focus?.back && (
        <button type="button" className="back-row" onClick={onBack}>
          <ArrowLeft size={17} />
          <span className="ellipsis">Back to {focus.back.label}</span>
        </button>
      )}
      <div className="page-top">
        <h1 className="headline grow">
          {picked.length && live.length ? (
            <>
              {itemQty} sold{" "}
              <span className="g">
                for <Money value={itemRevenue} currency={currency} />, in {live.length}{" "}
                {live.length === 1 ? "sale." : "sales."}
              </span>
            </>
          ) : sales.length ? (
            <>
              <Money value={sum} currency={currency} />{" "}
              <span className="g">
                from {live.length} {live.length === 1 ? "sale." : "sales."}
              </span>
            </>
          ) : active && !onlyThisShift ? (
            <>
              No sales <span className="g">match these filters.</span>
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
      {all.length > 0 && (
        <div className="chips filter-chips" role="group" aria-label="Filters">
          <button type="button" className="filter-open" onClick={() => setFiltering(true)}>
            <SlidersHorizontal size={15} strokeWidth={1.9} />
            {active ? "Filters · " + active : "Filter by shift, item, payment…"}
          </button>
          {chips.map((c) => (
            <button
              key={c.key + c.value}
              type="button"
              aria-label={`Remove ${filterNames[c.key].toLowerCase()} ${c.label}`}
              onClick={() => {
                buzz.tap();
                setFilter({ ...filter, [c.key]: filter[c.key]!.filter((v) => v !== c.value) });
              }}
            >
              <span className="g">{filterNames[c.key]}</span> {c.label} <X size={14} />
            </button>
          ))}
        </div>
      )}
      {!isSimpleMode(business.settings) && !searching && live.length >= 3 && (
        <HourChart
          hours={salesByHour(live, tills, business.timeZone)}
          currency={currency}
          title={active ? "These sales by hour" : "By hour, all shifts"}
        />
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
                      {multiDay ? day.format(when) + ", " : ""}
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
          <p className="strong">{q || (active && !onlyThisShift) ? "No receipts match" : "No sales yet"}</p>
          <p className="label">
            {q
              ? "Try a receipt number like #3-012, an item, or GCash."
              : active && !onlyThisShift
                ? "Remove a filter above, or clear them all."
                : "Every sale you ring up lands here with its receipt."}
          </p>
          {!q && active > 0 && !onlyThisShift ? (
            <button className="btn compact" style={{ marginTop: 8 }} onClick={() => setFilter({})}>
              Clear filters
            </button>
          ) : !q && mine && (
            <button className="btn compact" style={{ marginTop: 8 }} onClick={onSell}>
              Start selling
            </button>
          )}
        </div>
      )}
      {filtering && (
        <FilterSheet
          all={all}
          filter={filter}
          zone={business.timeZone}
          onApply={(next) => {
            setFilter(next);
            setFiltering(false);
          }}
          onClose={() => setFiltering(false)}
        />
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

/** Pick any mix of shifts, events, organizers, places, items and payments. Counts update as you pick. */
function FilterSheet({
  all,
  filter,
  zone,
  onApply,
  onClose,
}: {
  all: Parameters<typeof filterOptions>[0];
  filter: SalesFilter;
  zone: string;
  onApply: (filter: SalesFilter) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SalesFilter>(filter);
  const [moreShifts, setMoreShifts] = useState(false);
  const options = useMemo(() => filterOptions(all, draft), [all, draft]);
  const count = all.filter((x) => matchesFilter(x.facets, draft)).length;
  const date = new Intl.DateTimeFormat("en", { timeZone: zone, month: "short", day: "numeric" });
  function toggle(key: FilterKey, value: string) {
    buzz.tap();
    const now = draft[key] ?? [];
    setDraft({ ...draft, [key]: now.includes(value) ? now.filter((v) => v !== value) : [...now, value] });
  }
  const label = (key: FilterKey, o: FilterOption) =>
    (key === "shift" && o.at ? date.format(new Date(o.at)) + " · " : "") + o.label;
  return (
    <Sheet
      title="Filter sales"
      onClose={onClose}
      action={
        activeCount(draft) > 0 ? (
          <button className="btn ghost small" onClick={() => setDraft({})}>
            Clear all
          </button>
        ) : undefined
      }
      footer={
        <button className="btn block" onClick={() => onApply(draft)}>
          {count ? `Show ${count} ${count === 1 ? "sale" : "sales"}` : "No sales match"}
        </button>
      }
    >
      <p className="label">Pick as many as you like. Sales must match every group you use.</p>
      {filterKeys.map((key) => {
        const list = options[key];
        if (!list.length) return null;
        const shown = key === "shift" && !moreShifts ? list.slice(0, 6) : list;
        const chosen = draft[key] ?? [];
        // Keep picked shifts visible even when they're older than the first few.
        const extra = key === "shift" && !moreShifts ? list.filter((o) => chosen.includes(o.value) && !shown.includes(o)) : [];
        return (
          <div key={key} className="stack gap-10">
            <p className="group-title">{filterNames[key]}</p>
            <div className="chips wrap" role="group" aria-label={filterNames[key]}>
              {[...shown, ...extra].map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={chosen.includes(o.value)}
                  onClick={() => toggle(key, o.value)}
                >
                  {label(key, o)} <span className="filter-count">{o.count}</span>
                </button>
              ))}
              {key === "shift" && list.length > shown.length + extra.length && (
                <button type="button" className="link" onClick={() => setMoreShifts(true)}>
                  {list.length - shown.length - extra.length} more
                </button>
              )}
            </div>
          </div>
        );
      })}
    </Sheet>
  );
}
