import { and, asc, between, desc, eq, gte, inArray, isNotNull, isNull, lt, notExists, or, sql, sum } from "drizzle-orm";
import { legacyStockUses } from "../lib/domain";
import type { Bootstrap, Expense, Sale, Shift } from "../lib/types";
import { stockModel, withoutMenuCosts, withoutStockCosts } from "../lib/stock";
import type { Transaction } from "./db";
import { z } from "zod";
import { ensure } from "./errors";
import {
  defaultSettings,
  legacyPayment,
  legacyShiftSettings,
} from "../lib/settings";
import { bookings, businesses, expenses, members, sales, shifts } from "./schema";
import { addDays, dayOf, isOnShift, redactBooking, zonedInstant } from "../lib/team";
import { bookingShiftNumbers } from "../lib/shift-name";
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
    menuVersion: row.menuHistory.at(-1)?.id,
    legacyStockUses: legacyStockUses(row.menu, row.menuHistory.map((revision) => revision.previousMenu)),
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
    ...(row.stockSets?.length ? { stockSets: row.stockSets } : {}),
    ...(row.leftStock ? { leftStock: row.leftStock } : {}),
    ...(row.mergedAt ? { mergedAt: new Date(row.mergedAt).toISOString() } : {}),
    ...(row.openedBy ? { openedBy: row.openedBy } : {}),
  };
}

/** Keep the saved id for Undo, but a deleted booking is no longer a link. */
export async function tillBooking(tx: Transaction, shift: Pick<typeof shifts.$inferSelect, "businessId" | "bookingId">) {
  if (!shift.bookingId) return;
  const [booking] = await tx.select({ id: bookings.id, staff: bookings.staff }).from(bookings)
    .where(and(eq(bookings.businessId, shift.businessId), eq(bookings.id, shift.bookingId)));
  return booking;
}

export async function activeTill(
  tx: Transaction,
  running: (typeof shifts.$inferSelect)[],
  view: { till?: string | null; deviceId?: string },
  member: { id: string; primaryOwner: boolean },
  knownBookings: Pick<typeof bookings.$inferSelect, "id" | "staff">[] = [],
) {
  const shift = view.till !== undefined
    ? running.find((row) => row.id === view.till)
    : running.length === 1 ? running[0] : running.find((row) => row.deviceId === view.deviceId);
  if (!shift) return;
  const booking = knownBookings.find((row) => row.id === shift.bookingId) ?? await tillBooking(tx, shift);
  if (booking) return isOnShift(booking, member.id) ? shift : undefined;
  const deviceId = view.deviceId;
  if (deviceId && (shift.tillDevices?.[member.id]?.includes(deviceId) ||
    (!shift.tillDevices && member.primaryOwner && deviceId === shift.deviceId))) return shift;
}

export function presentExpense(row: typeof expenses.$inferSelect): Expense {
  return {
    id: row.id,
    shiftId: row.shiftId,
    createdAt: new Date(row.createdAt).toISOString(),
    label: row.label,
    amount: row.amount,
    source: row.source as Expense["source"],
    ...(row.deduction ? { deduction: row.deduction } : {}),
    ...(row.by ? { by: row.by } : {}),
    ...(row.voidedAt ? { voidedAt: new Date(row.voidedAt).toISOString() } : {}),
  };
}

/** A closed shift without its menu, but with the stock items its report names. */
function closedShift(row: typeof shifts.$inferSelect, currency: string) {
  const shift = presentShift({ ...row, menuHistory: [] }, currency);
  if (!row.stock && !row.stockSets?.length) return { ...shift, menu: [], legacyStockUses: undefined };
  const { items } = stockModel(shift.settings.stockItems, row.menu);
  return { ...shift, menu: [], legacyStockUses: undefined, settings: { ...shift.settings, stockItems: items } };
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
  bookingId: z.uuid().optional(),
});
type Position = z.infer<typeof position>;
type Page = { sales: Sale[]; nextSales?: string };

export async function historyPage(
  tx: Transaction,
  businessId: string | undefined,
  cursor: unknown,
  owner = false,
): Promise<Page> {
  ensure(
    typeof cursor === "string" && cursor.length <= 512,
    "Couldn't load older sales. Try again.",
  );
  let values;
  try {
    values = position.safeParse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    ensure(false, "Couldn't load older sales. Try again.");
  }
  ensure(values.success, "Couldn't load older sales. Try again.");
  const { newestShift, oldestShift } = values.data;
  ensure(oldestShift <= newestShift, "Couldn't load older sales. Try again.");
  if (!businessId || (values.data.bookingId && !owner)) return { sales: [] };
  return receiptsPage(tx, businessId, oldestShift, newestShift, values.data, values.data.bookingId);
}

async function receiptsPage(
  tx: Transaction,
  businessId: string,
  oldestShift: number,
  newestShift: number,
  after?: Position,
  bookingId?: string,
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
        bookingId ? and(eq(shifts.bookingId, bookingId), isNull(sales.reversedAt)) : undefined,
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
        bookingId,
        shift: last.shiftNumber,
        sequence: last.row.sequence,
      }),
    ).toString("base64url");
  }
  return { sales: result, nextSales };
}

export async function bookingRecords(tx: Transaction, businessId: string, input: unknown, kind: unknown) {
  const id = z.uuid().safeParse(input);
  ensure(id.success && (kind === "sales" || kind === "expenses"), "Choose a shift to see its sales and expenses.");
  const bookingId = id.data;
  const tills = await tx
    .select({ id: shifts.id, number: shifts.number })
    .from(shifts)
    .where(and(eq(shifts.businessId, businessId), eq(shifts.bookingId, bookingId)))
    .orderBy(shifts.number);
  if (!tills.length) return { sales: [], expenses: [] };
  if (kind === "sales") {
    const receipts = await receiptsPage(tx, businessId, tills[0].number, tills.at(-1)!.number, undefined, bookingId);
    return { ...receipts, expenses: [] };
  }
  const spent = await tx.select().from(expenses)
    .where(and(inArray(expenses.shiftId, tills.map((till) => till.id)), isNull(expenses.voidedAt)))
    .orderBy(desc(expenses.createdAt), desc(expenses.id));
  return { sales: [], expenses: spent.map(presentExpense) };
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
  view: { till?: string | null; deviceId?: string } = {},
): Promise<Bootstrap & { nextSales?: string }> {
  if (!access) return empty;
  // Read again: the command may have just changed them.
  const [business] = await tx.select().from(businesses).where(eq(businesses.id, access.business.id));
  const [member] = await tx.select().from(members).where(eq(members.id, access.member.id));
  if (!business) return empty;
  const me = presentMe(member ?? access.member);

  const running = await tx.select().from(shifts)
    .where(and(eq(shifts.businessId, business.id), isNull(shifts.closedAt)))
    .orderBy(desc(shifts.number));
  const closed = await tx.select().from(shifts)
    .where(and(eq(shifts.businessId, business.id), isNotNull(shifts.closedAt)))
    .orderBy(desc(shifts.number))
    .limit(30);
  // Two months back for the books, and everything ahead.
  const since = new Date(Date.now() - 62 * 86400000).toISOString();
  const recentBookings = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.businessId, business.id), gte(bookings.endsAt, since)))
    .orderBy(bookings.startsAt, bookings.id)
    .limit(1000);
  const recentTillBookingIds = [...running, ...closed].flatMap((shift) => shift.bookingId ? [shift.bookingId] : []);
  const otherBookings = await tx.select().from(bookings).where(and(eq(bookings.businessId, business.id), or(
    inArray(bookings.id, recentTillBookingIds),
    and(
      lt(bookings.endsAt, since),
      sql`${bookings.staff} @> ${JSON.stringify([{ memberId: me.memberId }])}::jsonb`,
      notExists(tx.select({ id: shifts.id }).from(shifts)
        .where(and(eq(shifts.businessId, business.id), eq(shifts.bookingId, bookings.id)))),
    ),
  )));
  const bookingsById = new Map([...recentBookings, ...otherBookings].map((booking) => [booking.id, booking]));
  const bookingRows = [...bookingsById.values()];
  const bookingIds = bookingRows.map((booking) => booking.id);
  // Count all shifts on a visible day, even when the calendar window cuts through that day.
  const sinceDayEnd = Date.parse(zonedInstant(addDays(dayOf(since, business.timeZone), 1), "00:00", business.timeZone));
  const lastDay = recentBookings.length === 1000 ? dayOf(recentBookings.at(-1)!.startsAt, business.timeZone) : undefined;
  const cappedDayStart = lastDay ? Date.parse(zonedInstant(lastDay, "00:00", business.timeZone)) : Infinity;
  const partialDays = new Set(bookingRows.filter(({ startsAt }) => {
    const start = Date.parse(startsAt);
    return start < sinceDayEnd || start >= cappedDayStart;
  }).map((row) => dayOf(row.startsAt, business.timeZone)));
  const peers = partialDays.size ? await tx.select({
    id: bookings.id, startsAt: bookings.startsAt, event: bookings.event, place: bookings.place, organizer: bookings.organizer,
  }).from(bookings).where(and(eq(bookings.businessId, business.id), or(...[...partialDays].map((day) => and(
    gte(bookings.startsAt, zonedInstant(day, "00:00", business.timeZone)),
    lt(bookings.startsAt, zonedInstant(addDays(day, 1), "00:00", business.timeZone)),
  ))))) : [];
  const shiftNumbers = bookingShiftNumbers([...new Map([...bookingRows, ...peers].map((row) => [row.id, row])).values()], business.timeZone);
  const closedBookings = new Set(bookingIds.length ? (await tx
    .selectDistinct({ bookingId: shifts.bookingId })
    .from(shifts)
    .where(and(eq(shifts.businessId, business.id), inArray(shifts.bookingId, bookingIds), isNotNull(shifts.closedAt))))
    .map((row) => row.bookingId) : []);
  const takings = new Map<string, number>();
  const spent = new Map<string, number>();
  if (me.owner && bookingRows.length) {
    const rows = await tx
      .select({ bookingId: shifts.bookingId, total: sum(sales.total).mapWith(Number) })
      .from(sales)
      .innerJoin(shifts, eq(sales.shiftId, shifts.id))
      .where(
        and(
          eq(shifts.businessId, business.id),
          isNull(sales.reversedAt),
          inArray(shifts.bookingId, bookingIds),
        ),
      )
      .groupBy(shifts.bookingId);
    for (const row of rows) if (row.bookingId) takings.set(row.bookingId, row.total ?? 0);
    const expensesByShift = await tx
      .select({ bookingId: shifts.bookingId, total: sum(expenses.amount).mapWith(Number) })
      .from(expenses)
      .innerJoin(shifts, eq(expenses.shiftId, shifts.id))
      .where(and(
        eq(shifts.businessId, business.id),
        isNull(expenses.voidedAt),
        inArray(shifts.bookingId, bookingRows.map((b) => b.id)),
      ))
      .groupBy(shifts.bookingId);
    for (const row of expensesByShift) if (row.bookingId) spent.set(row.bookingId, row.total ?? 0);
  }
  const faces = Object.fromEntries(
    (
      await tx
        .select({ id: members.id, photo: members.photo })
        .from(members)
        .where(and(eq(members.businessId, business.id), isNotNull(members.photo)))
    ).map((r) => [r.id, r.photo!]),
  );
  const plan = {
    me,
    faces,
    team: me.owner
      ? (await tx.select().from(members).where(eq(members.businessId, business.id)))
          .map((member) => presentMember(member, business.ownerId))
      : [],
    teamRoster: me.owner
      ? undefined
      : await tx.select({
          id: members.id,
          name: members.name,
          owner: members.owner,
          primaryOwner: eq(members.userId, business.ownerId).mapWith(Boolean),
        })
          .from(members)
          .where(and(eq(members.businessId, business.id), isNotNull(members.userId)))
          .orderBy(desc(eq(members.userId, business.ownerId)), desc(members.owner), asc(members.name)),
    organizers: me.owner ? business.organizers : [],
    bookings: bookingRows.map((row) =>
      redactBooking({
        ...presentBooking(row),
        shiftOfDay: shiftNumbers.get(row.id),
        sales: takings.get(row.id) ?? 0,
        expenses: spent.get(row.id) ?? 0,
        ...(closedBookings.has(row.id) ? { tillClosed: true } : {}),
      }, me),
    ),
  };
  const { id, name, currency, timeZone, menu } = business;
  const currentSettings = business.settings ?? defaultSettings(currency);
  const settings = me.owner ? currentSettings : withoutStockCosts(currentSettings);

  const recent = [...running, ...closed].sort((a, b) => b.number - a.number);
  const active = await activeTill(tx, running, view, { id: me.memberId, primaryOwner: access.member.userId === business.ownerId }, bookingRows);
  // Remember the phone before checkout can go offline. Keep its existing receipts syncable if staffing changes.
  if (active?.bookingId && bookingsById.has(active.bookingId) && view.deviceId) {
    const devices = active.tillDevices?.[me.memberId] ?? [];
    if (!devices.includes(view.deviceId)) {
      await tx.update(shifts).set({
        tillDevices: { ...active.tillDevices, [me.memberId]: [...devices, view.deviceId] },
      }).where(eq(shifts.id, active.id));
    }
  }
  const joinedIds = new Set(plan.team.filter((person) => person.joined).map((person) => person.id));
  const recoveryTillIds = me.owner ? running.filter((shift) => shift.id !== active?.id &&
    (!shift.bookingId || !bookingsById.get(shift.bookingId)?.staff.some((slot) => joinedIds.has(slot.memberId))))
    .map((shift) => shift.id) : [];
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
    menu: me.owner ? menu : withoutMenuCosts(menu),
    shift: active ? presentShift(active, currency) : null,
    soldOut: active?.soldOut ?? [],
    recoveryTillIds,
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
