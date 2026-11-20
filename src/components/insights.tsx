"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Crown } from "lucide-react";
import { bestSellers, leaderboard, salesByHour, type Board } from "@/lib/insights";
import { dayOf, zonedInstant } from "@/lib/team";
import type { Booking, Product, RegisterState } from "@/lib/types";
import { Avatar } from "./team";
import { buzz, formatMoney, Money, progressStyle } from "./ui";

const hourName = (h: number) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;

/** Sales by hour as bars, with the busiest hour in black. */
export function HourChart({
  hours,
  currency,
  title = "By hour",
}: {
  hours: { hour: number; total: number }[];
  currency: string;
  title?: string;
}) {
  if (hours.length < 2) return null;
  const peak = Math.max(...hours.map((h) => h.total), 1);
  const busiest = hours.reduce((a, b) => (b.total > a.total ? b : a), hours[0]);
  return (
    <div className="card card-pad stack gap-12">
      <div className="between">
        <span className="label">{title}</span>
        <span className="label">
          Busiest {hourName(busiest.hour)} · {formatMoney(busiest.total, currency)}
        </span>
      </div>
      <div className="hours" role="img" aria-label={`Sales by hour, busiest at ${hourName(busiest.hour)}`}>
        {hours.map((h) => (
          <span key={h.hour} className="hour">
            <i
              className={h.hour === busiest.hour ? "peak" : ""}
              style={{ height: `${Math.max(4, (h.total / peak) * 100)}%` }}
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
  onSales,
}: {
  state: RegisterState;
  shiftIds: string[];
  menu: Product[];
  currency: string;
  /** Opens Sales for this shift, or for one item in it. */
  onSales?: (productId?: string) => void;
}) {
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
        {onSales && (
          <button className="link small-link" onClick={() => onSales()}>
            All {count} {count === 1 ? "sale" : "sales"} <ChevronRight size={14} />
          </button>
        )}
      </div>
      <div className="card card-list">
        {sellers.slice(0, 5).map((s, i) => (
          <button
            key={s.productId}
            type="button"
            className="list-row seller"
            disabled={!onSales}
            onClick={() => {
              buzz.tap();
              onSales?.(s.productId);
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
    </div>
  );
}

const boards: { id: Board; name: string }[] = [
  { id: "event", name: "Events" },
  { id: "organizer", name: "Organizers" },
  { id: "place", name: "Places" },
  { id: "people", name: "People" },
];

/** Who and where did best over finished shifts. */
export function Leaderboards({ state, demo, empty = false }: { state: RegisterState; demo: boolean; empty?: boolean }) {
  const [board, setBoard] = useState<Board>("event");
  const [range, setRange] = useState<"month" | "all">("month");
  const business = state.business!;
  const me = state.me;
  const zone = business.timeZone;
  const local = useMemo(() => {
    const owner = new Map(state.shifts.filter((s) => s.bookingId).map((s) => [s.id, s.bookingId!]));
    const totals = new Map<string, number>();
    for (const sale of state.sales) {
      const id = owner.get(sale.shiftId);
      if (id && !sale.reversedAt) totals.set(id, (totals.get(id) ?? 0) + sale.total);
    }
    return totals;
  }, [state.shifts, state.sales]);
  const salesOf = (b: Booking) =>
    me?.owner ? (!demo && b.sales !== undefined ? b.sales : (b.sales ?? 0) + (local.get(b.id) ?? 0)) : undefined;
  const since = useMemo(() => {
    if (range === "all") return 0;
    return Date.parse(zonedInstant(dayOf(Date.now(), zone).slice(0, 8) + "01", "00:00", zone));
  }, [range, zone]);
  const rows = leaderboard(state.bookings ?? [], board, me, salesOf, since);
  const owner = Boolean(me?.owner);
  const best = rows[0]?.score || 1;
  if (!(state.bookings ?? []).some((b) => Date.parse(b.endsAt) < Date.now()))
    return empty ? (
      <p className="label">Rankings start once the first scheduled shift is over.</p>
    ) : null;
  return (
    <div className="stack gap-10">
      <div className="between section-head">
        <p className="group-title">{empty ? "Ranked by " + (owner ? "sales" : "quotas hit") : "Leaderboard"}</p>
        <button
          className="link small-link"
          onClick={() => {
            buzz.tap();
            setRange(range === "month" ? "all" : "month");
          }}
        >
          {range === "month" ? "This month" : "Last 60 days"}
        </button>
      </div>
      <div className="chips" role="group" aria-label="Rank by">
        {boards.map((b) => (
          <button
            key={b.id}
            type="button"
            aria-pressed={board === b.id}
            onClick={() => {
              buzz.tap();
              setBoard(b.id);
            }}
          >
            {b.name}
          </button>
        ))}
      </div>
      <div className="card card-list board" key={board + range}>
        {rows.slice(0, 8).map((r, i) => (
          <div key={r.key} className={"list-row rank" + (r.me ? " me" : "")} style={{ animationDelay: `${i * 40}ms` }}>
            <span className={"rank-num" + (i === 0 ? " first" : i < 3 ? " podium" : "")}>
              {i === 0 ? <Crown size={14} strokeWidth={2.2} /> : i + 1}
            </span>
            {board === "people" && <Avatar name={r.label} small />}
            <span className="grow stack gap-4">
              <span className="between">
                <span className="ellipsis">
                  {r.label}
                  {r.me ? <span className="g"> · you</span> : null}
                </span>
                {owner ? (
                  <Money value={r.sales ?? 0} currency={business.currency} className="rank-score" />
                ) : (
                  <span className="num rank-score">{r.hits}</span>
                )}
              </span>
              <span className="bar" aria-hidden="true">
                <i style={progressStyle(Math.max(3, (r.score / best) * 100))} />
              </span>
              <span className="label">
                {r.shifts} {r.shifts === 1 ? "shift" : "shifts"}
                {owner
                  ? ` · ${r.profit! >= 0 ? "profit" : "loss"} ${formatMoney(Math.abs(r.profit!), business.currency)}`
                  : ""}
                {r.hits ? ` · ${r.hits} quota ${r.hits === 1 ? "hit" : "hits"}` : ""}
              </span>
            </span>
          </div>
        ))}
        {!rows.length && (
          <p className="label" style={{ padding: "18px 0" }}>
            {range === "month" ? "No finished shifts this month yet." : "No finished shifts yet."}
          </p>
        )}
      </div>
      {!owner && <p className="label">Ranked by quotas hit, then shifts worked.</p>}
    </div>
  );
}
