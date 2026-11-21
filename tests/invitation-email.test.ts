import assert from "node:assert/strict";
import test from "node:test";
import { sendInvitationEmail } from "../src/server/invitation-email";

test("team invitations use the POP POS display name and the configured mailbox", async (t) => {
  const displayName = "POP POS";
  const address = "team@example.com";
  const origin = "https://pos.example.com";
  for (const [name, value] of Object.entries({
    RESEND_API_KEY: "test-mail-key",
    POS_INVITE_FROM: address,
    POS_APP_URL: origin,
  })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  const send = t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(new Headers(options.headers).get("Authorization"), "Bearer test-mail-key");
    const message = JSON.parse(String(options.body));
    assert.equal(message.from, `${displayName} <${address}>`);
    assert.equal(message.subject, "You're invited to a team on POP POS");
    assert.match(message.text, /join Market Counter on POP POS/);
    assert.ok(message.text.endsWith(`${origin}/i/test-invite`));
    return new Response("{}", { status: 200 });
  });

  const business = { id: "business-1", name: "Market Counter" };
  for (const configuredFrom of [address, `Previous Brand <${address}>`]) {
    process.env.POS_INVITE_FROM = configuredFrom;
    assert.equal(await sendInvitationEmail(business, "crew@example.com", "test-invite"), "sent");
  }
  assert.equal(send.mock.callCount(), 2);
});
