import { expect, test, type Page } from "@playwright/test";
import type { Booking, RegisterState } from "../src/lib/types";

test.use({ viewport: { width: 390, height: 844 } });

async function seedTill(page: Page, withShifts: boolean) {
  await page.clock.setFixedTime(new Date("2026-11-21T04:00:00Z"));
  await page.goto(process.env.POS_TEST_APP_URL ?? "http://localhost:3000");
  await expect(page.getByRole("button", { name: "Account and settings" })).toBeVisible();
  await page.evaluate(async (withShifts) => {
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
          state.business!.timeZone = "Asia/Manila";
          const shift = { ...state.shift!, number: 3, bookingId: undefined };
          const booking = (name: string, startsAt: string, endsAt: string): Booking => ({
            id: name, place: { name }, startsAt, endsAt, organizer: null, event: null,
            seats: 1, staff: [], quota: 0, incentive: 0,
          });
          const first = booking("Atrium", "2026-11-21T03:00:00Z", "2026-11-21T09:00:00Z");
          const second = booking("Garden", "2026-11-21T02:00:00Z", "2026-11-21T08:00:00Z");
          const future = booking("Evening", "2026-11-21T07:00:00Z", "2026-11-21T12:00:00Z");
          const yesterday = booking("Overnight", "2026-11-20T15:30:00Z", "2026-11-21T05:00:00Z");
          const closed = booking("Closed market", "2026-11-21T01:00:00Z", "2026-11-21T07:00:00Z");
          const past = { ...shift, id: "past", number: 2, bookingId: closed.id, openedAt: closed.startsAt, closedAt: "2026-11-21T02:00:00Z", difference: 0 };
          const unscheduled = { ...past, id: "unscheduled", number: 1, bookingId: undefined, openedAt: "2026-11-20T03:00:00Z", closedAt: "2026-11-20T09:00:00Z" };
          state.shift = shift;
          state.bookings = withShifts ? [first, second, future, yesterday, closed] : [];
          state.shifts = withShifts ? [shift, past, unscheduled] : [shift];
          store.put(state, "demo-register-v2");
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, withShifts);
  await page.reload();
}

test("Till shows the shared shift cards and links only after confirmation", async ({ page }) => {
  await seedTill(page, true);
  await page.getByRole("button", { name: "Shifts", exact: true }).click();
  const today = page.getByRole("article").filter({ hasText: "Atrium" });
  await expect(today.getByRole("button", { name: "Report so far", exact: true })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Closed market" }).getByRole("button", { name: "Shift’s report" })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "Evening" }).getByRole("button")).toHaveCount(1);
  const todayCard = await today.innerText();

  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: /Not on a shift yet/ }).click();
  const shifts = page.getByRole("dialog", { name: "Shifts", exact: true });
  await expect(shifts.getByRole("article")).toHaveCount(2);
  const choice = shifts.getByRole("article").filter({ hasText: "Atrium" });
  expect(await choice.innerText()).toBe(todayCard);
  await choice.getByRole("button", { name: "Report so far", exact: true }).click();
  const emptyReport = page.getByRole("dialog", { name: "Atrium report", exact: true });
  await expect(emptyReport.getByText("No till report is available for this shift.")).toBeVisible();
  await emptyReport.getByRole("button", { name: "Close", exact: true }).click();

  await choice.getByRole("button", { name: /Atrium/ }).click();
  const confirmation = page.getByRole("dialog", { name: "Add till to this shift?" });
  await expect(confirmation.getByText("Atrium", { exact: true })).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await shifts.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: /Not on a shift yet/ })).toBeVisible();

  await page.getByRole("button", { name: /Not on a shift yet/ }).click();
  await choice.getByRole("button", { name: /Atrium/ }).click();
  await confirmation.getByRole("button", { name: "Add till", exact: true }).click();
  await expect(page.getByRole("button", { name: /Selling for Atrium/ })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await expect(page.getByRole("button", { name: /Selling for Atrium/ })).toBeVisible();
  await page.getByRole("button", { name: "Shifts", exact: true }).click();
  await today.getByRole("button", { name: "Report so far" }).click();
  await expect(page.getByRole("dialog", { name: "Shift 3 report" })).toBeVisible();
});

test("Past shifts opens reports from shared cards, including tills without bookings", async ({ page }) => {
  await seedTill(page, true);
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: /Past shifts/ }).click();
  const past = page.getByRole("dialog", { name: "Past shifts" });
  await expect(past.getByRole("button", { name: "Shift’s report", exact: true })).toHaveCount(2);
  await past.getByRole("article").filter({ hasText: "Closed market" }).getByRole("button", { name: "Shift’s report" }).click();
  const report = page.getByRole("dialog", { name: "Shift 2 report" });
  await expect(report).toBeVisible();
  await report.getByRole("button", { name: "Close", exact: true }).click();
  await past.getByRole("article").filter({ hasText: "Shift 1" }).getByRole("button", { name: "Shift’s report" }).click();
  await expect(page.getByRole("dialog", { name: "Shift 1 report" })).toBeVisible();
});

test("The Till Shifts sheet reuses the Today empty state and its Add action", async ({ page }) => {
  await seedTill(page, false);
  await page.getByRole("button", { name: "Shifts", exact: true }).click();
  const empty = await page.locator(".empty.card").filter({ hasText: "Nothing scheduled" }).innerText();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: /Not on a shift yet/ }).click();
  const shifts = page.getByRole("dialog", { name: "Shifts", exact: true });
  expect(await shifts.locator(".empty.card").innerText()).toBe(empty);
  await shifts.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "New shift", exact: true })).toBeVisible();
});
