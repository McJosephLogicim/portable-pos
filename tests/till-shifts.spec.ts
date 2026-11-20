import { expect, test, type Page } from "@playwright/test";
import { demoBootstrap } from "../src/lib/demo";
import { makeSale } from "../src/lib/domain";
import type { Booking, RegisterState } from "../src/lib/types";

test.use({ viewport: { width: 390, height: 844 } });

async function seedTill(page: Page, withShifts: boolean, withPastSale = false) {
  await page.clock.setFixedTime(new Date("2026-11-21T04:00:00Z"));
  await page.goto(process.env.POS_TEST_APP_URL ?? "http://localhost:3000");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page.getByRole("button", { name: "Account and settings" })).toBeVisible();
  const demo = demoBootstrap("test-device");
  const espresso = demo.menu.find((item) => item.name === "Espresso")!;
  const sales = withPastSale ? [makeSale({
    id: "past-sale", shift: { ...demo.shift!, id: "past" }, sequence: 1, soldOut: [],
    tender: "cash", received: espresso.price, createdAt: "2026-11-21T01:30:00Z",
    cart: [{ productId: espresso.id, quantity: 1, optionIds: [] }],
  })] : [];
  await page.evaluate(async ({ withShifts, sales }) => {
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
          const first = { ...booking("Atrium", "2026-11-21T03:00:00Z", "2026-11-21T09:00:00Z"), id: "booking-1" };
          const second = booking("Garden", "2026-11-21T02:00:00Z", "2026-11-21T08:00:00Z");
          const future = booking("Evening", "2026-11-21T07:00:00Z", "2026-11-21T12:00:00Z");
          const yesterday = booking("Overnight", "2026-11-20T15:30:00Z", "2026-11-21T05:00:00Z");
          const closed = booking("Closed market", "2026-11-21T01:00:00Z", "2026-11-21T03:00:00Z");
          const past = { ...shift, id: "past", number: 2, bookingId: closed.id, openedAt: closed.startsAt, closedAt: "2026-11-21T02:00:00Z", difference: 0 };
          const unscheduled = { ...past, id: "unscheduled", number: 1, bookingId: undefined, openedAt: "2026-11-20T03:00:00Z", closedAt: "2026-11-20T09:00:00Z" };
          state.shift = shift;
          state.bookings = withShifts ? [first, second, future, yesterday, closed] : [];
          state.shifts = withShifts ? [shift, past, unscheduled] : [shift];
          state.sales = sales;
          store.put(state, "demo-register-v2");
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, { withShifts, sales });
  await page.reload();
}

test("Today and the Till picker reuse shift details and link only after confirmation", async ({ page }) => {
  await seedTill(page, true, true);
  await page.getByRole("button", { name: "Shifts", exact: true }).click();
  const today = page.getByRole("article").filter({ hasText: "Atrium" });
  await expect(today.getByRole("button")).toHaveCount(1);
  const todayCard = await today.innerText();
  const details = page.getByRole("dialog", { name: "Atrium", exact: true });
  await today.getByRole("button", { name: /Atrium/ }).click();
  const actions = details.getByRole("group", { name: "Shift actions" }).getByRole("button");
  await expect(actions).toHaveText(["Share", "Report", "Delete"]);
  await actions.getByText("Share", { exact: true }).click();
  const share = page.getByRole("dialog", { name: "Share this shift" });
  await expect(share.getByText(/View shift:/)).toBeVisible();
  await expect(share.locator("pre")).toHaveText(/Portable POS$/);
  await share.getByRole("button", { name: "Close", exact: true }).click();
  await details.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete shift?" }).getByRole("button", { name: "Cancel" }).click();
  await details.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: /Not on a shift yet/ }).click();
  const shifts = page.getByRole("dialog", { name: "Shifts", exact: true });
  await expect(shifts.getByRole("article")).toHaveCount(2);
  const choice = shifts.getByRole("article").filter({ hasText: "Atrium" });
  expect(await choice.innerText()).toBe(todayCard);
  await choice.getByRole("button", { name: /Atrium/ }).click();
  await expect(actions).toHaveText(["Share", "Report", "Delete"]);
  await details.getByRole("button", { name: "Report", exact: true }).click();
  const emptyReport = page.getByRole("dialog", { name: "Atrium report", exact: true });
  await expect(emptyReport.getByText("No till report is available for this shift.")).toBeVisible();
  await emptyReport.getByRole("button", { name: "Close", exact: true }).click();

  await details.getByRole("button", { name: "Add till", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Add till to this shift?" });
  await expect(confirmation.getByText("Atrium", { exact: true })).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await details.getByRole("button", { name: "Close", exact: true }).click();
  await shifts.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: /Not on a shift yet/ })).toBeVisible();

  await page.getByRole("button", { name: /Not on a shift yet/ }).click();
  await choice.getByRole("button", { name: /Atrium/ }).click();
  await details.getByRole("button", { name: "Add till", exact: true }).click();
  await confirmation.getByRole("button", { name: "Add till", exact: true }).click();
  await expect(page.getByRole("button", { name: /Selling for Atrium/ })).toBeVisible();
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  const activeShift = page.getByRole("button", { name: "Remove shift Atrium", exact: true });
  await expect(activeShift).toBeVisible();
  await page.getByRole("button", { name: "Filters · 1", exact: true }).click();
  const filters = page.getByRole("dialog", { name: "Filter sales" });
  await expect(filters.getByRole("button", { name: /Atrium.*0/ })).toHaveAttribute("aria-pressed", "true");
  await filters.getByRole("button", { name: "Close", exact: true }).click();
  await activeShift.click();
  await expect(page.getByRole("button", { name: /Receipt .* Espresso/ })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await expect(page.getByRole("button", { name: /Selling for Atrium/ })).toBeVisible();
  await page.getByRole("button", { name: "Shifts", exact: true }).click();
  await today.getByRole("button", { name: /Atrium/ }).click();
  await details.getByRole("button", { name: "Report", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Shift 3 report" })).toBeVisible();
});

test("Past shift cards open details for both scheduled and unscheduled tills", async ({ page }) => {
  await seedTill(page, true);
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: /Past shifts/ }).click();
  const past = page.getByRole("dialog", { name: "Past shifts" });
  await expect(past.getByRole("article")).toHaveCount(2);
  await past.getByRole("button", { name: /Closed market/ }).click();
  const scheduled = page.getByRole("dialog", { name: "Closed market", exact: true });
  await expect(scheduled.getByRole("group", { name: "Shift actions" }).getByRole("button")).toHaveText(["Share", "Report", "Delete"]);
  await scheduled.getByRole("button", { name: "Report", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Shift 2 report" });
  await expect(report.getByRole("img", { name: "Shift 2 report" })).toBeVisible();
  await report.getByText("Show as text", { exact: true }).click();
  await expect(report.locator("pre")).toHaveText(/Portable POS$/);
  await report.getByRole("button", { name: "Close", exact: true }).click();
  await scheduled.getByRole("button", { name: "Close", exact: true }).click();
  await past.getByRole("button", { name: /Shift 1/ }).click();
  const unscheduled = page.getByRole("dialog", { name: "Shift 1", exact: true });
  await expect(unscheduled.getByRole("group", { name: "Shift actions" }).getByRole("button")).toHaveText(["Share", "Report"]);
  await unscheduled.getByRole("button", { name: "Report", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Shift 1 report" })).toBeVisible();
});

test("Leaderboard Share keeps its accessible name when the visible label collapses", async ({ page }) => {
  await seedTill(page, true);
  await page.getByRole("button", { name: "Shifts", exact: true }).click();
  await page.getByRole("button", { name: "Leaderboard", exact: true }).click();
  const category = page.getByRole("combobox", { name: "Leaderboard category" });
  await expect(category).toHaveValue("people");
  await category.selectOption("place");
  const share = page.getByRole("button", { name: "Share", exact: true });
  const label = share.getByText("Share", { exact: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(label).toHaveCSS("clip-path", "inset(50%)");
  await share.click();
  const sheet = page.getByRole("dialog", { name: "Share places leaderboard" });
  await expect(sheet.getByRole("img", { name: "Share places leaderboard" })).toBeVisible();
  await sheet.getByText("Show as text", { exact: true }).click();
  await expect(sheet.locator("pre")).toHaveText(/Portable POS$/);
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 768, height: 844 });
  await expect(label).toHaveCSS("clip-path", "none");
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
