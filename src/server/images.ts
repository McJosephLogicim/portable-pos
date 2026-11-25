import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { ensure } from "./errors";
import { images, members } from "./schema";
import { resolveAccess, type Actor } from "./team";

const types = ["image/jpeg", "image/webp", "image/png"];
export const maxImageBytes = 400_000;

/**
 * Store a photo. Menu, checklist and logo photos are the owner's and are public by
 * address. Proof photos taken at checkout can come from anyone on the team, and are
 * served only to people on the business.
 */
export async function saveImage(actor: Actor, type: string, data: Buffer, proof = false, face = false, requestedId?: string) {
  ensure(types.includes(type), "Use a JPEG, PNG or WebP photo.", 415);
  ensure(data.byteLength > 0 && data.byteLength <= maxImageBytes, "That photo is too large. Try again.", 413);
  return getDb().transaction(async (tx) => {
    const access = await resolveAccess(tx, actor);
    ensure(access, "Create your business first.", 404);
    // Anyone on the team can add their own profile photo.
    ensure(proof || face || access.member.owner, "Only the owner can add photos.", 400);
    const id = requestedId ?? crypto.randomUUID();
    ensure(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id), "Invalid photo identifier.");
    if (requestedId) {
      const [prior] = await tx.select().from(images).where(eq(images.id, id));
      if (prior) {
        ensure(prior.businessId === access.business.id && prior.type === type && prior.private === proof && prior.data.equals(data), "Photo identifier already in use.", 409);
        return (proof ? "/api/proofs/" : "/api/images/") + id;
      }
    }
    await tx.insert(images).values({
      id,
      businessId: access.business.id,
      type,
      data,
      private: proof,
      createdAt: new Date().toISOString(),
    });
    return (proof ? "/api/proofs/" : "/api/images/") + id;
  });
}

export async function readImage(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [row] = await getDb()
    .select({ type: images.type, data: images.data })
    .from(images)
    .where(and(eq(images.id, id), eq(images.private, false)));
  return row ?? null;
}

/** A proof photo, only for someone on the business it was taken for. */
export async function readProof(actor: Actor, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [row] = await getDb()
    .select({ type: images.type, data: images.data })
    .from(images)
    .innerJoin(members, eq(members.businessId, images.businessId))
    .where(and(eq(images.id, id), eq(images.private, true), eq(members.userId, actor.id)))
    .limit(1);
  return row ?? null;
}
