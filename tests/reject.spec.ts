import { expect, test } from "@playwright/test";

// Run against a local demo: POS_TEST_APP_URL=http://localhost:3000 npx playwright test tests/reject.spec.ts
test.use({ viewport: { width: 375, height: 760 }, hasTouch: true, serviceWorkers: "block" });

test("tapping a shift that can't open yet says when the till opens", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-21T04:00:00Z")); // Saturday noon in Manila
  await page.goto(process.env.POS_TEST_APP_URL ?? "http://localhost:3000");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page.getByRole("button", { name: "Account and settings" })).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("portable-pos-register", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const tx = request.result.transaction("registers", "readwrite");
        const store = tx.objectStore("registers");
        const get = store.get("demo-register-v2");
        get.onsuccess = () => {
          const state = get.result;
          state.business.timeZone = "Asia/Manila";
          state.shift = null;
          state.bookings = [{
            id: "monday", place: { name: "Mall atrium" }, organizer: null, event: null,
            startsAt: "2026-11-23T02:00:00Z", endsAt: "2026-11-23T10:00:00Z",
            seats: 1, staff: [], quota: 0, incentive: 0,
          }];
          store.put(state, "demo-register-v2");
          tx.oncomplete = () => resolve();
        };
      };
    });
  });
  await page.reload();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Till" }).click();
  const row = page.getByRole("button", { name: /Mall atrium/ });
  await expect(row).toHaveAttribute("aria-disabled", "true");
  await row.click({ force: true });
  await expect(page.locator(".toast:not(.exit-ghost)")).toContainText("Not yet. The till opens Monday at 9:30 AM.");
  // The tap didn't start opening the till.
  await expect(page.getByRole("heading", { name: "Open till" })).toBeVisible();
  await expect(page.getByText("Starting cash")).toHaveCount(0);
});

test("a sold-out item says so instead of being added", async ({ page }) => {
  await page.goto(process.env.POS_TEST_APP_URL ?? "http://localhost:3000");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await page.getByRole("button", { name: "Mark items sold out" }).click();
  await page.getByRole("button", { name: /^Mark sold out: Butter Croissant/ }).click();
  await page.getByRole("button", { name: "Mark items sold out" }).click();
  const tile = page.getByRole("button", { name: /^Add Butter Croissant/ });
  await tile.click({ force: true });
  await expect(page.locator(".toast:not(.exit-ghost)")).toContainText("Butter Croissant is sold out.");
  await expect(tile).not.toHaveAccessibleName(/in order/);
});
