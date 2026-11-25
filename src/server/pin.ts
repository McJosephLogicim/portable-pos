import { createPublicKey, generateKeyPair, privateDecrypt, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { getDb, type Transaction } from "./db";
import { businesses } from "./schema";
import { ensure, RegisterError } from "./errors";

const derive = promisify(scrypt);
const cooldown = 15 * 60 * 1000;

export async function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  const value = (await derive(pin, salt, 32)) as Buffer;
  return [salt, value.toString("hex")].join(".");
}

// Commit failed attempts. A primary-owner action can run under the same business lock.
export async function verifyPin(
  businessId: string,
  pin: string,
  primaryAction?: { userId: string; run: (tx: Transaction) => Promise<void> },
) {
  const result = await getDb().transaction(async (tx) => {
    const [business] = await tx
      .select()
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .for("update");
    // Another request may have finished deleting this business already.
    if (!business && primaryAction) return "ok";
    ensure(business, "Create your business first.", 404);
    if (primaryAction)
      ensure(business.ownerId === primaryAction.userId, "Only the primary owner can delete this business.", 403);
    const result = await checkPin(tx, business, pin);
    if (result === "ok" && primaryAction) await primaryAction.run(tx);
    return result;
  });
  if (result === "locked")
    throw new RegisterError(
      429,
      "Too many PIN attempts. Try again in 15 minutes.",
    );
  ensure(result === "ok", "Incorrect owner PIN.", 403);
}

// The sync transaction commits both a rejected correction and its failed PIN attempt.
export async function checkPin(tx: Transaction, business: typeof businesses.$inferSelect, pin: string) {
  const recentFailure =
    business.lastFailedAt &&
    Date.now() - Date.parse(business.lastFailedAt) < cooldown;
  const attempts = recentFailure ? business.failedPins : 0;
  if (attempts >= 5) return "locked";

  const [salt, hash] = business.pinHash.split(".");
  const value = (await derive(pin, salt, 32)) as Buffer;
  const matches = timingSafeEqual(value, Buffer.from(hash, "hex"));
  await tx
    .update(businesses)
    .set({
      failedPins: matches ? 0 : attempts + 1,
      lastFailedAt: matches ? null : new Date().toISOString(),
    })
    .where(eq(businesses.id, business.id));
  return matches ? "ok" : "invalid";
}

export async function reversalPublicKey(tx: Transaction, business: typeof businesses.$inferSelect) {
  let key = business.reversalPrivateKey;
  if (!key) {
    // resolveAccess holds the business lock while the first active till prepares its key.
    const pair = await promisify(generateKeyPair)("rsa", {
      modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    key = pair.privateKey;
    await tx.update(businesses).set({ reversalPrivateKey: key }).where(eq(businesses.id, business.id));
  }
  return createPublicKey(key).export({ type: "spki", format: "der" }).toString("base64");
}

export function openReversalPin(key: string | null, approval: string, label: Uint8Array) {
  if (!key) return null;
  try {
    return privateDecrypt({ key, oaepHash: "sha256", oaepLabel: label }, Buffer.from(approval, "base64")).toString("utf8");
  } catch {
    return null;
  }
}
