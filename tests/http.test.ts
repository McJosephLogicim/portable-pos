import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { POST } from "../src/app/api/pos/route";

// Optional integration test against a disposable local Supabase Auth instance
// with email autoconfirm enabled and a migrated PostgreSQL database.
test(
  "authenticated owners create isolated registers through the HTTP route",
  {
    skip: !(process.env.POS_TEST_AUTH_URL && process.env.POS_TEST_DATABASE_URL),
  },
  async () => {
    const url = new URL(process.env.POS_TEST_AUTH_URL!);
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
      "Use a disposable local Auth service",
    );
    const key = process.env.POS_TEST_AUTH_KEY ?? "local-integration-test";
    process.env.NEXT_PUBLIC_SUPABASE_URL = url.origin;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
    process.env.DATABASE_URL = process.env.POS_TEST_DATABASE_URL;
    async function owner() {
      const auth = createClient(url.origin, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const email = `owner-${randomUUID()}@example.com`;
      const password = randomUUID();
      const created = await auth.auth.signUp({ email, password });
      assert.ifError(created.error);
      const { data, error } = await auth.auth.signInWithPassword({
        email,
        password,
      });
      assert.ifError(error);
      assert.ok(data.session);
      return data.session.access_token;
    }
    async function post(token: string, body: object) {
      return POST(
        new Request("http://localhost/api/pos", {
          method: "POST",
          headers: { authorization: "Bearer " + token },
          body: JSON.stringify(body),
        }),
      );
    }
    const [first, second] = await Promise.all([owner(), owner()]);
    const request = {
      action: "setup",
      name: "HTTP test",
      currency: "PHP",
      timeZone: "Asia/Manila",
      pin: "4567",
    };
    assert.equal((await post("invalid-token", request)).status, 401);
    const response = await post(first, request);
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.business.name, "HTTP test");
    assert.deepEqual(saved.menu, []);
    const other = await post(second, {
      action: "bootstrap",
      businessId: saved.business.id,
    });
    assert.equal(other.status, 200);
    assert.equal((await other.json()).business, null);
  },
);
