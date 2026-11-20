import { expect, test, type Locator, type Page } from "@playwright/test";
import { demoBootstrap } from "../src/lib/demo";
import { makeSale } from "../src/lib/domain";
import type { Booking, RegisterState } from "../src/lib/types";

test.use({ viewport: { width: 390, height: 844 } });

async function seedTill(page: Page, withShifts: boolean, withPastSale = false, { opening = false } = {}) {
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
  await page.evaluate(async ({ withShifts, sales, opening }) => {
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
          state.shift = opening ? null : shift;
          state.bookings = withShifts ? [first, second, future, yesterday, closed] : [];
          state.shifts = opening ? [past, unscheduled] : withShifts ? [shift, past, unscheduled] : [shift];
          if (opening) {
            state.business!.settings.checklist = [];
            state.business!.settings.stockItems!.find((i) => i.id === "milk")!.onHand = 5;
            state.menu.find((item) => item.name === "Espresso")!.stock = true;
          }
          state.sales = sales;
          store.put(state, "demo-register-v2");
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, { withShifts, sales, opening });
  await page.reload();
}

test("Opening and closing tills can review stock and manage shift expenses", async ({ page }) => {
  await seedTill(page, true, false, { opening: true });
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: /Atrium/ }).click();

  const reviewStock = async (title: string) => {
    const stock = page.getByRole("region", { name: title });
    await expect(stock.getByRole("switch", { name: "Count stock and prep" })).not.toBeChecked();
    const disclosure = stock.locator("summary").filter({ hasText: /^Stock and prep$/ });
    const milk = stock.getByText("Fresh milk", { exact: true });
    await expect(milk).toBeHidden();
    await disclosure.click();
    await expect(milk).toBeVisible();
    await expect(stock.getByText("5 L", { exact: true })).toBeVisible();
    await disclosure.click();
    await expect(milk).toBeHidden();
    await stock.getByRole("textbox", { name: /How many .* of Espresso/ }).fill("5");
  };
  const logExpense = async (label: string, amount: string, source: "Cash from the till" | "Own pocket", within: Page | Locator = page) => {
    await within.getByRole("region", { name: "Expenses" }).getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("menuitem", { name: "Add an expense" }).click();
    const form = page.getByRole("dialog", { name: "Log an expense" });
    await form.getByRole("combobox", { name: "What for" }).fill(label);
    await form.getByRole("textbox", { name: "Amount" }).fill(amount);
    await form.getByRole("button", { name: source, exact: true }).click();
    await form.getByRole("button", { name: /^Log ₱/ }).click();
    await expect(form).toBeHidden();
  };
  const removeExpense = async (label: string, within: Page | Locator = page) => {
    await within.getByRole("button", { name: `Remove ${label}` }).click();
    const confirm = page.getByRole("dialog", { name: "Remove expense?" });
    await confirm.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(confirm).toBeHidden();
  };
  await reviewStock("Opening stock");
  await logExpense("Opening supplies", "20", "Cash from the till");
  await logExpense("Discarded draft", "15", "Own pocket");
  await removeExpense("Discarded draft");
  await page.getByRole("button", { name: "Type the total" }).click();
  await page.getByRole("textbox", { name: "Starting cash" }).fill("100");
  await page.getByRole("button", { name: "Open till", exact: true }).click();
  await expect(page.getByRole("button", { name: /Selling for Atrium/ })).toBeVisible();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await expect(page.getByText("Opening supplies", { exact: true })).toBeVisible();
  await expect(page.getByText("Discarded draft", { exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Count drawer and close" }).click();
  const closing = page.getByRole("dialog", { name: /^Close shift/ });
  const drawer = closing.locator(".tile").filter({ hasText: "Expected in the drawer" });
  await expect(drawer.getByText("₱80", { exact: true })).toBeVisible();
  await reviewStock("Closing stock");
  await logExpense("Closing fare", "30", "Own pocket", closing);
  await expect(drawer.getByText("₱80", { exact: true })).toBeVisible();
  await logExpense("Closing supplies", "10", "Cash from the till", closing);
  await expect(drawer.getByText("₱70", { exact: true })).toBeVisible();
  await closing.getByRole("region", { name: "Expenses" }).getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add bulk" }).click();
  const batch = page.getByRole("dialog", { name: "Add expenses in bulk" });
  for (const [label, amount, source] of [["Batch supplies", "5", "Cash from the till"], ["Batch fare", "10", "Own pocket"]]) {
    await batch.getByRole("button", { name: "Add an expense" }).click();
    const form = page.getByRole("dialog", { name: "Log an expense" });
    await form.getByRole("combobox", { name: "What for" }).fill(label);
    await form.getByRole("textbox", { name: "Amount" }).fill(amount);
    await form.getByRole("button", { name: source, exact: true }).click();
    await form.getByRole("button", { name: "Add to batch" }).click();
    await expect(form).toBeHidden();
  }
  await batch.getByRole("button", { name: "Add 2 expenses", exact: true }).click();
  await expect(batch).toBeHidden();
  await expect(drawer.getByText("₱65", { exact: true })).toBeVisible();
  await removeExpense("Opening supplies", closing);
  await expect(drawer.getByText("₱85", { exact: true })).toBeVisible();

  await closing.getByRole("button", { name: "Type the total" }).click();
  await closing.getByRole("textbox", { name: "Cash on hand" }).fill("85");
  await closing.getByRole("button", { name: "Close shift and see report" }).click();
  const pin = page.getByRole("dialog", { name: "Owner PIN" });
  for (const digit of "1234") await pin.getByRole("button", { name: digit, exact: true }).click();
  await pin.getByRole("button", { name: "Confirm" }).click();
  const report = page.getByRole("dialog", { name: /Shift .* closed/ });
  await report.getByText("Show as text", { exact: true }).click();
  await expect(report.locator("pre")).toContainText("Closing supplies");
  await expect(report.locator("pre")).toContainText("Closing fare");
  await expect(report.locator("pre")).toContainText("Batch supplies");
  await expect(report.locator("pre")).toContainText("Batch fare");
  await expect(report.locator("pre")).not.toContainText("Opening supplies");
});

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
  await expect(shifts.getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await shifts.getByRole("button", { name: "Go to Shifts", exact: true }).click();
  await expect(shifts).toBeHidden();
  await expect(page.getByRole("heading", { name: "Shifts", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: /Not on a shift yet/ }).click();
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

test("The Till Shifts sheet offers both Add actions in the empty state", async ({ page }) => {
  await seedTill(page, false);
  await page.getByRole("button", { name: "Shifts", exact: true }).click();
  const emptyText = await page.locator(".empty.card").filter({ hasText: "Nothing scheduled" }).locator(".empty-text").innerText();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: /Not on a shift yet/ }).click();
  const shifts = page.getByRole("dialog", { name: "Shifts", exact: true });
  const empty = shifts.locator(".empty.card").filter({ hasText: "Nothing scheduled" });
  await expect(empty.locator(".empty-text")).toHaveText(emptyText);
  await expect(shifts.getByRole("button", { name: "Go to Shifts", exact: true })).toBeVisible();
  await expect(shifts.getByRole("button", { name: "Add", exact: true })).toHaveCount(1);
  const add = empty.getByRole("button", { name: "Add", exact: true });
  await add.click();
  await page.getByRole("menuitem", { name: "Add a shift" }).click();
  const single = page.getByRole("dialog", { name: "New shift", exact: true });
  await expect(single).toBeVisible();
  await single.getByRole("button", { name: "Close" }).click();
  await add.click();
  await page.getByRole("menuitem", { name: "Add bulk" }).click();
  await expect(page.getByRole("dialog", { name: "Add many shifts", exact: true })).toBeVisible();
});
