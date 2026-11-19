import { and, between, desc, eq, lt, or } from "drizzle-orm";
import type { Bootstrap, Sale, Shift } from "../lib/types";
import type { Transaction } from "./db";
import { z } from "zod";
import { ensure } from "./errors";
import {
  defaultSettings,
  legacyPayment,
  legacyShiftSettings,
} from "../lib/settings";
import { businesses, sales, shifts } from "./schema";

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
  };
}

export function presentSale(row: typeof sales.$inferSelect): Sale {
  const { subtotal, discount, payment, ...rest } = row;
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
  ownerId: string,
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
  return receiptsPage(tx, ownerId, oldestShift, newestShift, values.data);
}

async function receiptsPage(
  tx: Transaction,
  ownerId: string,
  oldestShift: number,
  newestShift: number,
  after?: Position,
): Promise<Page> {
  const pageSize = 100;
  const rows = await tx
    .select({ row: sales, shiftNumber: shifts.number })
    .from(sales)
    .innerJoin(shifts, eq(sales.shiftId, shifts.id))
    .innerJoin(businesses, eq(shifts.businessId, businesses.id))
    .where(
      and(
        eq(businesses.ownerId, ownerId),
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

export async function snapshot(
  tx: Transaction,
  ownerId: string,
): Promise<Bootstrap & { nextSales?: string }> {
  const [business] = await tx
    .select()
    .from(businesses)
    .where(eq(businesses.ownerId, ownerId));
  if (!business)
    return {
      business: null,
      menu: [],
      shift: null,
      soldOut: [],
      shifts: [],
      sales: [],
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
        ownerId,
        recent[recent.length - 1].number,
        recent[0].number,
      )
    : { sales: [] };
  const { id, name, currency, timeZone, menu } = business;
  const settings = business.settings ?? defaultSettings(currency);
  return {
    business: { id, name, currency, timeZone, settings },
    menu,
    shift: active ? presentShift(active, currency) : null,
    soldOut: active?.soldOut ?? [],
    shifts: recent.map((row) =>
      presentShift(row.closedAt ? { ...row, menu: [] } : row, currency),
    ),
    ...history,
  };
}
