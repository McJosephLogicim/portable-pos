import { expect, test, type Page } from "@playwright/test";
import { demoBootstrap } from "../src/lib/demo";
import { joinLink } from "../src/lib/join-link";
import type { Bootstrap } from "../src/lib/types";

const appUrl = process.env.POS_TEST_APP_URL ?? "http://localhost:3000";
const accountId = "2429d8fb-ce87-48b2-bc63-d3a99728497f";
const inviteCode = "invite42";
const teamId = "bfb566c0-718f-476e-b560-1c848e91d055";
const shiftId = "aabcaac3-b2c0-4617-b2b8-154a4a702098";
const email = "crew@example.test";
const authHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function teamSnapshot(): Bootstrap {
  const demo = demoBootstrap("auth-test");
  const business = { ...demo.business!, id: teamId, name: "Market Counter" };
  const booking = {
    ...demo.bookings![0],
    id: shiftId,
    place: { name: "Saturday market" },
    event: null,
    staff: [],
  };
  return { ...demo, business, bookings: [booking], shift: null, shifts: [] };
}

async function mockAuth(page: Page) {
  const user = { id: accountId, email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
  const token = {
    access_token: "test-access-token", refresh_token: "test-refresh-token",
    expires_in: 3600, token_type: "bearer", user,
  };
  let redirect: string | null = null;
  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = authHeaders;
    if (request.method() === "OPTIONS" || url.pathname.endsWith("/logout"))
      return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith("/signup")) {
      redirect = url.searchParams.get("redirect_to");
      return route.fulfill({ json: user, headers });
    }
    if (url.pathname.endsWith("/user"))
      return route.fulfill({ json: user, headers });
    if (url.pathname.endsWith("/token"))
      return route.fulfill({ json: token, headers });
    throw new Error("Unexpected request to Auth");
  });
  return () => redirect;
}

async function enterCredentials(page: Page) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("test-password");
}

test("a fresh visit and a stale register selection both show sign-in", async ({ page }) => {
  await page.addInitScript((id) => localStorage.setItem("portable-pos-account", id), accountId);
  await page.goto(appUrl);
  await expect(page.getByRole("heading", { name: "Sign in to your register" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page.getByRole("button", { name: "Account and settings" })).toBeVisible();
});

for (const [path, title] of [
  ["/i/" + inviteCode, "Join the team"],
  [joinLink(appUrl, teamId), "Open your team’s shifts"],
  [joinLink(appUrl, teamId, shiftId), "Open the shift"],
]) {
  test(`opens the ${title} entry even after visiting the demo`, async ({ page }) => {
    await page.goto(appUrl);
    await page.getByRole("button", { name: "Try the demo" }).click();
    await expect(page.getByRole("button", { name: "Account and settings" })).toBeVisible();
    await page.goto(new URL(path, appUrl).href);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try the demo" })).toHaveCount(0);
  });
}

test.describe("account-enabled link entry", () => {
  test.skip(
    !process.env.POS_TEST_MOCK_AUTH,
    "Use a local app started with test Supabase settings and set POS_TEST_MOCK_AUTH=1.",
  );
  test.use({ serviceWorkers: "block" });

  test("sign-in shows the branded loader until the register is ready", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mockAuth(page);
    const bootstrap = Promise.withResolvers<void>();
    await page.route("**/api/pos", async (route) => {
      await bootstrap.promise;
      await route.fulfill({ json: teamSnapshot() });
    });
    try {
      await page.goto(appUrl);
      await enterCredentials(page);
      await page.locator("button[type=submit]").click();

      const main = page.getByRole("main");
      const status = main.getByRole("status");
      await expect(status).toHaveText("Getting your register ready…");
      await expect(main.getByText("Portable POS", { exact: true })).toBeVisible();
      const mark = main.locator('[aria-hidden="true"]');
      const { openingOpacities, timings } = await mark.evaluate((element) => {
        const animations = element.getAnimations({ subtree: true });
        const timings = animations.map(({ effect }) => ({
          start: Number(effect?.getTiming().delay),
          end: Number(effect?.getComputedTiming().endTime),
        }));
        for (const animation of animations) {
          animation.pause();
          animation.currentTime = 0;
        }
        const openingOpacities = Array.from(element.children, (tile) => getComputedStyle(tile).opacity);
        return { openingOpacities, timings };
      });
      expect(openingOpacities).toEqual(["0", "0", "0"]);
      expect(timings).toHaveLength(3);
      expect(timings[1].start).toBeGreaterThanOrEqual(timings[0].end);
      expect(timings[2].start).toBeGreaterThanOrEqual(timings[1].end);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect.poll(() => main.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
      await expect(status).toHaveCSS("opacity", "1");
    } finally {
      bootstrap.resolve();
    }
    await expect(page.getByRole("button", { name: /Switch business, now Market Counter/ })).toBeVisible();
    await expect(page.getByText("Getting your register ready…")).toHaveCount(0);
  });

  const shiftLink = new URL(joinLink(appUrl, teamId, shiftId));
  for (const { label, link, query } of [
    { label: "business invite", link: new URL("/i/" + inviteCode, appUrl).href, query: "?invite=" + inviteCode },
    { label: "shared shift", link: shiftLink.href, query: "?j=" + shiftLink.pathname.split("/").at(-1) },
  ]) {
    test(`opens the ${label} after email confirmation in a fresh browser`, async ({ page, browser }) => {
      const redirect = await mockAuth(page);
      await page.goto(link);
      await page.getByRole("group", { name: "Account" }).getByRole("button", { name: "Create account" }).click();
      await enterCredentials(page);
      await page.locator("button[type=submit]").click();
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
      expect(redirect()).toBe(new URL("/" + query, appUrl).href);

      const confirmation = await browser.newPage({ serviceWorkers: "block" });
      try {
        await mockAuth(confirmation);
        const commands: Record<string, unknown>[] = [];
        await confirmation.route("**/api/pos", async (route) => {
          commands.push(route.request().postDataJSON());
          await route.fulfill({ json: teamSnapshot() });
        });
        await confirmation.goto(redirect() + "#access_token=test-access-token&refresh_token=test-refresh-token&expires_in=3600&token_type=bearer&type=signup");
        await expect(confirmation.getByRole("button", { name: "Shifts", exact: true })).toHaveAttribute("aria-current", "page");
        await expect(confirmation.getByRole("button", { name: /Switch business, now Market Counter/ })).toBeVisible();
        const invitations = commands.filter((cmd) => cmd.action === "acceptInvite");
        if (label === "business invite")
          expect(invitations).toEqual([{ action: "acceptInvite", code: inviteCode }]);
        else {
          expect(invitations).toEqual([]);
          await expect(confirmation.getByRole("dialog", { name: "Saturday market", exact: true })).toBeVisible();
        }
        expect(new URL(confirmation.url()).search).toBe("");
      } finally {
        await confirmation.close();
      }
    });
  }

  test("sign-in opens the requested shift in a secondary business", async ({ page }) => {
    await mockAuth(page);
    const team = teamSnapshot();
    const primary = {
      ...team,
      business: { ...team.business!, id: "e52d28ea-ba88-4ffb-a20e-040a1dbfd8b2", name: "Other Counter" },
      bookings: [],
      businesses: [{ id: teamId, name: "Market Counter", owner: false }],
    };
    await page.route("**/api/pos", (route) =>
      route.fulfill({ json: route.request().headers()["x-business-id"] === teamId ? team : primary }));
    await page.goto(joinLink(appUrl, teamId, shiftId));
    await enterCredentials(page);
    await page.locator("button[type=submit]").click();
    await expect(page.getByRole("dialog", { name: "Saturday market", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Switch business, now Market Counter/ })).toBeVisible();
  });

  test("a shift link requires team access and survives switching accounts", async ({ page }) => {
    await mockAuth(page);
    await page.route("**/api/pos", (route) =>
      route.fulfill({ json: { business: null, menu: [], shift: null, shifts: [], soldOut: [], sales: [] } }));
    await page.goto(joinLink(appUrl, teamId, shiftId));
    await enterCredentials(page);
    await page.locator("button[type=submit]").click();
    await expect(page.getByRole("heading", { name: "You can’t open this shift" })).toBeVisible();
    await page.getByRole("button", { name: "Use another account" }).click();
    await expect(page.getByRole("heading", { name: "Open the shift" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Open the shift" })).toBeVisible();
  });
});

test("switches saved accounts without signing in again or mixing their registers", async ({ page }) => {
  test.skip(!process.env.POS_TEST_MOCK_AUTH, "Use a local app started with test Supabase settings.");
  const otherId = "d4ffdb18-fd04-4e87-b627-97460ceb7436";
  const emails = { [email]: accountId, "secondary@example.test": otherId };
  let signIns = 0;
  await page.route("**/auth/v1/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: authHeaders });
    expect(new URL(req.url()).pathname.endsWith("/token")).toBe(true);
    const address = req.postDataJSON().email as keyof typeof emails;
    const id = emails[address];
    expect(id).toBeTruthy();
    signIns++;
    return route.fulfill({
      headers: authHeaders,
      json: {
        access_token: "token-" + id, refresh_token: "refresh-" + id, expires_in: 3600,
        token_type: "bearer", user: { id, email: address, aud: "authenticated", role: "authenticated" },
      },
    });
  });
  await page.route("**/api/pos", (route) => {
    const actor = route.request().headers().authorization;
    expect(["Bearer token-" + accountId, "Bearer token-" + otherId]).toContain(actor);
    const first = actor === "Bearer token-" + accountId;
    const snapshot = teamSnapshot();
    return route.fulfill({ json: {
      ...snapshot,
      business: { ...snapshot.business!, id: first ? teamId : otherId, name: first ? "Market Counter" : "Bakery Counter" },
      me: { ...snapshot.me!, name: first ? "Market Owner" : "Bakery Owner" },
    } });
  });
  await page.goto(appUrl);
  await enterCredentials(page);
  await page.locator("button[type=submit]").click();
  await expect(page.getByRole("button", { name: /Switch business, now Market Counter/ })).toBeVisible();
  async function picker() {
    await page.getByRole("button", { name: "Account and settings" }).click();
    await page.getByRole("button", { name: "Switch account", exact: true }).click();
    return page.getByRole("dialog", { name: "Switch account" });
  }
  await (await picker()).getByRole("button", { name: "Add account", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Add account" });
  await add.getByLabel("Email", { exact: true }).fill("secondary@example.test");
  await add.getByLabel("Password", { exact: true }).fill("fixture-password");
  await add.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: /Switch business, now Bakery Counter/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /Switch business, now Bakery Counter/ })).toBeVisible();
  await (await picker()).getByRole("button", { name: /Market Owner/ }).click();
  await expect(page.getByRole("button", { name: /Switch business, now Market Counter/ })).toBeVisible();
  await (await picker()).getByRole("button", { name: /Bakery Owner/ }).click();
  await expect(page.getByRole("button", { name: /Switch business, now Bakery Counter/ })).toBeVisible();
  expect(signIns).toBe(2);
});
