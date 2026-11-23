export const LOGIN_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

export class LoginExpired extends Error {
  constructor() {
    super("Your sign-in expired. Sign in again to continue.");
  }
}

/** Supabase retains the original authentication timestamp when it refreshes a token. */
export function loginDeadline(token: string, now = Date.now()): number {
  let signedInAt = Infinity;
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { amr } = JSON.parse(atob(payload)) as { amr?: { timestamp?: number }[] };
    if (Array.isArray(amr)) {
      for (const entry of amr) {
        const seconds = entry?.timestamp;
        if (typeof seconds === "number" && Number.isSafeInteger(seconds) && seconds > 0)
          signedInAt = Math.min(signedInAt, seconds * 1000);
      }
    }
  } catch {
    // Without an authentication timestamp, ask for a fresh sign-in.
  }
  const expiresAt = signedInAt + LOGIN_LIFETIME_MS;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) throw new LoginExpired();
  return expiresAt;
}
