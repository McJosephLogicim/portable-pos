"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronRight, CloudOff, ReceiptText, Search, X } from "lucide-react";
import type { Booking, Product, RegisterState, Shift } from "@/lib/types";
import { HourChart } from "./insights";
import { bestSellers, salesByHour } from "@/lib/insights";
import {
  activeCount,
  filterKeys,
  filterNames,
  filterOptions,
  matchesFilter,
  saleFacets,
  shiftFacet,
  shiftKey,
  type Facet,
  type FilterKey,
  type FilterOption,
  type SalesFilter,
} from "@/lib/sales-filter";
import { ReceiptSheet, receiptNumber, shiftCurrency } from "./receipt";
import { FilterBar, FilterChoices } from "./filter-controls";
import { EmptyState, Money, Sheet } from "./ui";
import styles from "./operations.module.css";

/** Opens Sales already filtered, like from "All sales" on a shift. */
export interface SalesFocus {
  filter: SalesFilter;
}

export function SalesScreen({
  state,
  online,
  onReverse,
  onSell,
  focus,
}: {
  state: RegisterState;
  online: boolean;
  onReverse: (saleId: string, reason: string, pin: string) => Promise<void>;
  onSell: () => void;
  focus: SalesFocus | null;
}) {
  const business = state.business!;
  const shift = state.shift && !state.shift.closedAt ? state.shift : null;
  const [openId, setOpenId] = useState<string | null>(null);
  // Starts on the running shift, like the till does; one tap on its chip shows everything.
  const [filter, setFilter] = useState<SalesFilter>(() => focus?.filter ?? (shift ? { shift: [shiftKey(shift)] } : {}));
  const [filtering, setFiltering] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const shifts = useMemo(
    () => new Map<string, Shift>([...state.shifts, ...(state.shift ? [state.shift] : [])].map((s) => [s.id, s])),
    [state.shifts, state.shift],
  );
  const bookings = useMemo(() => new Map<string, Booking>((state.bookings ?? []).map((b) => [b.id, b])), [state.bookings]);
  const shiftFacets = useMemo(() => {
    const facets = new Map<string, Facet>();
    for (const till of shifts.values()) {
      const facet = shiftFacet(till, till.bookingId ? bookings.get(till.bookingId) : undefined);
      facets.set(facet.value, facet);
    }
    return facets;
  }, [shifts, bookings]);
  const all = useMemo(
    () =>
      state.sales
        .filter((s) => shifts.has(s.shiftId))
        .map((sale) => ({ sale, facets: saleFacets(sale, shifts, bookings) })),
    [state.sales, shifts, bookings],
  );
  const options = useMemo(() => filterOptions(all, filter, shiftFacets), [all, filter, shiftFacets]);
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
  const hours = !searching && live.length >= 3 ? salesByHour(live, tills, business.timeZone) : [];
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
  const open = state.sales.find((s) => s.id === openId);
  const openShift = open && shifts.get(open.shiftId);
  return (
    <div className="page">
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
            ref={searchButton}
            aria-label={searching ? "Close receipt search" : "Search receipts"}
            aria-expanded={searching}
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
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            setSearching(false);
            setQuery("");
            searchButton.current?.focus({ preventScroll: true });
          }}
        />
      )}
      {all.length > 0 && (
        <FilterBar
          label="Filter by shift, item, payment…"
          groups={filterKeys.map((key) => ({ key, name: filterNames[key], options: options[key] }))}
          filter={filter}
          onChange={setFilter}
          onOpen={() => setFiltering(true)}
        />
      )}
      {hours.length >= 2 && (
        <details className={`card ${styles.details} ${styles.analytics}`}>
          <summary>Sales by hour</summary>
          <HourChart hours={hours} currency={currency} title={active ? "Filtered sales" : "All shifts"} />
        </details>
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
                type="button"
                className="list-row"
                onClick={() => setOpenId(sale.id)}
                aria-haspopup="dialog"
              >
                <span className="sr-only">Receipt {receiptNumber(sh.number, sale.sequence)}</span>
                <span className="grow stack gap-4">
                  <span className="ellipsis" style={{ fontWeight: 500 }}>
                    {items}
                  </span>
                  <span className="label ellipsis sale-meta">
                    {sale.reversedAt ? (
                      <span className="danger">Reversed · </span>
                    ) : pending.has(sale.id) ? (
                      <CloudOff size={13} strokeWidth={2} className="sync-mark" aria-label="Not synced" role="img" />
                    ) : null}
                    {multiDay ? day.format(when) + ", " : ""}
                    {time.format(when)} · {sale.payment.name}
                    {sale.discount ? " · " + sale.discount.name : ""}
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
      ) : q || (active > 0 && !onlyThisShift) ? (
        <EmptyState
          icon={<ReceiptText size={22} />}
          title="No receipts match"
          text={q ? "Try a receipt number like #3-012, an item, or GCash." : "Remove a filter above, or clear them all."}
        >
          {!q && <button className="btn ghost compact" onClick={() => setFilter({})}>Clear</button>}
        </EmptyState>
      ) : (
        <EmptyState pose="sale" motion="wave" object="salesReceipt" title="No sales yet" text="Every sale you ring up lands here with its receipt.">
          {mine && <button className="btn compact" onClick={onSell}>Start selling</button>}
        </EmptyState>
      )}
      {filtering && (
        <FilterSheet
          all={all}
          menu={state.menu}
          shifts={shifts}
          shiftFacets={shiftFacets}
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
  menu,
  shifts,
  shiftFacets,
  filter,
  zone,
  onApply,
  onClose,
}: {
  all: Parameters<typeof filterOptions>[0];
  menu: Product[];
  shifts: Map<string, Shift>;
  shiftFacets: ReadonlyMap<string, Facet>;
  filter: SalesFilter;
  zone: string;
  onApply: (filter: SalesFilter) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<SalesFilter>(filter);
  const options = useMemo(() => filterOptions(all, draft, shiftFacets), [all, draft, shiftFacets]);
  const photos = useMemo(() => {
    const images = new Map(menu.map((item) => [item.id, item.image]));
    // Older receipts can contain items that have since been removed from the menu.
    for (const shift of shifts.values()) {
      for (const item of shift.menu) {
        if (item.image && !images.has(item.id)) images.set(item.id, item.image);
      }
    }
    return images;
  }, [menu, shifts]);
  const count = all.filter((x) => matchesFilter(x.facets, draft)).length;
  const date = new Intl.DateTimeFormat("en", { timeZone: zone, month: "short", day: "numeric" });
  const label = (key: FilterKey, o: FilterOption) =>
    (key === "shift" && o.at ? date.format(new Date(o.at)) + " · " : "") + o.label;
  return (
    <Sheet
      title="Filter sales"
      onClose={onClose}
      help="Pick as many as you like. Sales must match every group you use."
      action={
        activeCount(draft) > 0 ? (
          <button className="btn ghost small" onClick={() => setDraft({})}>
            Clear
          </button>
        ) : undefined
      }
      footer={
        <button className="btn block" onClick={() => onApply(draft)}>
          {count ? `Show ${count} ${count === 1 ? "sale" : "sales"}` : "No sales match"}
        </button>
      }
    >
      {filterKeys.map((key) => {
        const list = options[key];
        if (!list.length) return null;
        return (
          <FilterChoices
            key={key}
            name={filterNames[key]}
            options={list.map((option) => ({
              ...option,
              label: label(key, option),
              image: key === "item" ? photos.get(option.value) : undefined,
            }))}
            picked={draft[key] ?? []}
            onChange={(picked) => setDraft({ ...draft, [key]: picked })}
            showThumbnails={key === "item"}
          />
        );
      })}
    </Sheet>
  );
}
