import { expect, test } from "@playwright/test";
import { popoLoading } from "../src/lib/app-brand";
import type { RegisterState } from "../src/lib/types";

const appUrl = process.env.POS_TEST_APP_URL ?? "http://localhost:3000";
const wave = `img[src$="${popoLoading.wave}"]`;
const peek = '[data-popo-motion="curiousPeek"]';
const hop = '[data-popo-motion="victoryHop"]';

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });

test("Popo plays the Masko frames when visible and uses a still pose for reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(appUrl);
  const welcome = page.locator('img[src$="/welcome.webp"]');
  const signInPopo = welcome.locator("..");
  const animated = signInPopo.locator(wave);
  await expect(animated).toBeVisible();
  await expect(animated).toBeInViewport({ ratio: 1 });
  await expect(animated).toHaveCSS("animation-name", "none");
  const first = await animated.screenshot();
  await expect.poll(async () => !(await animated.screenshot()).equals(first)).toBe(true);
  await expect(welcome).toBeHidden();

  await signInPopo.evaluate((element) => { (element as HTMLElement).style.translate = "0 150vh"; });
  await expect(animated).toHaveCount(0);

  await page.getByRole("button", { name: "Try the demo" }).click();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  const drawer = page.locator(".hero").filter({ hasText: "Expected in the drawer" });
  const drawerPopo = drawer.locator(peek);
  await expect(drawer).toHaveCSS("overflow", "hidden");
  await expect(drawerPopo).toHaveAttribute("data-animating", "");
  const clip = drawerPopo.locator(".masko-player");
  const atStart = await clip.screenshot();
  await expect.poll(async () => !(await clip.screenshot()).equals(atStart)).toBe(true);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(clip).toHaveCount(0);
  await expect(drawerPopo.locator('img[src$="/poster.png"]')).toBeVisible();
});

test("Sales, Shifts, and the invite sheet each play their assigned clip", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.clock.setFixedTime(new Date("2026-11-21T01:41:00Z"));
  await page.goto(appUrl);
  await page.getByRole("button", { name: "Try the demo" }).click();

  await page.getByRole("button", { name: "Sales", exact: true }).click();
  const sales = page.locator(".empty").filter({ hasText: "No sales yet" });
  await expect(sales.locator(wave)).toBeVisible();
  await expect(sales.getByRole("button", { name: "Start selling" })).toBeVisible();

  await page.getByRole("button", { name: "Shifts", exact: true }).click();
  await page.getByRole("button", { name: "Previous month" }).click();
  const shifts = page.locator(".empty").filter({ hasText: "Nothing scheduled" });
  await expect(shifts.locator(peek)).toHaveAttribute("data-animating", "");
  await expect(shifts.locator('img[src$="/plan.webp"]')).toBeHidden();
  const frame = shifts.locator(".masko-player");
  const firstFrame = await frame.screenshot();
  await expect.poll(async () => !(await frame.screenshot()).equals(firstFrame)).toBe(true);
  await expect(shifts.getByRole("button", { name: "Add", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("button", { name: /^Team\b/ }).click();
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const invite = page.getByRole("dialog", { name: "Invite someone" });
  await expect(invite.locator(wave)).toBeVisible();
  await expect(invite.getByRole("button", { name: "Close" })).toBeVisible();
});

test("Victory Hop plays on the completed sale", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(appUrl);
  await page.getByRole("button", { name: "Try the demo" }).click();
  await page.getByRole("button", { name: /^Add Espresso/ }).click();
  await page.locator(".charge-bar").click();
  const checkout = page.getByRole("dialog", { name: "Charge", exact: true });
  await checkout.getByRole("button", { name: "Cash", exact: true }).click();
  await checkout.getByRole("button", { name: "Exact", exact: true }).click();
  await page.getByRole("button", { name: "Confirm sale", exact: true }).click();
  const success = page.getByRole("dialog", { name: "Sale complete" });
  await expect(success.locator(hop)).toHaveAttribute("data-animating", "");
  await expect(success.getByRole("button", { name: "View receipt" })).toBeVisible();
});

test("Till keeps a still Popo if the clip cannot be loaded", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/mascots/popo/curious-peek.*", (route) => route.abort());
  await page.goto(appUrl);
  await page.getByRole("button", { name: "Try the demo" }).click();
  const blocked = page.waitForEvent("requestfailed", (request) => request.url().includes("/curious-peek."));
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await blocked;
  const drawerPopo = page.locator(".hero").filter({ hasText: "Expected in the drawer" }).locator(peek);
  await expect(drawerPopo.locator(".masko-player")).toHaveCount(0);
  await expect(drawerPopo.locator('img[src$="/poster.png"]')).toBeVisible();
});

test("Popo appears beside the first actions in Sell and Prep", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(appUrl);
  await page.getByRole("button", { name: "Try the demo" }).click();

  await page.getByRole("button", { name: /^Recipes/ }).click();
  await page.getByRole("button", { name: /^Prep What you make/ }).click();
  const prep = page.locator(".empty").filter({ hasText: "Nothing made ahead yet" });
  await expect(prep.locator(peek)).toHaveAttribute("data-animating", "");
  await prep.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "New prep item", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("portable-pos-register", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("registers", "readwrite");
      const store = tx.objectStore("registers");
      const get = store.get("demo-register-v2");
      get.onsuccess = () => {
        const state = get.result as RegisterState;
        state.menu = [];
        state.shift!.menu = [];
        store.put(state, "demo-register-v2");
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  await page.reload();
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  const sell = page.locator(".empty").filter({ hasText: "No items on this shift" });
  await expect(sell.locator(peek)).toHaveAttribute("data-animating", "");
  await sell.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "New item", exact: true })).toBeVisible();
});

test("Popo welcomes a teammate opening a valid invite", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/api/links/invite/invite42", (route) => route.fulfill({
    json: {
      business: { name: "Market Counter", brand: "#151515" },
      invite: { name: "Bea", owner: false, invitedBy: "Alex" },
    },
  }));
  await page.goto(new URL("/i/invite42", appUrl).href);
  const invite = page.getByRole("region", { name: "Market Counter", exact: true });
  await expect(invite.getByText(/Alex invited you to join as Bea/)).toBeVisible();
  await expect(invite.locator(wave)).toBeVisible();

  await page.unroute("**/api/links/invite/invite42");
  await page.route("**/api/links/invite/invite42", (route) => route.fulfill({ status: 404 }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "This invite was used" })).toBeVisible();
  await expect(page.locator(wave)).toHaveCount(0);
});
