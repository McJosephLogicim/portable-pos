import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { businesses } from "./schema";
import { ensure, RegisterError } from "./errors";

const derive = promisify(scrypt);
const cooldown = 15 * 60 * 1000;

export async function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  const value = (await derive(pin, salt, 32)) as Buffer;
  return [salt, value.toString("hex")].join(".");
}

// Commit the attempt counter even when the subsequent owner operation is refused.
export async function verifyPin(businessId: string, pin: string) {
  const result = await getDb().transaction(async (tx) => {
    const [business] = await tx
      .select()
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .for("update");
    ensure(business, "Create your business first.", 404);
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
  });
  if (result === "locked")
    throw new RegisterError(
      429,
      "Too many PIN attempts. Try again in 15 minutes.",
    );
  ensure(result === "ok", "Incorrect owner PIN.", 403);
}
