import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { applyPlan, bookingIds, PlanError, type PlanCommand } from "../lib/team";
import type { Booking, Me, Member } from "../lib/types";
import type { Transaction } from "./db";
import { RegisterError } from "./errors";
import { bookings, businesses, members } from "./schema";

/** The signed-in person. Email is set only once Supabase has confirmed it. */
export interface Actor {
  id: string;
  email?: string | null;
}

type BusinessRow = typeof businesses.$inferSelect;
type MemberRow = typeof members.$inferSelect;

export function presentMember(row: MemberRow): Member {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roles: row.roles,
    rate: row.rate,
    owner: row.owner,
    joined: Boolean(row.userId),
  };
}
export function presentMe(row: MemberRow): Me {
  return { memberId: row.id, name: row.name, roles: row.roles, owner: row.owner };
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

/**
 * Find the business this person works for and lock it. Owners get a team row the
 * first time. An invited person joins the first time they sign in with that email.
 */
export async function resolveAccess(
  tx: Transaction,
  actor: Actor,
  lock = true,
): Promise<{ business: BusinessRow; member: MemberRow } | null> {
  const find = (where: ReturnType<typeof eq>) => {
    const query = tx.select().from(businesses).where(where);
    return lock ? query.for("update") : query;
  };
  const [owned] = await find(eq(businesses.ownerId, actor.id));
  if (owned) {
    let [member] = await tx
      .select()
      .from(members)
      .where(and(eq(members.businessId, owned.id), eq(members.userId, actor.id)));
    if (!member && lock) {
      [member] = await tx
        .insert(members)
        .values({
          id: crypto.randomUUID(),
          businessId: owned.id,
          userId: actor.id,
          email: actor.email ?? "",
          name: ownerName(actor),
          roles: ["cashier", "server"],
          owner: true,
        })
        .returning();
    }
    if (!member)
      member = {
        id: "owner",
        businessId: owned.id,
        userId: actor.id,
        email: actor.email ?? "",
        name: ownerName(actor),
        roles: ["cashier", "server"],
        rate: 0,
        owner: true,
      };
    return { business: owned, member };
  }
  let [member] = await tx.select().from(members).where(eq(members.userId, actor.id));
  if (!member && actor.email && lock) {
    const [invite] = await tx
      .select()
      .from(members)
      .where(
        and(
          isNull(members.userId),
          eq(sql`lower(${members.email})`, actor.email.trim().toLowerCase()),
        ),
      )
      .limit(1);
    if (invite) {
      [member] = await tx
        .update(members)
        .set({ userId: actor.id })
        .where(and(eq(members.id, invite.id), isNull(members.userId)))
        .returning();
    }
  }
  if (!member) return null;
  const [business] = await find(eq(businesses.id, member.businessId));
  return business ? { business, member } : null;
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
    members: memberRows.map(presentMember),
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
    if (taken) throw new RegisterError(409, "That shift id is already in use.");
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
        .set({ name: m.name, roles: ["cashier", "server"], rate: m.rate })
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
