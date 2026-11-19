import { countRows, type CashCount } from "./cash";
import { shiftTotals, stockLeft } from "./domain";
import { round, stockModel, unitText } from "./stock";
import { shiftRoleNames } from "./team";
import type { Booking, Business, Expense, Product, Sale, Shift } from "./types";

export interface StockRow {
  id: string;
  name: string;
  unit: string;
  start: number;
  used: number;
  /** What should be left after the sales. */
  expected: number;
  /** What was counted at closing, when it was. */
  counted?: number;
}

/** Everything a shift's end-of-day message says, worked out once for the text and the image. */
export interface ShiftReport {
  business: { name: string; logo?: string; brand?: string };
  currency: string;
  number: number;
  date: string;
  hours: string;
  place?: string;
  people: string[];
  /** What each person did on the shift, like "Cashier", by name. */
  roles: Record<string, string>;
  /** Profile photos, by person's name. */
  faces: Record<string, string>;
  /** Biggest hour of sales, like "3 PM". */
  peak?: { hour: string; total: number };
  /** Sales total per hour of the shift, oldest first. */
  hourly: { label: string; total: number }[];
  closed: boolean;
  sales: { total: number; count: number; reversed: number; discounts: number };
  methods: { name: string; kind: string; amount: number; count: number }[];
  sold: { productId: string; name: string; quantity: number; revenue: number; image?: string }[];
  stock: StockRow[];
  expenses: Expense[];
  tillExpenses: number;
  pocketExpenses: number;
  cash: {
    float: number;
    floatCount?: CashCount;
    sales: number;
    expenses: number;
    expected: number;
    counted?: number;
    count?: CashCount;
    difference?: number;
  };
  /** Pocket expenses owed back, by who paid. */
  payBack: { name: string; amount: number }[];
}

export function shiftReport(
  shift: Shift,
  allSales: Sale[],
  allExpenses: Expense[],
  business: Business,
  booking?: Booking,
  /** The menu to find item photos in, and each team member's current name and photo, by member id. */
  extra: { menu?: Product[]; faces?: Record<string, string>; names?: Record<string, string> } = {},
): ShiftReport {
  const currency = shift.settings?.currency ?? business.currency;
  const sales = allSales.filter((s) => s.shiftId === shift.id);
  const expenses = allExpenses
    .filter((e) => e.shiftId === shift.id && !e.voidedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const totals = shiftTotals(shift, sales, expenses);
  const zone = business.timeZone;
  const day = new Intl.DateTimeFormat("en", { timeZone: zone, weekday: "short", month: "short", day: "numeric" });
  const time = new Intl.DateTimeFormat("en", { timeZone: zone, hour: "numeric", minute: "2-digit" });

  const sold = new Map<string, ShiftReport["sold"][number]>();
  const photos = new Map<string, string>();
  for (const p of [...(extra.menu ?? []), ...shift.menu]) if (p.image) photos.set(p.id, p.image);
  const hourly = new Map<number, number>();
  const hourOf = new Intl.DateTimeFormat("en", { timeZone: zone, hour: "numeric", hourCycle: "h23" });
  for (const sale of sales) {
    if (sale.reversedAt) continue;
    const h = Number(hourOf.format(new Date(sale.createdAt)));
    hourly.set(h, (hourly.get(h) ?? 0) + sale.total);
    for (const line of sale.lines) {
      const row = sold.get(line.productId) ?? {
        productId: line.productId,
        name: line.name,
        quantity: 0,
        revenue: 0,
        ...(photos.get(line.productId) ? { image: photos.get(line.productId) } : {}),
      };
      row.quantity += line.quantity;
      row.revenue += line.quantity * line.unitPrice;
      sold.set(line.productId, row);
    }
  }
  const label = (h: number) => (h % 12 || 12) + (h < 12 ? " AM" : " PM");
  const hourKeys = [...hourly.keys()].sort((a, b) => a - b);
  const hours = hourKeys.length
    ? Array.from({ length: hourKeys[hourKeys.length - 1] - hourKeys[0] + 1 }, (_, i) => {
        const h = hourKeys[0] + i;
        return { label: label(h), total: hourly.get(h) ?? 0 };
      })
    : [];
  const top = hours.reduce<{ label: string; total: number } | undefined>((a, b) => (!a || b.total > a.total ? b : a), undefined);

  const { items } = stockModel(shift.settings.stockItems, shift.menu);
  const left = shift.menu.length ? stockLeft(shift, sales) : {};
  const stock: StockRow[] = Object.entries(shift.stock ?? {}).map(([id, start]) => {
    const item = items.find((i) => i.id === id);
    const used = shift.usedStock?.[id] ?? round(start - (left[id] ?? start));
    return {
      id,
      name: item?.name ?? "Stock item",
      unit: item?.unit ?? "piece",
      start,
      used,
      expected: round(start - used),
      ...(shift.closingStock?.[id] !== undefined ? { counted: shift.closingStock[id] } : {}),
    };
  });

  const owed = new Map<string, number>();
  for (const e of expenses)
    if (e.source === "pocket") owed.set(e.by || "Staff", (owed.get(e.by || "Staff") ?? 0) + e.amount);

  const nameOf = (s: { memberId: string; name: string }) => extra.names?.[s.memberId] || s.name;
  const staff = booking?.staff.map(nameOf).filter(Boolean) ?? [];
  const people = staff.length ? staff : shift.openedBy ? [shift.openedBy] : [];
  const place = booking
    ? [booking.place?.name, booking.event?.name].filter(Boolean).join(" · ") || undefined
    : undefined;

  return {
    business: { name: business.name, logo: business.settings.logo, brand: business.settings.brand },
    currency,
    number: shift.number,
    date: day.format(new Date(shift.openedAt)),
    hours:
      time.format(new Date(shift.openedAt)) +
      " – " +
      (shift.closedAt ? time.format(new Date(shift.closedAt)) : "now"),
    place,
    people,
    roles: Object.fromEntries((booking?.staff ?? []).map((s) => [nameOf(s), shiftRoleNames[s.role] ?? s.role])),
    faces: Object.fromEntries(
      [
        ...Object.entries(extra.names ?? {}).map(([id, name]) => [name, extra.faces?.[id]] as const),
        ...(booking?.staff ?? []).map((s) => [nameOf(s), extra.faces?.[s.memberId]] as const),
      ].filter((x): x is readonly [string, string] => Boolean(x[1]) && people.includes(x[0])),
    ),
    hourly: hours,
    ...(top ? { peak: { hour: top.label, total: top.total } } : {}),
    closed: Boolean(shift.closedAt),
    sales: {
      total: totals.total,
      count: totals.count,
      reversed: totals.reversed,
      discounts: totals.discounts,
    },
    methods: totals.methods.filter((m) => m.count).map(({ name, kind, amount, count }) => ({ name, kind, amount, count })),
    sold: [...sold.values()].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue),
    stock,
    expenses,
    tillExpenses: totals.tillExpenses,
    pocketExpenses: totals.pocketExpenses,
    cash: {
      float: shift.openingCash,
      ...(shift.openingCount ? { floatCount: shift.openingCount } : {}),
      sales: totals.cash,
      expenses: totals.tillExpenses,
      expected: totals.expectedCash,
      ...(shift.countedCash !== undefined ? { counted: shift.countedCash } : {}),
      ...(shift.closingCount ? { count: shift.closingCount } : {}),
      ...(shift.difference !== undefined ? { difference: shift.difference } : {}),
    },
    payBack: [...owed].map(([name, amount]) => ({ name, amount })),
  };
}

type Format = (minor: number) => string;

export function differenceText(value: number, fmt: Format) {
  return value === 0 ? "matches" : `${fmt(Math.abs(value))} ${value < 0 ? "short" : "over"}`;
}

export function countText(count: CashCount | undefined, fmt: Format) {
  return countRows(count)
    .map((r) => `${fmt(r.value)} × ${r.qty}`)
    .join(", ");
}

/** The report as plain text to paste in a group chat. */
export function reportText(r: ShiftReport, fmt: Format) {
  const out: string[] = [];
  out.push(`${r.business.name} · Shift ${r.number}`);
  out.push([r.date, r.hours].join(" · "));
  if (r.place) out.push(r.place);
  if (r.people.length) out.push(r.people.map((p) => (r.roles[p] ? `${p} (${r.roles[p]})` : p)).join(", "));
  out.push("");
  out.push(`SALES ${fmt(r.sales.total)} (${r.sales.count} ${r.sales.count === 1 ? "sale" : "sales"})`);
  for (const m of r.methods) out.push(`${m.name} ${fmt(m.amount)}`);
  if (r.sales.discounts) out.push(`Discounts given ${fmt(r.sales.discounts)}`);
  if (r.sales.reversed) out.push(`${r.sales.reversed} reversed`);
  if (r.sold.length) {
    out.push("", "SOLD");
    for (const s of r.sold) out.push(`${s.name} ${s.quantity}`);
  }
  if (r.stock.length) {
    out.push("", "STOCK (start / used / left)");
    for (const s of r.stock) {
      const left = s.counted ?? s.expected;
      let line = `${s.name} ${num(s.start)} / ${num(s.used)} / ${unitText(left, s.unit)}`;
      const off = s.counted !== undefined ? round(s.counted - s.expected) : 0;
      if (off) line += ` (${off > 0 ? "+" : ""}${num(off)} vs expected)`;
      out.push(line);
    }
  }
  if (r.expenses.length) {
    out.push("", "EXPENSES");
    for (const e of r.expenses)
      out.push(`${e.label} ${fmt(e.amount)} (${e.source === "till" ? "from till" : `paid by ${e.by || "staff"}`})`);
  }
  out.push("", "CASH");
  out.push(`Float ${fmt(r.cash.float)}`);
  out.push(`+ Cash sales ${fmt(r.cash.sales)}`);
  if (r.cash.expenses) out.push(`− Till expenses ${fmt(r.cash.expenses)}`);
  out.push(`= Expected ${fmt(r.cash.expected)}`);
  if (r.cash.counted !== undefined) {
    out.push(`Cash on hand ${fmt(r.cash.counted)}${r.cash.difference !== undefined ? ` (${differenceText(r.cash.difference, fmt)})` : ""}`);
    if (r.cash.count) out.push(countText(r.cash.count, fmt));
  }
  if (r.payBack.length) {
    out.push("");
    for (const p of r.payBack) out.push(`Pay back ${p.name} ${fmt(p.amount)}`);
  }
  return out.join("\n");
}

function num(n: number) {
  return round(n).toLocaleString("en", { maximumFractionDigits: 3 });
}

/** Group a schedule by place, one line per day with who works it, to paste in a chat. */
export function scheduleText(
  bookings: Booking[],
  timeZone: string,
) {
  const day = new Intl.DateTimeFormat("en", { timeZone, month: "short", day: "numeric" });
  const groups = new Map<string, Booking[]>();
  for (const b of [...bookings].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const name = [b.place?.name, b.event?.name].filter(Boolean).join(" - ") || b.organizer?.name || "Shifts";
    groups.set(name, [...(groups.get(name) ?? []), b]);
  }
  return [...groups]
    .map(([name, list]) => {
      const lines = new Map<string, string[]>();
      for (const b of list) {
        const d = day.format(new Date(b.startsAt));
        lines.set(d, [...(lines.get(d) ?? []), ...b.staff.map((s) => s.name.split(" ")[0])]);
      }
      return [name, ...[...lines].map(([d, people]) => [d, [...new Set(people)].join(", ")].filter(Boolean).join(" "))].join("\n");
    })
    .join("\n\n");
}
