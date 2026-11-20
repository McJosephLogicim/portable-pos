import { and, eq, gt } from "drizzle-orm";
import { SHIFT_CODE, shortCode, TEAM_CODE } from "../lib/join-link";
import type { LinkPreview } from "../lib/types";
import { getDb } from "./db";
import { bookings, businesses, members } from "./schema";

/*
 * What a link shows before sign-in. The codes are the secret, so a preview carries only what the
 * person holding the link is meant to see: the business's name and branding, their own name on
 * an invite, and where and when a shared shift is. Never pay, rent, quotas, emails or teammates.
 */

function brandOf(row: typeof businesses.$inferSelect): LinkPreview["business"] {
  const logo = row.settings?.logo;
  const brand = row.settings?.brand;
  return {
    name: row.name,
    ...(logo ? { logo } : {}),
    ...(brand && /^#[0-9a-f]{6}$/i.test(brand) ? { brand } : {}),
  };
}

/** A pending /i/ invite: whose business, who invited, and who it is for. */
export async function invitePreview(code: string): Promise<LinkPreview | null> {
  const db = getDb();
  const [row] = await db
    .select({ member: members, business: businesses })
    .from(members)
    .innerJoin(businesses, eq(businesses.id, members.businessId))
    .where(eq(members.inviteCode, code));
  if (!row || row.member.userId) return null;
  const [owner] = await db
    .select({ name: members.name })
    .from(members)
    .where(and(eq(members.businessId, row.business.id), eq(members.userId, row.business.ownerId)));
  return {
    business: brandOf(row.business),
    invite: {
      name: row.member.name,
      owner: row.member.owner,
      ...(owner?.name ? { invitedBy: owner.name } : {}),
    },
  };
}

/**
 * A shared /j/ shift link. Short codes are cut from the ids, so the shift is found among
 * shifts that have not ended a day ago. Team-only codes are short enough to guess, so they
 * get no preview.
 */
export async function shiftPreview(code: string): Promise<LinkPreview | null> {
  if (code.length !== TEAM_CODE + SHIFT_CODE) return null;
  const team = code.slice(0, TEAM_CODE);
  const shift = code.slice(TEAM_CODE);
  const rows = await getDb()
    .select({ booking: bookings, business: businesses })
    .from(bookings)
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .where(gt(bookings.endsAt, new Date(Date.now() - 86_400_000).toISOString()));
  const row = rows.find(
    (r) => shortCode(r.booking.id, SHIFT_CODE) === shift && shortCode(r.business.id, TEAM_CODE) === team,
  );
  if (!row) return null;
  const b = row.booking;
  return {
    business: brandOf(row.business),
    shift: {
      startsAt: new Date(b.startsAt).toISOString(),
      endsAt: new Date(b.endsAt).toISOString(),
      timeZone: row.business.timeZone,
      ...(b.place?.name ? { place: b.place.name } : {}),
      ...(b.event?.name ? { event: b.event.name } : {}),
      seats: b.seats,
      taken: Math.min(b.staff.length, b.seats),
    },
  };
}
