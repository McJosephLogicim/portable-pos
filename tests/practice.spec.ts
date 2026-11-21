import { expect, test } from "@playwright/test";
import { DEMO, PRACTICE } from "../src/lib/demo";
import type { RegisterState } from "../src/lib/types";

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });

test("the full walkthrough resumes on this device and keeps its records out of sync", async ({ context, page }) => {
  const registerRequests: string[] = [];
  await page.route("**/api/**", async (route) => {
    registerRequests.push(route.request().url());
    await route.abort();
  });
  await page.goto(process.env.POS_TEST_APP_URL ?? "http://localhost:3000");
  const practice = page.getByRole("button", { name: /Practice with POP POS/ });
  await practice.click();
  await expect(page.getByRole("heading", { name: "Add menu items" })).toBeVisible();

  await page.getByRole("button", { name: "Add an item" }).click();
  const item = page.getByRole("dialog", { name: "New item" });
  await item.getByRole("textbox", { name: "Name", exact: true }).fill("Practice iced latte");
  await item.getByRole("textbox", { name: "Price" }).fill("170");
  await item.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make your first sale" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Make your first sale" })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Try Sell" }).click();
  await page.getByRole("button", { name: /^Add Practice iced latte/ }).click();
  await page.getByRole("button", { name: /^Charge .* for 1 item/ }).click();
  await page.getByRole("button", { name: "Exact" }).click();
  await page.getByRole("button", { name: "Confirm sale", exact: true }).click();
  await page.getByRole("dialog", { name: "Sale complete" }).getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Add a shift" }).click();
  const shift = page.getByRole("dialog", { name: "New shift" });
  await shift.getByRole("combobox", { name: "Shift name (optional)" }).fill("Practice coffee pop-up");
  await shift.getByRole("textbox", { name: "Date" }).fill("2030-01-02");
  await shift.getByRole("button", { name: "Add shift" }).click();
  await expect(shift).toBeHidden();

  await page.getByRole("button", { name: "Open Till" }).click();
  await page.getByRole("dialog", { name: "Shifts" }).getByRole("button", { name: /Practice coffee pop-up/ }).click();
  await page.getByRole("dialog", { name: "Add till to this shift?" }).getByRole("button", { name: "Add till" }).click();

  await context.setOffline(false);
  await page.getByRole("button", { name: "Count and close" }).click();
  const close = page.getByRole("dialog", { name: "Close shift 1" });
  await close.getByRole("button", { name: "Type the total" }).click();
  await close.getByRole("textbox", { name: "Cash on hand" }).fill("170");
  await close.getByRole("button", { name: "Close shift and see report" }).click();
  const report = page.getByRole("dialog", { name: "Shift 1 closed" });
  await expect(report.getByText("Drawer balanced")).toBeVisible();
  await expect(report.getByText("1 sale recorded")).toBeVisible();
  await report.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Add someone" }).click();
  const team = page.getByRole("dialog", { name: "Add someone" });
  await team.getByRole("textbox", { name: "Name", exact: true }).fill("Practice teammate");
  await team.getByRole("textbox", { name: /Email \(optional\)/ }).fill("teammate@example.test");
  await team.getByRole("button", { name: "Add person" }).click();

  await expect(page.getByRole("heading", { name: "Sign in to POP POS" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to your register" })).toBeVisible();
  expect(registerRequests).toEqual([]);

  const stored = await page.evaluate(async ({ practiceKey, demoKey }) =>
    new Promise<{ practice: RegisterState; demo?: RegisterState }>((resolve, reject) => {
      const request = indexedDB.open("portable-pos-register", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("registers");
        const store = tx.objectStore("registers");
        const practice = store.get(practiceKey);
        const demo = store.get(demoKey);
        tx.oncomplete = () => {
          db.close();
          resolve({ practice: practice.result, demo: demo.result });
        };
        tx.onerror = () => reject(tx.error);
      };
    }),
    { practiceKey: PRACTICE, demoKey: DEMO },
  );
  expect(stored.demo).toBeUndefined();
  expect(stored.practice.menu.map((product) => product.name)).toEqual(["Practice iced latte"]);
  expect(stored.practice.pending).toEqual([]);
  expect(stored.practice.sales).toHaveLength(1);
  expect(stored.practice.sales[0].total).toBe(17000);
  expect(stored.practice.shift).toBeNull();
  expect(stored.practice.shifts[0]).toMatchObject({ bookingId: stored.practice.bookings![0].id, difference: 0 });
  expect(stored.practice.team).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Practice teammate", email: "teammate@example.test" })]));
});
