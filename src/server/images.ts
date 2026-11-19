import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { ensure } from "./errors";
import { images } from "./schema";
import { resolveAccess, type Actor } from "./team";

const types = ["image/jpeg", "image/webp", "image/png"];
export const maxImageBytes = 400_000;

/** Store a photo the owner took for a menu item or checklist step. */
export async function saveImage(actor: Actor, type: string, data: Buffer) {
  ensure(types.includes(type), "Use a JPEG, PNG or WebP photo.", 415);
  ensure(data.byteLength > 0 && data.byteLength <= maxImageBytes, "That photo is too large. Try again.", 413);
  return getDb().transaction(async (tx) => {
    const access = await resolveAccess(tx, actor);
    ensure(access, "Create your business first.", 404);
    ensure(access.member.owner, "Only the owner can add photos.", 400);
    const id = crypto.randomUUID();
    await tx.insert(images).values({
      id,
      businessId: access.business.id,
      type,
      data,
      createdAt: new Date().toISOString(),
    });
    return "/api/images/" + id;
  });
}

export async function readImage(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [row] = await getDb()
    .select({ type: images.type, data: images.data })
    .from(images)
    .where(and(eq(images.id, id)));
  return row ?? null;
}
