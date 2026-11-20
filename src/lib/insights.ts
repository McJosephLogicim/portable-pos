import { bookingProfit, dayOf } from "./team";
import type { Booking, Me, Sale } from "./types";

export interface Seller {
  productId: string;
  name: string;
  quantity: number;
  revenue: number;
}

/** Items ranked by units sold on some tills. Reversed receipts don't count. */
export function bestSellers(sales: Sale[], shiftIds: string[]): Seller[] {
  const ids = new Set(shiftIds);
  const map = new Map<string, Seller>();
  for (const sale of sales) {
    if (!ids.has(sale.shiftId) || sale.reversedAt) continue;
    // Spread the order discount over its lines so revenue adds up to net sales.
    const share = sale.subtotal ? sale.total / sale.subtotal : 1;
    for (const line of sale.lines) {
      const row = map.get(line.productId) ?? { productId: line.productId, name: line.name, quantity: 0, revenue: 0 };
      row.quantity += line.quantity;
      row.revenue += Math.round(line.unitPrice * line.quantity * share);
      map.set(line.productId, row);
    }
  }
  return [...map.values()].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue);
}

/** Net sales by hour of the day in the business time zone. */
export function salesByHour(sales: Sale[], shiftIds: string[], timeZone: string) {
  const ids = new Set(shiftIds);
  const hours = new Map<number, { total: number; count: number }>();
  const hourOf = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" });
  for (const sale of sales) {
    if (!ids.has(sale.shiftId) || sale.reversedAt) continue;
    const hour = Number(hourOf.format(new Date(sale.createdAt))) % 24;
    const row = hours.get(hour) ?? { total: 0, count: 0 };
    row.total += sale.total;
    row.count++;
    hours.set(hour, row);
  }
  if (!hours.size) return [];
  const keys = [...hours.keys()];
  const first = Math.min(...keys);
  const last = Math.max(...keys);
  return Array.from({ length: last - first + 1 }, (_, i) => ({
    hour: first + i,
    ...(hours.get(first + i) ?? { total: 0, count: 0 }),
  }));
}

export type Board = "event" | "organizer" | "place" | "people";
export interface Rank {
  key: string;
  label: string;
  /** What the row is ranked by: sales for the owner, quota hits for the team. */
  score: number;
  shifts: number;
  hits: number;
  sales?: number;
  profit?: number;
  me?: boolean;
}

export interface LeaderboardShare {
  business: { name: string; logo?: string; brand?: string };
  category: string;
  period: string;
  ranking: string;
  owner: boolean;
  icon?: string;
  rows: { name: string; score: string; details: string[]; photo?: string }[];
}

export function leaderboardShareRows(
  ranks: Rank[],
  owner: boolean,
  format: (amount: number) => string,
  photos?: Record<string, string>,
): LeaderboardShare["rows"] {
  return ranks.map(({ key, label, shifts, hits, sales = 0, profit = 0 }) => {
    const worked = `${shifts} ${shifts === 1 ? "shift" : "shifts"} worked`;
    const quotas = `${hits} ${hits === 1 ? "quota" : "quotas"} hit`;
    return {
      name: label,
      score: owner ? format(sales) : quotas,
      details: owner ? [worked, `${profit < 0 ? "Loss" : "Profit"} ${format(Math.abs(profit))}`, quotas] : [worked],
      photo: photos?.[key],
    };
  });
}

export function leaderboardText({ business, category, period, ranking, rows, owner }: LeaderboardShare) {
  const heading = `${business.name} — ${category} leaderboard\n${period} · ${ranking}`;
  return [heading, ...rows.map((row, i) =>
    `${i + 1}. ${row.name} — ${row.score}${owner ? " sales" : ""}\n   ${row.details.join(" · ")}`,
  )].join("\n\n");
}

/**
 * Rank finished shifts by event, organizer, place or person. The owner ranks by sales
 * (with profit alongside). Teammates don't see money, so they rank by quotas hit.
 */
export function leaderboard(
  bookings: Booking[],
  board: Board,
  me: Me | null | undefined,
  salesOf: (b: Booking) => number | undefined,
  since: number,
  now = Date.now(),
): Rank[] {
  const rows = new Map<string, Rank>();
  const owner = Boolean(me?.owner);
  for (const b of bookings) {
    const end = Date.parse(b.endsAt);
    if (end > now || end < since) continue;
    const sales = salesOf(b);
    const p = owner ? bookingProfit({ ...b, sales: sales ?? 0 }) : null;
    const hit = p ? p.hit : Boolean(b.hit);
    const keys: { key: string; label: string; me?: boolean }[] =
      board === "event"
        ? b.event
          ? [{ key: b.event.id, label: b.event.name }]
          : []
        : board === "organizer"
          ? b.organizer
            ? [{ key: b.organizer.id, label: b.organizer.name }]
            : []
          : board === "place"
            ? b.place
              ? [{ key: b.place.name.toLowerCase(), label: b.place.name }]
              : []
            : b.staff.map((s) => ({ key: s.memberId, label: s.name, me: s.memberId === me?.memberId }));
    for (const k of keys) {
      const row = rows.get(k.key) ?? { key: k.key, label: k.label, score: 0, shifts: 0, hits: 0, me: k.me, ...(owner ? { sales: 0, profit: 0 } : {}) };
      row.shifts++;
      if (hit) row.hits++;
      if (p) {
        row.sales! += p.sales;
        row.profit! += p.net;
      }
      rows.set(k.key, row);
    }
  }
  for (const row of rows.values()) row.score = owner ? row.sales! : row.hits * 1000 + row.shifts;
  return [...rows.values()].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}

export { dayOf };
