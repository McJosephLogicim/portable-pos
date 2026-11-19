import { and, between, desc, eq, gte, inArray, isNull, lt, or, sum } from "drizzle-orm";
import type { Bootstrap, Expense, Sale, Shift } from "../lib/types";
import { stockModel } from "../lib/stock";
import type { Transaction } from "./db";
import { z } from "zod";
import { ensure } from "./errors";
import {
  defaultSettings,
  legacyPayment,
  legacyShiftSettings,
} from "../lib/settings";
import { bookings, businesses, expenses, members, sales, shifts } from "./schema";
import { redactBooking } from "../lib/team";
import { presentBooking, presentMe, presentMember } from "./team";

export function presentShift(
  row: typeof shifts.$inferSelect,
  currency: string,
): Shift {
  return {
    id: row.id,
    businessId: row.businessId,
    number: row.number,
    deviceId: row.deviceId,
    openedAt: new Date(row.openedAt).toISOString(),
    closedAt: row.closedAt && new Date(row.closedAt).toISOString(),
    openingCash: row.openingCash,
    menu: row.menu,
    settings: row.settings ?? legacyShiftSettings(currency),
    countedCash: row.countedCash ?? undefined,
    difference: row.difference ?? undefined,
    ...(row.stock ? { stock: row.stock } : {}),
    ...(row.bookingId ? { bookingId: row.bookingId } : {}),
    ...(row.checklist ? { checklist: row.checklist } : {}),
    ...(row.closingStock ? { closingStock: row.closingStock } : {}),
    ...(row.openingCount ? { openingCount: row.openingCount } : {}),
    ...(row.closingCount ? { closingCount: row.closingCount } : {}),
    ...(row.usedStock ? { usedStock: row.usedStock } : {}),
    ...(row.openedBy ? { openedBy: row.openedBy } : {}),
  };
}

export function presentExpense(row: typeof expenses.$inferSelect): Expense {
  return {
    id: row.id,
    shiftId: row.shiftId,
    createdAt: new Date(row.createdAt).toISOString(),
    label: row.label,
    amount: row.amount,
    source: row.source as Expense["source"],
    ...(row.by ? { by: row.by } : {}),
    ...(row.voidedAt ? { voidedAt: new Date(row.voidedAt).toISOString() } : {}),
  };
}

/** A closed shift without its menu, but with the stock items its report names. */
function closedShift(row: typeof shifts.$inferSelect, currency: string) {
  const shift = presentShift(row, currency);
  if (!row.stock) return { ...shift, menu: [] };
  const { items } = stockModel(shift.settings.stockItems, row.menu);
  return { ...shift, menu: [], settings: { ...shift.settings, stockItems: items } };
}

export function presentSale(row: typeof sales.$inferSelect): Sale {
  const { subtotal, discount, payment, proofs, ...rest } = row;
  return {
    ...rest,
    subtotal: subtotal ?? row.total,
    ...(discount ? { discount } : {}),
    payment: payment ?? legacyPayment(row.tender),
    createdAt: new Date(row.createdAt).toISOString(),
    reversedAt: row.reversedAt
      ? new Date(row.reversedAt).toISOString()
      : undefined,
    reason: row.reason ?? undefined,
    ...(proofs?.length ? { proofs } : {}),
  };
}

const position = z.object({
  newestShift: z.number().int().positive(),
  oldestShift: z.number().int().positive(),
  shift: z.number().int().positive(),
  sequence: z.number().int().positive(),
});
type Position = z.infer<typeof position>;
type Page = { sales: Sale[]; nextSales?: string };

export async function historyPage(
  tx: Transaction,
  businessId: string | undefined,
  cursor: unknown,
): Promise<Page> {
  ensure(
    typeof cursor === "string" && cursor.length <= 512,
    "Invalid sales history cursor.",
  );
  let values;
  try {
    values = position.safeParse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    ensure(false, "Invalid sales history cursor.");
  }
  ensure(values.success, "Invalid sales history cursor.");
  const { newestShift, oldestShift } = values.data;
  ensure(oldestShift <= newestShift, "Invalid sales history cursor.");
  if (!businessId) return { sales: [] };
  return receiptsPage(tx, businessId, oldestShift, newestShift, values.data);
}

async function receiptsPage(
  tx: Transaction,
  businessId: string,
  oldestShift: number,
  newestShift: number,
  after?: Position,
): Promise<Page> {
  const pageSize = 100;
  const rows = await tx
    .select({ row: sales, shiftNumber: shifts.number })
    .from(sales)
    .innerJoin(shifts, eq(sales.shiftId, shifts.id))
    .where(
      and(
        eq(shifts.businessId, businessId),
        between(shifts.number, oldestShift, newestShift),
        after &&
          or(
            lt(shifts.number, after.shift),
            and(
              eq(shifts.number, after.shift),
              lt(sales.sequence, after.sequence),
            ),
          ),
      ),
    )
    .orderBy(desc(shifts.number), desc(sales.sequence))
    .limit(pageSize + 1);

  const result: Sale[] = [];
  let bytes = 0;
  for (const { row } of rows.slice(0, pageSize)) {
    const receipt = presentSale(row);
    const size = Buffer.byteLength(JSON.stringify(receipt), "utf8");
    if (result.length > 0 && bytes + size > 1_500_000) break;
    result.push(receipt);
    bytes += size;
  }
  let nextSales: string | undefined;
  if (result.length < rows.length) {
    const last = rows[result.length - 1];
    nextSales = Buffer.from(
      JSON.stringify({
        oldestShift,
        newestShift,
        shift: last.shiftNumber,
        sequence: last.row.sequence,
      }),
    ).toString("base64url");
  }
  return { sales: result, nextSales };
}

type Access = {
  business: typeof businesses.$inferSelect;
  member: typeof members.$inferSelect;
} | null;

const empty = {
  business: null,
  me: null,
  team: [],
  organizers: [],
  bookings: [],
  menu: [],
  shift: null,
  soldOut: [],
  shifts: [],
  sales: [],
};

export async function snapshot(
  tx: Transaction,
  access: Access,
): Promise<Bootstrap & { nextSales?: string }> {
  if (!access) return empty;
  // Read again: the command may have just changed them.
  const [business] = await tx.select().from(businesses).where(eq(businesses.id, access.business.id));
  const [member] = await tx.select().from(members).where(eq(members.id, access.member.id));
  if (!business) return empty;
  const me = presentMe(member ?? access.member);
  // Roles are picked per shift, so everyone on the team can run the till.
  const till = true;

  // Two months back for the books, and everything ahead.
  const since = new Date(Date.now() - 62 * 86400000).toISOString();
  const bookingRows = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.businessId, business.id), gte(bookings.endsAt, since)))
    .orderBy(bookings.startsAt)
    .limit(1000);
  const takings = new Map<string, number>();
  if (me.owner && bookingRows.length) {
    const rows = await tx
      .select({ bookingId: shifts.bookingId, total: sum(sales.total).mapWith(Number) })
      .from(sales)
      .innerJoin(shifts, eq(sales.shiftId, shifts.id))
      .where(
        and(
          eq(shifts.businessId, business.id),
          isNull(sales.reversedAt),
          inArray(
            shifts.bookingId,
            bookingRows.map((b) => b.id),
          ),
        ),
      )
      .groupBy(shifts.bookingId);
    for (const row of rows) if (row.bookingId) takings.set(row.bookingId, row.total ?? 0);
  }
  const plan = {
    me,
    team: me.owner
      ? (await tx.select().from(members).where(eq(members.businessId, business.id))).map(presentMember)
      : [],
    organizers: me.owner ? business.organizers : [],
    bookings: bookingRows.map((row) =>
      redactBooking({ ...presentBooking(row), sales: takings.get(row.id) ?? 0 }, me),
    ),
  };
  const { id, name, currency, timeZone, menu } = business;
  const settings = business.settings ?? defaultSettings(currency);
  if (!till)
    return {
      ...empty,
      ...plan,
      business: { id, name, currency, timeZone, settings },
    };

  const recent = await tx
    .select()
    .from(shifts)
    .where(eq(shifts.businessId, business.id))
    .orderBy(desc(shifts.number))
    .limit(31);
  const active = recent.find((shift) => !shift.closedAt);
  if (!active && recent.length > 30) recent.pop();
  const history = recent.length
    ? await receiptsPage(
        tx,
        business.id,
        recent[recent.length - 1].number,
        recent[0].number,
      )
    : { sales: [] };
  return {
    ...plan,
    business: { id, name, currency, timeZone, settings },
    menu,
    shift: active ? presentShift(active, currency) : null,
    soldOut: active?.soldOut ?? [],
    shifts: recent.map((row) =>
      row.closedAt ? closedShift(row, currency) : presentShift(row, currency),
    ),
    expenses: recent.length
      ? (
          await tx
            .select()
            .from(expenses)
            .where(inArray(expenses.shiftId, recent.map((r) => r.id)))
            .orderBy(expenses.createdAt)
        ).map(presentExpense)
      : [],
    ...history,
  };
}
