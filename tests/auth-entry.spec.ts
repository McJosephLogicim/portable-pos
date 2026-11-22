import { expect, test, type Page } from "@playwright/test";
import { popoLoading } from "../src/lib/app-brand";
import { demoBootstrap } from "../src/lib/demo";
import { makeSale } from "../src/lib/domain";
import { joinLink } from "../src/lib/join-link";
import type { Bootstrap } from "../src/lib/types";

const appUrl = process.env.POS_TEST_APP_URL ?? "http://localhost:3000";
const accountId = "2429d8fb-ce87-48b2-bc63-d3a99728497f";
const inviteCode = "invite42";
const teamId = "bfb566c0-718f-476e-b560-1c848e91d055";
const shiftId = "aabcaac3-b2c0-4617-b2b8-154a4a702098";
const email = "crew@example.test";
const verificationCode = "012345";
const authHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "X-Supabase-Api-Version",
  "X-Supabase-Api-Version": "2024-01-01",
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

async function mockAuth(page: Page, { unconfirmed = false } = {}) {
  const user = { id: accountId, email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
  const token = {
    access_token: "test-access-token", refresh_token: "test-refresh-token",
    expires_in: 3600, token_type: "bearer", user,
  };
  await page.route("**/auth/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = authHeaders;
    if (request.method() === "OPTIONS" || url.pathname.endsWith("/logout"))
      return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith("/signup"))
      return route.fulfill({ json: user, headers });
    if (url.pathname.endsWith("/verify")) {
      const { token: code, ...body } = request.postDataJSON();
      expect(body).toMatchObject({ email, type: "email" });
      return code === verificationCode
        ? route.fulfill({ json: token, headers })
        : route.fulfill({ status: 403, json: { code: "otp_expired", msg: "Token has expired or is invalid" }, headers });
    }
    if (url.pathname.endsWith("/resend")) {
      expect(request.postDataJSON()).toMatchObject({ email, type: "signup" });
      return route.fulfill({ json: {}, headers });
    }
    if (url.pathname.endsWith("/user"))
      return route.fulfill({ json: user, headers });
    if (url.pathname.endsWith("/token"))
      return unconfirmed
        ? route.fulfill({ status: 400, json: { code: "email_not_confirmed", msg: "Email not confirmed" }, headers })
        : route.fulfill({ json: token, headers });
    throw new Error("Unexpected request to Auth");
  });
}

async function enterCredentials(page: Page) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("test-password");
}

test("a fresh visit and a stale register selection both show sign-in", async ({ page }) => {
  await page.addInitScript((id) => localStorage.setItem("portable-pos-account", id), accountId);
  await page.goto(appUrl);
  await expect(page.getByRole("heading", { name: "Sign in to your Pop-up" })).toBeVisible();
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

  test("an older shift prefetches its records and keeps its totals visible during requests", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.setFixedTime(new Date("2026-11-21T04:00:00Z"));
    await mockAuth(page);
    const snapshot = { ...teamSnapshot(), onboardingComplete: true };
    const demo = demoBootstrap("history-test");
    const till = demo.shift!;
    const espresso = demo.menu.find((item) => item.name === "Espresso")!;
    const sale = makeSale({
      id: "archived-receipt", shift: till, sequence: 1, cart: [{ productId: espresso.id, quantity: 1, optionIds: [] }],
      soldOut: [], tender: "cash", received: espresso.price, createdAt: "2026-11-21T01:30:00Z",
    });
    const expense = { id: "archived-expense", shiftId: till.id, label: "Ice packs", source: "till", amount: 2000, createdAt: sale.createdAt };
    snapshot.bookings![0] = {
      ...snapshot.bookings![0], startsAt: "2026-11-21T01:00:00Z", endsAt: "2026-11-21T03:00:00Z",
      sales: sale.total, expenses: expense.amount,
    };

    const finishSales = Promise.withResolvers<void>();
    const finishExpenses = Promise.withResolvers<void>();
    const requested = new Set<string>();
    let salesRequests = 0;
    await page.route("**/api/pos", async (route) => {
      const { action, kind } = route.request().postDataJSON();
      if (action !== "bookingRecords") return route.fulfill({ json: snapshot });
      requested.add(kind);
      if (kind === "expenses") {
        await finishExpenses.promise;
        return route.fulfill({ json: { sales: [], expenses: [expense] } });
      }
      salesRequests++;
      if (salesRequests === 1) {
        await finishSales.promise;
        return route.fulfill({ status: 503, json: { error: "Couldn’t load these receipts." } });
      }
      return route.fulfill({ json: { sales: [sale], expenses: [] } });
    });

    try {
      await page.goto(appUrl);
      await enterCredentials(page);
      await page.locator("button[type=submit]").click();
      await page.getByRole("button", { name: "Shifts", exact: true }).click();
      await page.getByRole("button", { name: /Saturday market/ }).click();
      const shift = page.getByRole("dialog", { name: "Saturday market" });
      await expect.poll(() => [...requested].sort()).toEqual(["expenses", "sales"]);

      await shift.getByRole("button", { name: /^Sales ₱/ }).click();
      const sales = page.getByRole("dialog", { name: "Sales", exact: true });
      await expect(sales.getByRole("group", { name: "Sales receipts" })).toHaveAttribute("aria-busy", "true");
      await expect(sales.locator(".big-num")).toHaveText(`₱${sale.total / 100}`);
      await expect(sales.getByText("Loading shift history…")).toHaveCount(0);
      finishSales.resolve();
      await sales.getByRole("button", { name: "Retry" }).click();
      await expect(sales.getByText("Espresso", { exact: true })).toBeVisible();
      await sales.getByRole("button", { name: "Close", exact: true }).click();

      await shift.getByRole("button", { name: /^Expenses/ }).click();
      const expenses = page.getByRole("dialog", { name: "Expenses", exact: true });
      await expect(expenses.getByRole("group", { name: "Expenses" })).toHaveAttribute("aria-busy", "true");
      finishExpenses.resolve();
      await expect(expenses.getByText("Ice packs")).toBeVisible();
      await expenses.getByRole("button", { name: "Close", exact: true }).click();
      await shift.getByRole("button", { name: /^Expenses/ }).click();
      await expect(expenses.getByText("Ice packs")).toBeVisible();
      await expect(expenses.getByRole("group", { name: "Expenses" })).not.toHaveAttribute("aria-busy", "true");
    } finally {
      finishSales.resolve();
      finishExpenses.resolve();
    }
  });

  test("the main entry can create an account and switch back to sign-in", async ({ page }) => {
    await mockAuth(page);
    await page.goto(appUrl);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await page.getByRole("button", { name: "Back to sign in" }).click();
    await expect(page.getByRole("heading", { name: "Sign in to your Pop-up" })).toBeVisible();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await enterCredentials(page);
    await page.locator("button[type=submit]").click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Verification code" })).toBeVisible();
  });

  test("canceling a new business returns to the switcher, then to the same register", async ({ page }) => {
    await mockAuth(page);
    await page.route("**/api/pos", (route) => route.fulfill({ json: teamSnapshot() }));
    await page.goto(appUrl);
    await enterCredentials(page);
    await page.locator("button[type=submit]").click();
    const trigger = page.getByRole("button", { name: /Switch business, now Market Counter/ });
    await trigger.click();
    const switcher = page.getByRole("dialog", { name: "Your businesses" });
    await switcher.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Add a business/ })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(switcher).toBeVisible();
    await switcher.getByRole("button", { name: "Close", exact: true }).click();
    await expect(trigger).toBeVisible();
  });

  test("practice Sell returns to the same place in the setup guide", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 390 });
    await mockAuth(page);
    await page.route("**/api/pos", (route) => route.fulfill({
      json: { ...teamSnapshot(), onboardingComplete: false },
    }));
    await page.goto(appUrl);
    await enterCredentials(page);
    await page.locator("button[type=submit]").click();
    const practice = page.getByRole("button", { name: "Try Sell", exact: true });
    await practice.scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => window.scrollY);
    expect(scroll).toBeGreaterThan(0);
    await practice.click();
    await page.getByRole("button", { name: "Setup guide", exact: true }).click();
    await expect(practice).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
  });

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
      await expect(main.getByText("POP POS", { exact: true })).toBeVisible();
      const mascot = main.locator("picture img");
      const loadedMascot = () => mascot.evaluate((image: HTMLImageElement) =>
        image.complete && image.naturalWidth > 0 ? new URL(image.currentSrc).pathname : "",
      );
      await expect.poll(loadedMascot).toBe(popoLoading.wave);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect.poll(loadedMascot).toBe(popoLoading.poster);
      await expect(status).toBeVisible();
    } finally {
      bootstrap.resolve();
    }
    await expect(page.getByRole("button", { name: /Switch business, now Market Counter/ })).toBeVisible();
    await expect(page.getByText("Getting your register ready…")).toHaveCount(0);
  });

  const shiftLink = new URL(joinLink(appUrl, teamId, shiftId));
  for (const { label, link } of [
    { label: "business invite", link: new URL("/i/" + inviteCode, appUrl).href },
    { label: "shared shift", link: shiftLink.href },
  ]) {
    test(`opens the ${label} after verifying the email code in the app`, async ({ page }) => {
      await mockAuth(page);
      const commands: Record<string, unknown>[] = [];
      await page.route("**/api/pos", async (route) => {
        commands.push(route.request().postDataJSON());
        await route.fulfill({ json: teamSnapshot() });
      });
      await page.goto(link);
      await page.getByRole("group", { name: "Account" }).getByRole("button", { name: "Create account" }).click();
      await enterCredentials(page);
      await page.locator("button[type=submit]").click();
      await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
      await page.getByRole("textbox", { name: "Verification code" }).fill(verificationCode);
      await expect(page.getByRole("button", { name: "Shifts", exact: true })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("button", { name: /Switch business, now Market Counter/ })).toBeVisible();
      const invitations = commands.filter((cmd) => cmd.action === "acceptInvite");
      if (label === "business invite")
        expect(invitations).toEqual([{ action: "acceptInvite", code: inviteCode }]);
      else {
        expect(invitations).toEqual([]);
        await expect(page.getByRole("dialog", { name: "Saturday market", exact: true })).toBeVisible();
      }
      expect(new URL(page.url()).search).toBe("");
    });
  }

  test("the sixth digit submits a code once and an invalid code can be replaced", async ({ page }) => {
    await mockAuth(page, { unconfirmed: true });
    const attempts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/auth/v1/verify")
        attempts.push(request.postDataJSON().token);
    });
    await page.route("**/api/pos", (route) => route.fulfill({ json: teamSnapshot() }));
    await page.goto(appUrl);
    await enterCredentials(page);
    await page.locator("button[type=submit]").click();

    const code = page.getByRole("textbox", { name: "Verification code" });
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute("autocomplete", "one-time-code");
    await code.pressSequentially("12345");
    await expect(code).toBeEditable();
    expect(attempts).toEqual([]);
    await code.press("6");
    await expect(page.getByRole("region", { name: "Check your email" }).getByRole("alert"))
      .toContainText("incorrect or expired");
    expect(attempts).toEqual(["123456"]);
    await expect(code).toBeEmpty();
    await page.getByRole("button", { name: "Resend code" }).click();
    await expect(page.getByRole("status")).toHaveText("New code sent. Use the most recent email.");
    await expect(code).toBeEmpty();
    await page.getByRole("button", { name: "Use a different email" }).click();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue(email);
    await expect(page.getByLabel("Password", { exact: true })).toBeEmpty();
  });

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

  test("sign-in from saved accounts and sync recovery opens the authenticated register", async ({ page }) => {
    const secondEmail = "bakery@example.test";
    const secondId = "741cdfa2-abd0-4e39-9dfa-c222afe56ba0";
    let rejectFirstRegister = false;
    await page.route("**/auth/v1/**", (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS" || request.url().includes("/logout"))
        return route.fulfill({ status: 204, headers: authHeaders });
      const address = request.postDataJSON().email;
      expect([email, secondEmail]).toContain(address);
      const id = address === email ? accountId : secondId;
      return route.fulfill({ headers: authHeaders, json: {
        access_token: "token-" + id, refresh_token: "refresh-" + id, expires_in: 3600,
        token_type: "bearer", user: { id, email: address, aud: "authenticated", role: "authenticated" },
      } });
    });
    await page.route("**/api/pos", (route) => {
      const actor = route.request().headers().authorization;
      expect(["Bearer token-" + accountId, "Bearer token-" + secondId]).toContain(actor);
      const first = actor === "Bearer token-" + accountId;
      if (first && rejectFirstRegister)
        return route.fulfill({ status: 401, json: { error: "Please sign in again to sync your register." } });
      const snapshot = teamSnapshot();
      return route.fulfill({ json: {
        ...snapshot,
        business: { ...snapshot.business!, id: first ? teamId : secondId, name: first ? "Market Counter" : "Bakery Counter" },
        me: { ...snapshot.me!, name: first ? "Market Owner" : "Bakery Owner" },
      } });
    });
    const firstRegister = page.getByRole("button", { name: "Switch business, now Market Counter" });
    const secondRegister = page.getByRole("button", { name: "Switch business, now Bakery Counter" });
    async function picker() {
      await page.getByRole("button", { name: "Account and settings" }).click();
      await page.getByRole("button", { name: "Switch account", exact: true }).click();
      return page.getByRole("dialog", { name: "Switch account" });
    }
    async function signInThroughDialog(title: string, address: string) {
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await dialog.getByLabel("Email", { exact: true }).fill(address);
      await dialog.getByLabel("Password", { exact: true }).fill("test-password");
      await dialog.locator("button[type=submit]").click();
      await expect(dialog).toBeHidden();
    }

    await page.goto(appUrl);
    await enterCredentials(page);
    await page.locator("button[type=submit]").click();
    await expect(firstRegister).toBeVisible();
    await (await picker()).getByRole("button", { name: "Add account" }).click();
    await signInThroughDialog("Add account", secondEmail);
    await expect(secondRegister).toBeVisible();

    await (await picker()).getByRole("button", { name: /Market Owner/ }).click();
    await expect(firstRegister).toBeVisible();
    rejectFirstRegister = true;
    await page.reload();
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await signInThroughDialog("Sign in", secondEmail);
    await expect(secondRegister).toBeVisible();

    rejectFirstRegister = false;
    await page.evaluate((id) => {
      const accounts = JSON.parse(localStorage.getItem("portable-pos-saved-accounts") ?? "[]");
      const { slot } = accounts.find((account: { id: string }) => account.id === id);
      localStorage.removeItem("portable-pos-auth-" + slot);
    }, accountId);
    await (await picker()).getByRole("button", { name: /Market Owner/ }).click();
    await expect(page.getByRole("dialog", { name: "Sign in" }).getByLabel("Email", { exact: true })).toHaveValue(email);
    await signInThroughDialog("Sign in", secondEmail);
    await expect(secondRegister).toBeVisible();
    await page.reload();
    await expect(secondRegister).toBeVisible();
    await (await picker()).getByRole("button", { name: /Market Owner/ }).click();
    await signInThroughDialog("Sign in", email);
    await expect(firstRegister).toBeVisible();
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

test("creates an account from Settings and switches without mixing saved registers", async ({ page }) => {
  test.skip(!process.env.POS_TEST_MOCK_AUTH, "Use a local app started with test Supabase settings.");
  const otherId = "d4ffdb18-fd04-4e87-b627-97460ceb7436";
  const emails = { [email]: accountId, "secondary@example.test": otherId };
  const authRequests: string[] = [];
  await page.route("**/auth/v1/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: authHeaders });
    const path = new URL(req.url()).pathname.split("/").at(-1);
    const address = req.postDataJSON().email as keyof typeof emails;
    const id = emails[address];
    expect(id).toBeTruthy();
    authRequests.push(path!);
    const user = { id, email: address, aud: "authenticated", role: "authenticated" };
    if (path === "signup") return route.fulfill({ json: user, headers: authHeaders });
    if (path === "verify") expect(req.postDataJSON()).toMatchObject({ type: "email", token: verificationCode });
    else expect(path).toBe("token");
    return route.fulfill({
      headers: authHeaders,
      json: {
        access_token: "token-" + id, refresh_token: "refresh-" + id, expires_in: 3600,
        token_type: "bearer", user,
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
  const accounts = await picker();
  const addAccount = accounts.getByRole("button", { name: "Add account", exact: true });
  await addAccount.click();
  const add = page.getByRole("dialog", { name: "Add account" });
  await add.getByRole("button", { name: "Close", exact: true }).click();
  await expect(accounts).toBeVisible();
  await addAccount.click();
  await add.getByRole("group", { name: "Account" }).getByRole("button", { name: "Create account" }).click();
  await add.getByLabel("Email", { exact: true }).fill("secondary@example.test");
  await add.getByLabel("Password", { exact: true }).fill("fixture-password");
  await add.locator("button[type=submit]").click();
  const confirmation = page.getByRole("dialog", { name: "Check your email" });
  await expect(confirmation.getByText("secondary@example.test")).toBeVisible();
  await confirmation.getByRole("textbox", { name: "Verification code" }).fill("012 345");
  await expect(page.getByRole("button", { name: /Switch business, now Bakery Counter/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /Switch business, now Bakery Counter/ })).toBeVisible();
  await (await picker()).getByRole("button", { name: /Market Owner/ }).click();
  await expect(page.getByRole("button", { name: /Switch business, now Market Counter/ })).toBeVisible();
  await (await picker()).getByRole("button", { name: /Bakery Owner/ }).click();
  await expect(page.getByRole("button", { name: /Switch business, now Bakery Counter/ })).toBeVisible();
  expect(authRequests).toEqual(["token", "signup", "verify"]);
});
