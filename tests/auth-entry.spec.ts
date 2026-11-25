import { expect, test, type Page } from "@playwright/test";
import { popoLoading } from "../src/lib/app-brand";
import { demoBootstrap, newShift } from "../src/lib/demo";
import { makeSale } from "../src/lib/domain";
import { LOGIN_LIFETIME_MS } from "../src/lib/login-session";
import { joinLink } from "../src/lib/join-link";
import type { Bootstrap, RegisterEvent, Shift } from "../src/lib/types";

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

function accessToken(id: string, issuedAt = Date.now(), signedInAt = issuedAt) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ typ: "JWT", alg: "HS256" }),
    encode({ sub: id, iat: Math.floor(issuedAt / 1000), exp: Math.floor(issuedAt / 1000) + 3600,
      amr: [{ method: "password", timestamp: Math.floor(signedInAt / 1000) }] }),
    "test-signature",
  ].join(".");
}

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
    access_token: accessToken(accountId), refresh_token: "test-refresh-token",
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
  const method = page.getByRole("button", { name: "Continue with email" });
  const field = page.getByLabel("Email", { exact: true });
  await field.or(method).first().waitFor();
  if (!(await field.isVisible())) await method.click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("test-password");
}

test("a missed shift can be started and joined from another phone by members, owners, and co-owners", async ({ page, browser }) => {
  test.skip(!process.env.POS_TEST_MOCK_AUTH, "Use a local app started with test Supabase settings and set POS_TEST_MOCK_AUTH=1.");
  const initial = teamSnapshot();
  const business = initial.business!;
  business.timeZone = "Asia/Manila";
  business.settings.checklist = [];
  initial.menu = [{ id: "tea", name: "Tea", category: "Drinks", price: 10000, groups: [] }];
  const [booking] = initial.bookings!;
  booking.startsAt = "2026-11-20T01:00:00Z";
  booking.endsAt = "2026-11-20T03:00:00Z";
  booking.staff = [{ memberId: initial.me!.memberId, name: initial.me!.name, role: "cashier" }];
  booking.event = { id: "saturday-market", name: "Saturday market" };
  const earlier = {
    ...booking, id: "ae97c14a-b48c-4bce-90d2-07a187208168", startsAt: "2026-11-19T23:00:00Z", endsAt: booking.startsAt,
    staff: [], tillClosed: true,
  };
  const earlierTill = {
    ...newShift("earlier-phone", business.id, 5, 10000, initial.menu, { ...business.settings, currency: business.currency }),
    bookingId: earlier.id, openedAt: earlier.startsAt, closedAt: earlier.endsAt,
  };
  const shiftName = "Saturday market • Nov 20 • Shift 2";
  let till: Shift | undefined;
  const deviceIds = new Set<string>();
  const signIn = async (phone: Page, role: "owner" | "co-owner" | "member" = "owner", assigned = true) => {
    const me = { ...initial.me!, owner: role !== "member" };
    const team = me.owner ? initial.team?.map((person) => person.id === me.memberId
      ? { ...person, owner: true, primaryOwner: role === "owner" }
      : person) : [];
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.clock.setFixedTime(new Date("2026-11-21T04:00:00Z"));
    await mockAuth(phone);
    await phone.route("**/api/pos", async (route) => {
      const { action, deviceId, till: selected, bookingId, openingCash } = route.request().postDataJSON();
      if (deviceId) deviceIds.add(deviceId);
      if (action === "open") {
        expect(till).toBeUndefined();
        expect(bookingId).toBe(booking.id);
        expect(openingCash).toBe(10000);
        till = {
          ...newShift(deviceId, business.id, 6, openingCash, initial.menu, { ...business.settings, currency: business.currency }),
          bookingId,
        };
      }
      return route.fulfill({ json: {
        ...initial,
        bookings: [assigned ? booking : { ...booking, staff: [{ memberId: "other", name: "Another cashier", role: "cashier" }] }, earlier],
        me,
        team,
        shifts: till ? [till, earlierTill] : [earlierTill],
        shift: till && (action === "open" || selected === till.id) ? till : null,
      } });
    });
    await phone.goto(appUrl);
    await enterCredentials(phone);
    await phone.locator("button[type=submit]").click();
  };
  const showMissedShift = async (phone: Page) => {
    await phone.getByRole("button", { name: "Shifts", exact: true }).click();
    await phone.getByRole("button", { name: "Friday, November 20, 2 shifts" }).click();
  };

  await signIn(page);
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: /^Past shifts/ }).click();
  const history = page.getByRole("dialog", { name: "Past shifts" });
  await expect(history.getByText("Saturday market • Nov 20 • Shift 1", { exact: true })).toBeVisible();
  await history.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("Missed shifts", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Saturday market/ }).click();
  await page.getByRole("button", { name: "Type the total" }).click();
  await page.getByRole("textbox", { name: "Starting cash" }).fill("100");
  await page.getByRole("button", { name: "Open till", exact: true }).click();
  await expect(page.getByRole("button", { name: /Selling for Saturday market/ })).toBeVisible();

  for (const role of ["owner", "co-owner", "member"] as const) {
    await test.step(`${role} joins the shared till`, async () => {
      const second = await browser.newPage();
      try {
        await signIn(second, role);
        await expect(second.getByRole("heading", { name: "A shift is already open" })).toBeVisible();
        await second.getByRole("button", { name: "Go to Till" }).click();
        await expect(second.getByText("Open on another phone")).toBeVisible();
        const openTill = second.getByRole("button", { name: /^Saturday market • Nov 20 • Shift 2/ });
        await expect(openTill).toBeVisible();
        if (role === "owner") {
          await openTill.click();
        } else {
          await showMissedShift(second);
          await second.getByRole("button", { name: /Saturday market.*Started/ }).click();
          const details = second.getByRole("dialog", { name: shiftName, exact: true });
          await expect(details.getByText("Started on another device")).toBeVisible();
          await expect(details.getByRole("button", { name: "Start shift" })).toHaveCount(0);
          await details.getByRole("button", { name: "Join till", exact: true }).click();
        }
        const join = second.getByRole("dialog", { name: "Join till?" });
        await expect(join.getByText(shiftName, { exact: true })).toBeVisible();
        await join.getByRole("button", { name: "Join till", exact: true }).click();
        await expect(second.getByRole("button", { name: /Selling for Saturday market/ })).toBeVisible();
      } finally {
        await second.close();
      }
    });
  }
  const unassigned = await browser.newPage();
  try {
    await signIn(unassigned, "member", false);
    await expect(unassigned.getByRole("heading", { name: "Till closed" })).toBeVisible();
    await unassigned.getByRole("button", { name: "Till", exact: true }).click();
    await expect(unassigned.getByText("Open on another phone")).toHaveCount(0);
    await showMissedShift(unassigned);
    await unassigned.getByRole("button", { name: /Saturday market.*Started/ }).click();
    const details = unassigned.getByRole("dialog", { name: shiftName, exact: true });
    await expect(details.getByText("Started on another device")).toBeVisible();
    await expect(details.getByRole("button", { name: "Join till", exact: true })).toHaveCount(0);
  } finally {
    await unassigned.close();
  }
  expect(deviceIds.size).toBe(5);
});

test("a phone opening after another phone uses the saved cash and shows the handoff", async ({ page }) => {
  test.skip(!process.env.POS_TEST_MOCK_AUTH, "Use a local app with test Supabase settings and POS_TEST_MOCK_AUTH=1.");
  const initial = teamSnapshot();
  const business = initial.business!;
  business.timeZone = "Asia/Manila";
  business.settings.checklist = [];
  initial.menu = [{ id: "tea", name: "Tea", category: "Drinks", price: 10000, groups: [] }];
  const [booking] = initial.bookings!;
  booking.startsAt = "2026-11-20T01:00:00Z";
  booking.endsAt = "2026-11-20T03:00:00Z";
  booking.staff = [{ memberId: initial.me!.memberId, name: initial.me!.name, role: "cashier" }];
  const existing = {
    ...newShift("other-phone", business.id, 1, 1000, initial.menu, { ...business.settings, currency: business.currency }),
    bookingId: booking.id,
  };
  await page.clock.setFixedTime(new Date("2026-11-21T04:00:00Z"));
  await mockAuth(page);
  await page.route("**/api/pos", async (route) => {
    const command = route.request().postDataJSON();
    if (command.action !== "open") return route.fulfill({ json: initial });
    expect(command.openingCash).toBe(2500);
    return route.fulfill({ json: { ...initial, shift: existing, shifts: [existing], joinedExistingTill: true } });
  });
  await page.goto(appUrl);
  await enterCredentials(page);
  await page.locator("button[type=submit]").click();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: /Saturday market/ }).click();
  await page.getByRole("button", { name: "Type the total" }).click();
  await page.getByRole("textbox", { name: "Starting cash" }).fill("25");
  await page.getByRole("button", { name: "Open till", exact: true }).click();
  await expect(page.getByText("This shift was already open. You joined its till using the saved opening counts.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Selling for Saturday market/ })).toBeVisible();
});

test("a till opened on another phone blocks a stale shift deletion with a toast", async ({ page }) => {
  test.skip(!process.env.POS_TEST_MOCK_AUTH, "Use a local app with test Supabase settings and POS_TEST_MOCK_AUTH=1.");
  await page.clock.setFixedTime(new Date("2026-11-21T04:00:00Z"));
  const initial = teamSnapshot();
  initial.business!.timeZone = "Asia/Manila";
  initial.bookings![0].startsAt = "2026-11-21T03:00:00Z";
  initial.bookings![0].endsAt = "2026-11-21T08:00:00Z";
  await mockAuth(page);
  await page.route("**/api/pos", async (route) => {
    const command = route.request().postDataJSON();
    if (command.action === "deleteBooking") {
      expect(command).toMatchObject({ bookingId: shiftId, pin: "1234" });
      return route.fulfill({ status: 409, json: { error: "Close the till before deleting this shift." } });
    }
    return route.fulfill({ json: initial });
  });
  await page.goto(appUrl);
  await enterCredentials(page);
  await page.locator("button[type=submit]").click();
  const shifts = page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Shifts", exact: true });
  await shifts.press("Enter");
  await expect(shifts).toHaveAttribute("aria-current", "page");
  await page.getByRole("article").filter({ hasText: "Saturday market" }).getByRole("button").click();
  await page.getByRole("dialog", { name: /^Saturday market/ }).getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete shift?" });
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  const pin = page.getByRole("dialog", { name: "Owner PIN" });
  for (const digit of "1234") await pin.getByRole("button", { name: digit, exact: true }).click();
  await pin.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".toast:not(.exit-ghost)")).toContainText("Close the till before deleting this shift.");
  await expect(confirm).toBeVisible();
});

test("an owner can close a stranded till linked to a shift without joining it", async ({ page }) => {
  test.skip(!process.env.POS_TEST_MOCK_AUTH, "Use a local app with test Supabase settings and POS_TEST_MOCK_AUTH=1.");
  const initial = teamSnapshot();
  const till = { ...newShift("other-phone", initial.business!.id, 8, 1000, initial.menu, {
    currency: "PHP", payments: initial.business!.settings.payments, discounts: [], receiptNote: "",
  }), bookingId: initial.bookings![0].id };
  await mockAuth(page);
  await page.route("**/api/pos", async (route) => {
    const command = route.request().postDataJSON();
    if (command.action === "close") {
      expect(command).toMatchObject({ till: null, shiftId: till.id, countedCash: 1000, pin: "1234" });
      return route.fulfill({ json: { ...initial, shifts: [{ ...till, closedAt: new Date().toISOString(), countedCash: 1000 }], recoveryTillIds: [] } });
    }
    return route.fulfill({ json: { ...initial, shifts: [till], recoveryTillIds: [till.id] } });
  });
  await page.goto(appUrl);
  await enterCredentials(page);
  await page.locator("button[type=submit]").click();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: /^Saturday market • / }).click();
  const close = page.getByRole("dialog", { name: "Close shift", exact: true });
  await close.getByRole("button", { name: "Type the total" }).click();
  await close.getByRole("textbox", { name: "Cash on hand" }).fill("10");
  await close.getByRole("button", { name: "Close shift and see report" }).click();
  const pin = page.getByRole("dialog", { name: "Owner PIN" });
  for (const digit of "1234") await pin.getByRole("button", { name: digit, exact: true }).click();
  await pin.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("dialog", { name: /^Saturday market • .+ closed$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Saturday market • / })).toHaveCount(0);
});

test("a fresh visit and a stale register selection both show sign-in", async ({ page }) => {
  await page.addInitScript((id) => localStorage.setItem("portable-pos-account", id), accountId);
  await page.goto(appUrl);
  await expect(page.getByRole("heading", { name: "POP POS sign in" })).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
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

test("offline stock, expenses and a PIN-protected reversal survive reload and a lost sync response", async ({ page, context }) => {
  test.skip(!process.env.POS_TEST_DATABASE_URL || !process.env.POS_TEST_MOCK_AUTH, "Requires a migrated disposable database and mock sign-in.");
  test.setTimeout(90000);
  process.env.DATABASE_URL = process.env.POS_TEST_DATABASE_URL;
  const { runCommand } = await import("../src/server/register");
  const { stockLeft, shiftTotals } = await import("../src/lib/domain");
  const { shiftNow } = await import("./schedule");
  const owner = crypto.randomUUID();
  const pin = "2916";
  const call = (command: object) => runCommand(owner, command);
  await call({ action: "setup", pin, name: "Offline Counter", currency: "PHP", timeZone: "Asia/Manila" });
  await call({ action: "completeOnboarding" });
  await call({ action: "menu", menu: [{ id: "tea", name: "Tea", price: 500, category: "Drinks", groups: [], stock: true }], pin });
  const bookingId = await shiftNow(call, pin);
  await mockAuth(page);
  let till = "", deviceId = "", lost = false, offline = false;
  const syncs: RegisterEvent[][] = [];
  await page.route("**/api/pos", async (route) => {
    if (offline) throw Error("Register made an API request while offline.");
    const command = route.request().postDataJSON();
    if (!till && command.action === "bootstrap") {
      deviceId = command.deviceId;
      const result = await call({ action: "open", deviceId, bookingId, openingCash: 10000, stock: { tea: 2 } });
      till = result.shift!.id;
      return route.fulfill({ json: result });
    }
    const result = await call(command);
    if (command.action === "sync") {
      syncs.push(command.events);
      if (!lost) {
        lost = true;
        return route.abort("connectionreset");
      }
    }
    return route.fulfill({ json: result });
  });
  await page.goto(appUrl);
  await enterCredentials(page);
  await page.locator("button[type=submit]").click();
  const tea = page.getByRole("button", { name: /^Add Tea,/ });
  await expect(tea).toBeVisible();
  await expect.poll(() => page.evaluate(async () => Boolean(navigator.serviceWorker.controller &&
    await caches.match("/", { cacheName: "portable-pos-shell-v1" }))), { timeout: 30000 }).toBe(true);
  offline = true;
  await context.setOffline(true);
  await tea.click();
  await page.locator(".charge-bar").click();
  const charge = page.getByRole("dialog", { name: "Charge", exact: true });
  await charge.getByRole("button", { name: "Cash", exact: true }).click();
  await charge.getByRole("button", { name: "Exact", exact: true }).click();
  await page.getByRole("button", { name: "Slide to confirm sale" }).press("Enter");
  await page.getByRole("button", { name: "View receipt" }).click();
  await page.getByRole("button", { name: "Reverse sale", exact: true }).click();
  const reversal = page.getByRole("dialog", { name: /^Reverse #/ });
  await reversal.getByRole("textbox", { name: "Reason" }).fill("Duplicate sale");
  await reversal.getByRole("button", { name: /^Reverse ₱/ }).click();
  const pinDialog = page.getByRole("dialog", { name: "Owner PIN" });
  for (const digit of pin) await pinDialog.getByRole("button", { name: digit, exact: true }).click();
  await pinDialog.getByRole("button", { name: "Confirm" }).click();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  const stock = page.getByRole("region", { name: "Stock left" });
  await stock.getByRole("button", { name: "Add", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Adjust stock" });
  await editor.getByLabel("Stock item").selectOption("tea");
  await editor.getByLabel("Quantity to add").fill("3");
  await editor.getByRole("button", { name: "Save changes" }).click();
  await expect(stock.getByRole("button", { name: /Tea/ })).toContainText("5 pieces left");
  await page.getByRole("region", { name: "Expenses" }).getByRole("button", { name: "Add" }).click();
  const expense = page.getByRole("dialog", { name: "Log an expense" });
  await expense.getByRole("combobox", { name: "What for" }).fill("Ice");
  await expense.getByRole("textbox", { name: "Amount" }).fill("20");
  await expense.getByRole("button", { name: /^Log ₱/ }).click();
  await expect(expense).toBeHidden();
  await page.reload();
  const waiting = page.getByRole("region", { name: "Register sync" });
  await expect(waiting.getByRole("listitem")).toHaveText(["1 sale", "1 sale reversal", "1 stock adjustment", "1 expense"]);
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  await expect(page.getByText("Reversal pending", { exact: false })).toBeVisible();
  offline = false;
  await context.setOffline(false);
  await waiting.getByRole("button", { name: "Retry sync" }).click();
  await expect(waiting).toHaveCount(0);
  expect(syncs).toHaveLength(2);
  expect(syncs[0]).toEqual(syncs[1]);
  const saved = await call({ action: "bootstrap", deviceId, till });
  expect(saved.sales).toHaveLength(1);
  expect(saved.sales[0].reason).toBe("Duplicate sale");
  expect(saved.expenses).toHaveLength(1);
  expect(stockLeft(saved.shift!, saved.sales).tea).toBe(5);
  expect(shiftTotals(saved.shift!, saved.sales, saved.expenses).expectedCash).toBe(8000);
});

test("businesses download ahead of time and keep their own orders when switching offline", async ({ page, context }) => {
  test.skip(!process.env.POS_TEST_MOCK_AUTH, "Requires mock Auth and register responses.");
  await mockAuth(page);
  const market = { id: teamId, name: "Market Counter", owner: true };
  const bakery = { id: "bc361fc6-c133-45d8-a62d-d93d275313c5", name: "Bakery Counter", owner: false };
  const kiosk = { id: "b7b1fc77-e29e-47d1-95ff-edde536b209b", name: "Kiosk", owner: true };
  const snapshots = [market, bakery].map((summary, index) => {
    const snapshot = teamSnapshot();
    const business = { ...snapshot.business!, ...summary };
    const menu = [{ id: summary.id, name: index ? "Bread" : "Tea", category: "Menu", groups: [], price: 500 }];
    const shift = newShift("offline-test", summary.id, 1, 0, menu, { ...business.settings, currency: business.currency });
    return { ...snapshot, business, businesses: [market, bakery, kiosk], menu, shift, shifts: [shift] };
  });
  let offline = false;
  let triedKiosk = false;
  const offlineRequests: string[] = [];
  const synced: string[] = [];
  await page.route("**/api/pos", async (route) => {
    const id = route.request().headers()["x-business-id"] ?? teamId;
    if (offline) {
      offlineRequests.push(id);
      return route.abort("internetdisconnected");
    }
    const snapshot = snapshots.find((s) => s.business.id === id);
    if (!snapshot) {
      triedKiosk = id === kiosk.id;
      return route.fulfill({ status: 503, json: { error: "Unavailable" } });
    }
    const command = route.request().postDataJSON();
    if (command.action === "sync") {
      expect(command.events.map((event: RegisterEvent) => event.shiftId)).toEqual([snapshot.shift.id]);
      synced.push(id);
    }
    return route.fulfill({ json: snapshot });
  });
  await page.goto(appUrl);
  await enterCredentials(page);
  await page.locator("button[type=submit]").click();
  const switcher = page.getByRole("dialog", { name: "Your businesses" });
  const marketButton = page.getByRole("button", { name: "Switch business, now Market Counter" });
  const bakeryButton = page.getByRole("button", { name: "Switch business, now Bakery Counter" });
  await expect(marketButton).toBeVisible();
  // The failed third download follows the completed second one.
  await expect.poll(() => triedKiosk).toBe(true);
  await expect.poll(() => page.evaluate(async () => Boolean(navigator.serviceWorker.controller && await caches.match("/", { cacheName: "portable-pos-shell-v1" }))), { timeout: 30000 }).toBe(true);
  offline = true;
  await context.setOffline(true);
  const tea = page.getByRole("button", { name: /^Add Tea,/ });
  await tea.click();
  await expect(tea).toHaveAccessibleName(/1 in order/);
  await marketButton.click();
  await switcher.getByRole("button", { name: /Kiosk/ }).click();
  await expect(page.getByRole("button", { name: /Dismiss notification: Connect once to download/ })).toBeVisible();
  await expect(switcher).toBeVisible();
  await switcher.getByRole("button", { name: /Bakery Counter/ }).click();
  await expect(bakeryButton).toBeVisible();
  await page.reload();
  await expect(bakeryButton).toBeVisible();
  await expect(tea).toHaveCount(0);
  await page.getByRole("button", { name: /^Add Bread,/ }).click();
  await page.locator(".charge-bar").click();
  const charge = page.getByRole("dialog", { name: "Charge", exact: true });
  await charge.getByRole("button", { name: "Cash", exact: true }).click();
  await charge.getByRole("button", { name: "Exact", exact: true }).click();
  await page.getByRole("button", { name: "Slide to confirm sale", exact: true }).press("Enter");
  await page.getByRole("dialog", { name: "Sale complete" }).getByRole("button", { name: "New sale" }).click();
  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("main").getByRole("button", { name: /^Switch business/ }).click();
  await switcher.getByRole("button", { name: /Market Counter/ }).click();
  await expect(tea).toHaveAccessibleName(/1 in order/);
  await expect(page.getByRole("region", { name: "Register sync" })).toHaveCount(0);
  await marketButton.click();
  await switcher.getByRole("button", { name: /Bakery Counter/ }).click();
  await expect(page.getByRole("region", { name: "Register sync" })).toContainText("1 sale");
  expect(offlineRequests).toEqual([]);
  offline = false;
  await context.setOffline(false);
  await expect.poll(() => synced).toEqual([bakery.id]);
});

test.describe("account-enabled link entry", () => {
  test.skip(
    !process.env.POS_TEST_MOCK_AUTH,
    "Use a local app started with test Supabase settings and set POS_TEST_MOCK_AUTH=1.",
  );
  test.use({ serviceWorkers: "block" });

  for (const access of ["member", "co-owner"] as const) {
    test(`${access} can see this phone's connection status in Settings`, async ({ page, context }) => {
      const snapshot = teamSnapshot();
      const [primary, teammate] = snapshot.team!;
      const owner = access === "co-owner";
      snapshot.team = [{ ...primary, primaryOwner: true }, { ...teammate, owner }];
      snapshot.me = { memberId: teammate.id, name: teammate.name, roles: teammate.roles, owner };
      await mockAuth(page);
      await page.route("**/api/pos", (route) => route.fulfill({ json: snapshot }));

      await page.goto(appUrl);
      await enterCredentials(page);
      await page.locator("button[type=submit]").click();
      await page.getByRole("button", { name: "Account and settings" }).click();
      const phone = page.getByRole("region", { name: "This phone" });
      await expect(phone.getByRole("heading", { name: "This phone" })).toBeVisible();
      await expect(phone.getByText("Connection", { exact: true })).toBeVisible();
      await expect(phone.getByText("Online", { exact: true })).toBeVisible();
      await expect(phone.getByText("Works offline", { exact: true })).toBeVisible();
      await expect(phone.getByText("Getting ready", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Payment methods/ })).toHaveCount(owner ? 1 : 0);

      await context.setOffline(true);
      await expect(phone.getByText("Offline", { exact: true })).toBeVisible();
      await context.setOffline(false);
      await expect(phone.getByText("Online", { exact: true })).toBeVisible();
    });
  }

  test("a co-owner can view the primary owner's name only as read-only", async ({ page }) => {
    const snapshot = teamSnapshot();
    const [primary, coOwner, member] = snapshot.team!;
    snapshot.team = [{ ...primary, primaryOwner: true }, { ...coOwner, owner: true, rate: 0 }, member];
    snapshot.me = { memberId: coOwner.id, name: coOwner.name, roles: coOwner.roles, owner: true };
    await mockAuth(page);
    await page.route("**/api/pos", (route) => route.fulfill({ json: snapshot }));
    await page.goto(appUrl);
    await enterCredentials(page);
    await page.locator("button[type=submit]").click();
    await page.getByRole("button", { name: "Account and settings" }).click();
    await page.getByRole("button", { name: /^Team\b/ }).click();
    await page.getByRole("button", { name: `${primary.name} Owner`, exact: true }).click();
    const ownerEditor = page.getByRole("dialog", { name: primary.name, exact: true });
    const ownerName = ownerEditor.getByRole("textbox", { name: "Name", exact: true });
    await expect(ownerName).toHaveValue(primary.name);
    await expect(ownerName).not.toBeEditable();
    await ownerEditor.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: `${coOwner.name} Co-owner`, exact: true }).click();
    const myEditor = page.getByRole("dialog", { name: coOwner.name, exact: true });
    await expect(myEditor.getByRole("textbox", { name: "Name", exact: true })).toBeEditable();
  });

  test("a saved login refreshes on return and expires 365 days after sign-in", async ({ page }) => {
    const started = Date.parse("2026-11-23T01:00:00Z");
    let now = started;
    let signedInAt = started;
    let passwords = 0;
    let refreshes = 0;
    let authUnavailable = false;
    const user = { id: accountId, email, aud: "authenticated", role: "authenticated" };
    await page.clock.install({ time: new Date(now) });
    await page.route("**/auth/v1/**", async (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS" || request.url().includes("/logout"))
        return route.fulfill({ status: 204, headers: authHeaders });
      const grant = new URL(request.url()).searchParams.get("grant_type");
      if (grant === "password") {
        passwords++;
        signedInAt = now;
      } else {
        expect(grant).toBe("refresh_token");
        refreshes++;
        if (authUnavailable)
          return route.fulfill({ status: 503, json: { message: "Auth is temporarily unavailable" }, headers: authHeaders });
      }
      return route.fulfill({ headers: authHeaders, json: {
        access_token: accessToken(accountId, now, signedInAt),
        refresh_token: "refresh-" + refreshes,
        expires_in: 3600,
        expires_at: now / 1000 + 3600,
        token_type: "bearer",
        user,
      } });
    });
    await page.route("**/api/pos", (route) => route.fulfill({ json: teamSnapshot() }));
    const register = page.getByRole("button", { name: "Switch business, now Market Counter" });
    const signIn = page.getByRole("heading", { name: "POP POS sign in" });
    await page.goto(appUrl);
    await enterCredentials(page);
    await page.locator("button[type=submit]").click();
    await expect(register).toBeVisible();

    now += 24 * 60 * 60 * 1000;
    authUnavailable = true;
    await page.clock.setSystemTime(new Date(now));
    await page.reload();
    await expect(register).toBeVisible({ timeout: 35_000 });
    await expect(signIn).toBeHidden();
    const failedRefreshes = refreshes;
    authUnavailable = false;

    now = started + LOGIN_LIFETIME_MS - 60_000;
    await page.clock.setSystemTime(new Date(now));
    await page.reload();
    await expect(register).toBeVisible({ timeout: 15_000 });
    expect(refreshes).toBeGreaterThan(failedRefreshes);
    expect(passwords).toBe(1);

    now = started + LOGIN_LIFETIME_MS;
    await page.clock.setSystemTime(new Date(now));
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(signIn).toBeVisible();
    await expect(page.getByText("Your sign-in expired. Sign in again to continue.")).toBeVisible();
    await page.reload();
    await expect(signIn).toBeVisible();
    expect(passwords).toBe(1);

    await enterCredentials(page);
    await page.locator("button[type=submit]").click();
    await expect(register).toBeVisible();
    expect(passwords).toBe(2);
  });

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
      const payments = shift.getByRole("region", { name: "By payment" });
      await expect(payments.getByRole("group", { name: "Payment methods" })).toHaveAttribute("aria-busy", "true");

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
      await expenses.getByRole("button", { name: "Close", exact: true }).click();
      await payments.getByRole("button", { name: /Cash.*1 sale.*₱90 total/ }).click();
      const cash = page.getByRole("dialog", { name: "Cash", exact: true });
      await expect(cash.getByText("Espresso", { exact: true })).toBeVisible();
      await expect(cash.getByRole("button", { name: "See in Sales" })).toHaveCount(0);
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
    await expect(page.getByRole("heading", { name: "POP POS sign in" })).toBeVisible();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await enterCredentials(page);
    await page.locator("button[type=submit]").click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Verification code" })).toBeVisible();
  });

  test("account link fields match the main sign-in fields on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockAuth(page);
    const business = { name: "Bettercup", brand: "#6927d8" };
    await page.route(`**/api/links/invite/${inviteCode}`, (route) => route.fulfill({
      json: { business, invite: { name: "Test", owner: false, invitedBy: "Mc Joseph" } },
    }));
    await page.route("**/api/links/shift/*", (route) => route.fulfill({
      json: { business, shift: {
        startsAt: "2026-11-20T01:00:00Z", endsAt: "2026-11-20T05:00:00Z",
        timeZone: "Asia/Manila", seats: 3, taken: 1,
      } },
    }));

    await page.goto(appUrl);
    await page.getByRole("button", { name: "Continue with email" }).click();
    const emailField = page.getByLabel("Email", { exact: true });
    await expect(emailField).toBeVisible();
    await expect(emailField).not.toHaveCSS("box-shadow", "none");
    const rest = await emailField.evaluate((input) => {
      const css = getComputedStyle(input);
      return Object.fromEntries(["background-color", "box-shadow", "border-radius", "min-height"]
        .map((property) => [property, css.getPropertyValue(property)]));
    });
    await emailField.focus();
    const focus = await emailField.evaluate((input) => getComputedStyle(input).boxShadow);
    const accountMode = page.getByRole("group", { name: "Account" });

    for (const [link, title, changeMode] of [
      [new URL(`/i/${inviteCode}`, appUrl).href, "Create your account to join", "Sign in"],
      [joinLink(appUrl, teamId), "Open your team’s shifts", "Create account"],
      [joinLink(appUrl, teamId, shiftId), "Sign in to take a seat", "Create account"],
    ]) {
      await page.goto(link);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      for (const field of [emailField, page.getByLabel("Password", { exact: true })]) {
        for (const [property, value] of Object.entries(rest)) await expect(field).toHaveCSS(property, value);
        await field.focus();
        await expect(field).toHaveCSS("box-shadow", focus);
        await field.blur();
      }

      await accountMode.getByRole("button", { name: changeMode, exact: true }).click();
      await expect(emailField).toHaveCSS("box-shadow", rest["box-shadow"]);
      if (changeMode === "Sign in") {
        await expect(page.getByRole("heading", { name: "Sign in to join" })).toBeVisible();
        await accountMode.getByRole("button", { name: "Create account", exact: true }).click();
      }
      await enterCredentials(page);
      await page.locator("button[type=submit]").click();
      const code = page.getByRole("textbox", { name: "Verification code" });
      await expect(code).toBeFocused();
      const cells = page.locator('[data-active][data-filled]');
      await expect(cells).toHaveCount(6);
      await expect(cells.nth(0)).toHaveCSS("outline-style", "solid");
      expect(await cells.nth(3).evaluate((cell) => cell.previousElementSibling?.hasAttribute("data-filled"))).toBe(false);
      await code.blur();
      await expect(cells.nth(0)).toHaveCSS("outline-style", "none");
    }
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
    await practice.evaluate((button) => button.scrollIntoView({ block: "center", behavior: "instant" }));
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
        await expect(page.getByRole("dialog", { name: /^Saturday market • / })).toBeVisible();
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
    await expect(page.locator('[data-filled="true"][data-active]')).toHaveCount(5);
    await expect(code).toBeEditable();
    expect(attempts).toEqual([]);
    await code.press("6");
    await expect(page.getByRole("dialog", { name: "Check your email" }).getByRole("alert"))
      .toContainText("incorrect or expired");
    expect(attempts).toEqual(["123456"]);
    await expect(code).toBeEmpty();
    await expect(code).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator('[data-filled="true"][data-active]')).toHaveCount(0);
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
    await expect(page.getByRole("dialog", { name: /^Saturday market • / })).toBeVisible();
    await expect(page.getByRole("button", { name: /Switch business, now Market Counter/ })).toBeVisible();
  });

  test("sign-in from saved accounts and sync recovery opens the authenticated register", async ({ page }) => {
    const secondEmail = "bakery@example.test";
    const secondId = "741cdfa2-abd0-4e39-9dfa-c222afe56ba0";
    let rejectFirstRegister = false;
    const tokens = { [accountId]: accessToken(accountId), [secondId]: accessToken(secondId) };
    await page.route("**/auth/v1/**", (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS" || request.url().includes("/logout"))
        return route.fulfill({ status: 204, headers: authHeaders });
      const address = request.postDataJSON().email;
      expect([email, secondEmail]).toContain(address);
      const id = address === email ? accountId : secondId;
      return route.fulfill({ headers: authHeaders, json: {
        access_token: tokens[id], refresh_token: "refresh-" + id, expires_in: 3600,
        token_type: "bearer", user: { id, email: address, aud: "authenticated", role: "authenticated" },
      } });
    });
    await page.route("**/api/pos", (route) => {
      const actor = route.request().headers().authorization;
      expect(Object.values(tokens).map((token) => "Bearer " + token)).toContain(actor);
      const first = actor === "Bearer " + tokens[accountId];
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

  test("the register explains offline work and clears the sync banner after upload", async ({ page, context }, testInfo) => {
    await page.setViewportSize({ width: 430, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockAuth(page);
    const demo = demoBootstrap("offline-test");
    const snapshot = {
      ...demo,
      business: { ...demo.business!, settings: { ...demo.business!.settings, mode: "advanced", brand: "#4b2ccb" } },
      me: { ...demo.me!, name: "Ana Cruz" },
    };
    let rejectBootstrap = false;
    let sent: RegisterEvent[] = [];
    const { promise: syncResponse, resolve: finishSync } = Promise.withResolvers<void>();
    const screenshot = (name: string) => page.screenshot({
      path: testInfo.outputPath(name), animations: "disabled", style: "nextjs-portal { display: none; }",
    });
    await page.route("**/api/pos", async (route) => {
      const command = route.request().postDataJSON();
      if (command.action === "sync") {
        sent = command.events;
        await syncResponse;
      } else if (rejectBootstrap) {
        return route.fulfill({ status: 401, json: { error: "Please sign in again to sync your register." } });
      }
      return route.fulfill({ json: snapshot });
    });

    try {
      await page.goto(appUrl);
      await enterCredentials(page);
      await page.locator("button[type=submit]").click();
      await expect(page.getByRole("button", { name: /^Add Espresso/ })).toBeVisible();
      await page.getByRole("button", { name: "Account and settings" }).click();
      rejectBootstrap = true;
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

      await context.setOffline(true);
      const offlineBanner = page.getByRole("region", { name: "Offline", exact: true });
      const syncBanner = page.getByRole("region", { name: "Register sync", exact: true });
      await expect(offlineBanner).toContainText("You’re offline");
      await expect(offlineBanner).toContainText("Are you online?");
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
      await expect(syncBanner).toHaveCount(0);
      await screenshot("offline-banner.png");
      await offlineBanner.getByRole("button", { name: "Refresh" }).click();
      await expect(offlineBanner).toContainText("Still offline");
      await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Sell", exact: true }).click();
      for (let count = 0; count < 2; count++) {
        await page.getByRole("button", { name: /^Add Espresso/ }).click();
        await page.locator(".charge-bar").click();
        const checkout = page.getByRole("dialog", { name: "Charge", exact: true });
        await checkout.getByRole("button", { name: "Cash", exact: true }).click();
        await checkout.getByRole("button", { name: "Exact", exact: true }).click();
        await page.getByRole("button", { name: "Slide to confirm sale", exact: true }).press("Enter");
        await page.getByRole("dialog", { name: "Sale complete" }).getByRole("button", { name: "New sale" }).click();
      }
      await page.getByRole("button", { name: "Till", exact: true }).click();
      await page.getByRole("region", { name: "Expenses" }).getByRole("button", { name: "Add", exact: true }).click();
      const expense = page.getByRole("dialog", { name: "Log an expense" });
      await expense.getByRole("combobox", { name: "What for" }).fill("Ice");
      await expense.getByRole("textbox", { name: "Amount" }).fill("20");
      await expense.getByRole("button", { name: "From till", exact: true }).click();
      await expect(expense.getByRole("combobox", { name: "Payment method" })).toHaveValue("Cash");
      await expense.getByRole("button", { name: /^Log ₱/ }).click();
      await page.getByRole("button", { name: "Sell", exact: true }).click();
      await expect(page.locator(".sell-head .lucide-cloud-off")).toBeVisible();
      await expect(syncBanner).toContainText("Waiting to sync");
      await expect(syncBanner.getByRole("listitem")).toHaveText(["2 sales", "1 expense"]);
      await expect(syncBanner.locator(".register-banner-icon")).toHaveCSS("background-color", "rgb(75, 44, 203)");
      expect(sent).toHaveLength(0);
      await page.getByRole("banner").scrollIntoViewIfNeeded();
      await expect(offlineBanner).toBeInViewport({ ratio: 1 });
      await expect(syncBanner).toBeInViewport({ ratio: 1 });
      await screenshot("sell-offline.png");
      await page.getByRole("button", { name: "Account and settings" }).click();

      rejectBootstrap = false;
      await context.setOffline(false);
      await expect(offlineBanner).toHaveCount(0);
      await expect(syncBanner).toContainText("Syncing changes");
      await expect.poll(() => sent.map((event) => event.type)).toEqual(["sale", "sale", "expense"]);
      await screenshot("sync-banner.png");
      finishSync();
      await expect(syncBanner).toHaveCount(0);
    } finally {
      finishSync();
    }
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
  const emails = { [email]: accountId, "secondary@example.test": otherId } as const;
  const tokens = { [accountId]: accessToken(accountId), [otherId]: accessToken(otherId) };
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
        access_token: tokens[id], refresh_token: "refresh-" + id, expires_in: 3600,
        token_type: "bearer", user,
      },
    });
  });
  await page.route("**/api/pos", (route) => {
    const actor = route.request().headers().authorization;
    expect(Object.values(tokens).map((token) => "Bearer " + token)).toContain(actor);
    const first = actor === "Bearer " + tokens[accountId];
    const snapshot = teamSnapshot();
    return route.fulfill({ json: {
      ...snapshot,
      business: { ...snapshot.business!, id: first ? teamId : otherId, name: first ? "Market Counter" : "Bakery Counter" },
      me: { ...snapshot.me!, name: first ? "Market Owner" : "Bakery Owner" },
    } });
  });
  await page.goto(appUrl);
  await page.getByRole("button", { name: "Continue with email" }).click();
  const fieldOutline = await page.getByLabel("Email", { exact: true })
    .evaluate((input) => getComputedStyle(input).boxShadow);
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
  await expect(add.getByLabel("Email", { exact: true })).toHaveCSS("box-shadow", fieldOutline);
  await expect(add.getByLabel("Password", { exact: true })).toHaveCSS("box-shadow", fieldOutline);
  await add.getByRole("group", { name: "Account" }).getByRole("button", { name: "Create account" }).click();
  await add.getByLabel("Email", { exact: true }).fill("secondary@example.test");
  await add.getByLabel("Password", { exact: true }).fill("fixture-password");
  await add.locator("button[type=submit]").click();
  const confirmation = page.getByRole("dialog", { name: "Check your email" });
  await expect(confirmation.getByText("secondary@example.test")).toBeVisible();
  const code = confirmation.getByRole("textbox", { name: "Verification code" });
  await code.blur();
  await expect(confirmation.locator('[data-active][data-filled]')).toHaveCount(6);
  await code.fill("012 345");
  await expect(page.getByRole("button", { name: /Switch business, now Bakery Counter/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /Switch business, now Bakery Counter/ })).toBeVisible();
  await (await picker()).getByRole("button", { name: /Market Owner/ }).click();
  await expect(page.getByRole("button", { name: /Switch business, now Market Counter/ })).toBeVisible();
  await (await picker()).getByRole("button", { name: /Bakery Owner/ }).click();
  await expect(page.getByRole("button", { name: /Switch business, now Bakery Counter/ })).toBeVisible();
  expect(authRequests).toEqual(["token", "signup", "verify"]);
});

test("offline till opening, menu, float, settings and closing survive reload and sync once", async ({ page, context }) => {
  test.skip(!process.env.POS_TEST_DATABASE_URL || !process.env.POS_TEST_MOCK_AUTH, "Requires an isolated database and mock sign-in.");
  test.setTimeout(90000);
  process.env.DATABASE_URL = process.env.POS_TEST_DATABASE_URL;
  const { runCommand } = await import("../src/server/register");
  const { shiftNow } = await import("./schedule");
  const owner = crypto.randomUUID(), pin = "6318";
  const call = (command: object) => runCommand(owner, command);
  await call({ action: "setup", pin, name: "Offline menu", currency: "PHP", timeZone: "Asia/Manila" });
  await call({ action: "completeOnboarding" });
  await call({ action: "menu", pin, menu: [{ id: "tea", name: "Tea", price: 100, category: "", groups: [] }] });
  const bookingId = await shiftNow(call, pin);
  await mockAuth(page);
  let deviceId = "", offline = false, dropped = false;
  const sent: string[] = [];
  await page.route("**/api/pos", async (route) => {
    if (offline) throw Error("Register made an API request while offline.");
    const body = route.request().postDataJSON();
    if (body.action === "bootstrap") deviceId = body.deviceId;
    const result = await call(body);
    if (body.action === "offlineCommand") {
      sent.push(body.request.id);
      if (!dropped) { dropped = true; return route.abort("connectionreset"); }
    }
    return route.fulfill({ json: result });
  });
  await page.goto(appUrl);
  await enterCredentials(page);
  await page.locator("button[type=submit]").click();
  const add = page.getByRole("button", { name: "Add an item to the menu", exact: true });
  const open = page.getByRole("button", { name: "Open till", exact: true });
  await expect(open).toBeVisible();
  await expect.poll(() => page.evaluate(async () => Boolean(navigator.serviceWorker.controller &&
    await caches.match("/", { cacheName: "portable-pos-shell-v1" }))), { timeout: 30000 }).toBe(true);
  offline = true;
  await context.setOffline(true);
  await open.click();
  await page.getByRole("button", { name: /^Legazpi Park/ }).click();
  await page.getByRole("button", { name: "Type the total", exact: true }).click();
  await page.getByRole("textbox", { name: "Starting cash" }).fill("0");
  await open.click();
  await add.click();
  const item = page.getByRole("dialog", { name: "New item" });
  await item.getByRole("textbox", { name: "Name", exact: true }).fill("Ginger tea");
  await item.getByRole("textbox", { name: "Price", exact: true }).fill("55");
  await item.getByRole("button", { name: "Add item", exact: true }).click();
  const prompt = page.getByRole("dialog", { name: "Owner PIN" });
  for (const n of pin) await prompt.getByRole("button", { name: n, exact: true }).click();
  await prompt.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("button", { name: /^Add Ginger tea/ })).toBeVisible();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: "Edit cash float" }).click();
  const float = page.getByRole("dialog", { name: "Cash float" });
  await float.getByLabel("Cash float", { exact: true }).fill("100");
  await float.getByRole("button", { name: "Save changes" }).click();
  await expect(float).toBeHidden();
  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("button", { name: /Offline menu Name, logo and receipt/ }).click();
  await page.getByRole("textbox", { name: "Business name" }).fill("Ginger counter");
  await expect(page.getByRole("button", { name: "Switch business, now Ginger counter" })).toBeVisible();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: "Count drawer and close" }).click();
  const close = page.getByRole("dialog", { name: "Close shift" });
  await close.getByRole("button", { name: "Type the total" }).click();
  await close.getByRole("textbox", { name: "Cash on hand" }).fill("100");
  await close.getByRole("button", { name: "Close shift and see report" }).click();
  await expect(close).toBeHidden();
  await page.reload();
  const waiting = page.getByRole("region", { name: "Register sync" });
  await expect(waiting).toContainText("5 register changes");
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  await page.getByRole("button", { name: /^Menu items/ }).click();
  await expect(page.getByRole("button", { name: /Ginger tea/ }).first()).toBeVisible();
  offline = false;
  await context.setOffline(false);
  await waiting.getByRole("button", { name: "Retry sync" }).click();
  await expect(waiting).toHaveCount(0);
  const saved = await call({ action: "bootstrap", till: bookingId, deviceId });
  expect(saved.shift).toBeNull();
  expect(saved.shifts[0].openingCash).toBe(10000);
  expect(saved.shifts[0].difference).toBe(0);
  expect(saved.business?.name).toBe("Ginger counter");
  expect(saved.menu.filter((i) => i.name === "Ginger tea").map((i) => i.price)).toEqual([5500]);
  expect(sent).toHaveLength(6);
  expect(sent[0]).toBe(sent[1]);
});
