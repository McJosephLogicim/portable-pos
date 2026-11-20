import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { applyPlan, bookingIds, PlanError, type PlanCommand } from "../lib/team";
import type { Booking, BusinessSummary, Me, Member } from "../lib/types";
import type { Transaction } from "./db";
import { RegisterError } from "./errors";
import { bookings, businesses, members } from "./schema";

/** The signed-in person. Email is set only once Supabase has confirmed it. */
export interface Actor {
  id: string;
  email?: string | null;
  /** The business picked in the app. Without it, the person's first business. */
  businessId?: string;
}

type BusinessRow = typeof businesses.$inferSelect;
type MemberRow = typeof members.$inferSelect;

export function presentMember(row: MemberRow, primaryOwnerId: string): Member {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roles: row.roles,
    rate: row.rate,
    owner: row.owner,
    ...(row.userId === primaryOwnerId ? { primaryOwner: true } : {}),
    joined: Boolean(row.userId),
    ...(row.photo ? { photo: row.photo } : {}),
  };
}
export function presentMe(row: MemberRow): Me {
  return { memberId: row.id, name: row.name, roles: row.roles, owner: row.owner, ...(row.photo ? { photo: row.photo } : {}) };
}
export function presentBooking(row: typeof bookings.$inferSelect): Booking {
  return {
    id: row.id,
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: new Date(row.endsAt).toISOString(),
    place: row.place,
    organizer: row.organizer,
    event: row.event,
    seats: row.seats,
    staff: row.staff,
    rent: row.rent,
    quota: row.quota,
    incentive: row.incentive,
  };
}

function ownerName(actor: Actor) {
  const local = actor.email?.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80) : "Owner";
}

/** Joins any invites sent to this person's confirmed email, on every business. */
async function claimInvites(tx: Transaction, actor: Actor) {
  if (!actor.email) return;
  await tx
    .update(members)
    .set({ userId: actor.id })
    .where(
      and(
        isNull(members.userId),
        eq(sql`lower(${members.email})`, actor.email.trim().toLowerCase()),
        sql`not exists (select 1 from portable_pos.members m where m.business_id = members.business_id and m.user_id = ${actor.id})`,
      ),
    );
}

/** Owners get a team row on each business they own, so they can work shifts. */
async function ownerRows(tx: Transaction, actor: Actor) {
  const owned = await tx
    .select({ id: businesses.id })
    .from(businesses)
    .leftJoin(members, and(eq(members.businessId, businesses.id), eq(members.userId, actor.id)))
    .where(and(eq(businesses.ownerId, actor.id), isNull(members.id)));
  for (const b of owned)
    await tx.insert(members).values({
      id: crypto.randomUUID(),
      businessId: b.id,
      userId: actor.id,
      email: actor.email ?? "",
      name: ownerName(actor),
      roles: ["cashier", "server"],
      owner: true,
    });
}

/** Every business this person is on, owned ones first, oldest first. */
export async function listBusinesses(tx: Transaction, actor: Actor): Promise<BusinessSummary[]> {
  const rows = await tx
    .select({ business: businesses, member: members })
    .from(members)
    .innerJoin(businesses, eq(businesses.id, members.businessId))
    .where(eq(members.userId, actor.id))
    .orderBy(desc(members.owner), asc(businesses.createdAt), asc(businesses.id));
  return rows.map(({ business, member }) => ({
    id: business.id,
    name: business.name,
    owner: member.owner,
    ...(business.settings?.logo ? { logo: business.settings.logo } : {}),
    ...(business.settings?.brand ? { brand: business.settings.brand } : {}),
  }));
}

/**
 * Find the business this person is working in and lock it. Owners get a team row the
 * first time. An invited person joins the first time they sign in with that email.
 * Without a business id, prefer a business they created. Access changes don't switch registers.
 */
export async function resolveAccess(
  tx: Transaction,
  actor: Actor,
  lock = true,
): Promise<{ business: BusinessRow; member: MemberRow } | null> {
  if (lock) {
    await claimInvites(tx, actor);
    await ownerRows(tx, actor);
  }
  const mine = actor.businessId
    ? and(eq(members.userId, actor.id), eq(members.businessId, actor.businessId))
    : eq(members.userId, actor.id);
  let [member] = await tx
    .select()
    .from(members)
    .innerJoin(businesses, eq(businesses.id, members.businessId))
    .where(mine)
    .orderBy(desc(eq(businesses.ownerId, actor.id)), asc(businesses.createdAt), asc(businesses.id))
    .limit(1)
    .then((rows) => rows.map((r) => r.members));
  if (!member && !lock) {
    // A read before the owner row exists still sees the owner's business.
    const [owned] = await tx
      .select()
      .from(businesses)
      .where(
        actor.businessId
          ? and(eq(businesses.ownerId, actor.id), eq(businesses.id, actor.businessId))
          : eq(businesses.ownerId, actor.id),
      )
      .orderBy(asc(businesses.createdAt), asc(businesses.id))
      .limit(1);
    if (owned)
      member = {
        id: "owner",
        businessId: owned.id,
        userId: actor.id,
        email: actor.email ?? "",
        name: ownerName(actor),
        roles: ["cashier", "server"],
        photo: null,
        rate: 0,
        owner: true,
        createdAt: owned.createdAt,
      };
  }
  if (!member) return null;
  const query = tx.select().from(businesses).where(eq(businesses.id, member.businessId));
  const [business] = await (lock ? query.for("update") : query);
  if (business && lock) {
    // Access can change while this request waits for the business lock.
    [member] = await tx.select().from(members).where(eq(members.id, member.id));
  }
  return business && member ? { business, member } : null;
}

/** Run a team or schedule command against the locked business. */
export async function runPlan(
  tx: Transaction,
  business: BusinessRow,
  me: Me,
  cmd: PlanCommand,
) {
  const memberRows = await tx.select().from(members).where(eq(members.businessId, business.id));
  const ids = bookingIds(cmd);
  const loaded = new Map<string, Booking>();
  const rows = [
    ...(ids.length
      ? await tx
          .select()
          .from(bookings)
          .where(and(eq(bookings.businessId, business.id), inArray(bookings.id, ids)))
      : []),
    ...(cmd.action === "removeMember"
      ? await tx
          .select()
          .from(bookings)
          .where(and(eq(bookings.businessId, business.id), gt(bookings.startsAt, new Date().toISOString())))
      : []),
  ];
  for (const row of rows) loaded.set(row.id, presentBooking(row));
  const before = {
    members: memberRows.map((member) => presentMember(member, business.ownerId)),
    organizers: business.organizers,
    bookings: [...loaded.values()],
  };
  let after;
  try {
    after = applyPlan(before, me, cmd);
  } catch (error) {
    if (error instanceof PlanError) throw new RegisterError(error.status, error.message);
    throw error;
  }
  // A booking id that belongs to another business must never be overwritten.
  if (cmd.action === "booking" && !loaded.has(cmd.booking.id)) {
    const [taken] = await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, cmd.booking.id));
    if (taken) throw new RegisterError(409, "That shift was already added.");
  }

  for (const m of before.members)
    if (!after.members.some((x) => x.id === m.id))
      await tx.delete(members).where(and(eq(members.id, m.id), eq(members.businessId, business.id)));
  for (const m of after.members) {
    const old = before.members.find((x) => x.id === m.id);
    if (!old)
      await tx.insert(members).values({
        id: m.id,
        businessId: business.id,
        email: m.email,
        name: m.name,
        roles: ["cashier", "server"],
        rate: m.rate,
      });
    else if (JSON.stringify(old) !== JSON.stringify(m))
      await tx
        .update(members)
        .set({ name: m.name, roles: ["cashier", "server"], rate: m.rate, owner: m.owner })
        .where(eq(members.id, m.id));
  }
  if (JSON.stringify(after.organizers) !== JSON.stringify(before.organizers))
    await tx.update(businesses).set({ organizers: after.organizers }).where(eq(businesses.id, business.id));
  for (const b of before.bookings)
    if (!after.bookings.some((x) => x.id === b.id))
      await tx.delete(bookings).where(and(eq(bookings.id, b.id), eq(bookings.businessId, business.id)));
  for (const b of after.bookings) {
    const old = before.bookings.find((x) => x.id === b.id);
    if (old && JSON.stringify(old) === JSON.stringify(b)) continue;
    const values = {
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      place: b.place,
      organizer: b.organizer,
      event: b.event,
      seats: b.seats,
      staff: b.staff,
      rent: b.rent ?? 0,
      quota: b.quota,
      incentive: b.incentive,
    };
    if (old)
      await tx
        .update(bookings)
        .set(values)
        .where(and(eq(bookings.id, b.id), eq(bookings.businessId, business.id)));
    else await tx.insert(bookings).values({ id: b.id, businessId: business.id, ...values });
  }
}
