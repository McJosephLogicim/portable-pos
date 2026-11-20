import { expect, test, type Page } from "@playwright/test";
import type { RegisterState } from "../src/lib/types";

// Run against a local demo: POS_TEST_APP_URL=http://localhost:3000 npx playwright test tests/simple-opening.spec.ts
test.use({ viewport: { width: 390, height: 844 } });

async function closedTill(page: Page, mode: "simple" | "advanced" = "simple", requirements = false, scheduled = false) {
  await page.goto(process.env.POS_TEST_APP_URL ?? "http://localhost:3000");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page.getByRole("button", { name: "Account and settings" })).toBeVisible();
  await page.evaluate(async ({ mode, requirements, scheduled }) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("portable-pos-register", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("registers", "readwrite");
        const store = tx.objectStore("registers");
        const get = store.get("demo-register-v2");
        get.onsuccess = () => {
          const state = get.result as RegisterState;
          state.business!.settings.mode = mode;
          state.business!.settings.stockItems = requirements ? [{ id: "milk", name: "Fresh milk", unit: "L" }] : [];
          state.business!.settings.checklist = requirements ? [{ id: "qr", text: "Put out the QR stand" }] : [];
          state.menu = state.menu.filter((item) => item.name === "Espresso");
          state.shift = null;
          state.shifts = [];
          const booking = state.bookings?.[0];
          state.bookings = scheduled && booking ? [{
            ...booking,
            id: "opening-test",
            place: { name: "Opening test" },
            event: null,
            organizer: null,
            startsAt: new Date(Date.now() - 3600000).toISOString(),
            endsAt: new Date(Date.now() + 7200000).toISOString(),
            staff: [],
          }] : [];
          state.sales = [];
          state.pending = [];
          store.put(state, "demo-register-v2");
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, { mode, requirements, scheduled });
  await page.reload();
}

for (const mode of ["simple", "advanced"] as const) {
  test(`${mode} requires a scheduled shift before opening the till`, async ({ page }) => {
    await closedTill(page, mode);
    await expect(page.getByRole("heading", { name: "Till closed", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Open till", exact: true }).click();
    await expect(page.getByRole("button", { name: "Till", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Open till", exact: true })).toBeVisible();
    await expect(page.getByText("Nothing scheduled", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open till", exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Starting cash", exact: true })).toHaveCount(0);
  });

  test(`${mode} uses the same cash, stock and checklist flow for a scheduled shift`, async ({ page }) => {
    await closedTill(page, mode, true, true);
    await page.getByRole("button", { name: "Open till", exact: true }).click();
    await page.getByRole("button", { name: /^Opening test/ }).click();
    await expect(page.getByRole("heading", { name: "Open till", exact: true })).toBeVisible();
    await expect(page.getByText("Starting cash", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Type the total", exact: true }).click();
    await expect(page.getByText("Starting cash", { exact: true })).toHaveCount(1);
    await page.getByRole("textbox", { name: "Starting cash", exact: true }).fill("500");
    const open = page.getByRole("button", { name: "Open till", exact: true });
    await expect(open).toBeDisabled();
    await page.getByRole("textbox", { name: "How many L of Fresh milk", exact: true }).fill("4");
    await expect(open).toBeDisabled();
    await page.getByRole("checkbox", { name: "Put out the QR stand", exact: true }).click();
    await expect(open).toBeEnabled();
    await open.click();
    await expect(page.getByRole("button", { name: /^Add Espresso/ })).toBeVisible();
    await page.getByRole("button", { name: "Till", exact: true }).click();
    await page.getByRole("button", { name: "Count drawer and close", exact: true }).click();
    await expect(page.getByRole("button", { name: "Coins and bills", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Type the total", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Cash on hand", exact: true })).toBeVisible();
  });
}
