import assert from "node:assert/strict";
import test from "node:test";
import { LOGIN_LIFETIME_MS, LoginExpired, loginDeadline } from "../src/lib/login-session";
import { authenticatedOwner } from "../src/server/auth";

function token(signedInAt: number, issuedAt: number) {
  const payload = Buffer.from(JSON.stringify({
    iat: issuedAt / 1000,
    exp: issuedAt / 1000 + 3600,
    amr: [
      { method: "password", timestamp: signedInAt / 1000 },
      { method: "totp", timestamp: issuedAt / 1000 },
    ],
  })).toString("base64url");
  return `header.${payload}.signature`;
}

test("refresh and additional authentication methods keep the original login deadline", () => {
  const started = Date.parse("2026-11-23T01:00:00Z");
  const deadline = started + LOGIN_LIFETIME_MS;
  const access = token(started, deadline - 1000);
  assert.equal(loginDeadline(access, deadline - 1), deadline);
  assert.throws(() => loginDeadline(access, deadline), LoginExpired);
  assert.throws(() => loginDeadline("not-a-session"), LoginExpired);
});

test("the register rejects a verified bearer past the login deadline", async (t) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:58123";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  const user = { id: "account", email: "owner@example.test", email_confirmed_at: "2026-01-01" };
  const verify = t.mock.method(globalThis, "fetch", async () => Response.json(user));
  const issue = Math.floor(Date.now() / 1000) * 1000;
  const request = (started: number) => new Request("http://localhost/api/pos", {
    headers: { authorization: "Bearer " + token(started, issue) },
  });
  assert.equal((await authenticatedOwner(request(issue))).id, user.id);
  await assert.rejects(authenticatedOwner(request(issue - LOGIN_LIFETIME_MS)), { status: 401 });
  assert.equal(verify.mock.callCount(), 2);
});
