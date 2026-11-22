import { expect, test, type Locator, type Page } from "@playwright/test";
import { demoBootstrap } from "../src/lib/demo";
import { makeSale } from "../src/lib/domain";
import type { Booking, RegisterState } from "../src/lib/types";

test.use({ viewport: { width: 390, height: 844 } });

async function seedTill(
  page: Page,
  withShifts: boolean,
  withPastSale = false,
  { opening = false, rankedAs }: { opening?: boolean; rankedAs?: "owner" | "member" } = {},
) {
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
  await page.evaluate(async ({ withShifts, sales, opening, rankedAs }) => {
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
          if (rankedAs) {
            const names = ["Mika Reyes", "Bea Cruz", "Paolo Tan", "Jules Lim", "Sam Flores", "Ana Cruz", "Tess Ong", "Lia Uy", "Marco Go", "Nico Lao"];
            state.me = { memberId: "member-5", name: "Ana Cruz", roles: ["cashier"], owner: rankedAs === "owner" };
            const testPhoto = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="240"><rect width="120" height="240" fill="#c1d8ee"/><circle cx="60" cy="120" r="47" fill="#5c7da2"/></svg>');
            state.faces = Object.fromEntries(names.map((_, index) => ["member-" + index, testPhoto]));
            state.bookings = names.map((name, index) => ({
              ...booking("Market " + index, "2026-11-11T01:00:00Z", "2026-11-11T03:00:00Z"),
              staff: [{ memberId: "member-" + index, name, role: "cashier" }],
              sales: (50_000 - index * 2500) * 100,
              rent: 7000 * 100,
              hit: index < 3,
            }));
          }
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
  }, { withShifts, sales, opening, rankedAs });
  await page.reload();
}

test("Opening and closing tills can review stock, with expenses available after opening", async ({ page }) => {
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
    const add = within.getByRole("region", { name: "Expenses" }).getByRole("button", { name: "Add", exact: true });
    await expect(add).toHaveAttribute("aria-haspopup", "dialog");
    await add.click();
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
  await expect(page.getByRole("region", { name: "Expenses" })).toHaveCount(0);
  await page.getByRole("button", { name: "Type the total" }).click();
  await page.getByRole("textbox", { name: "Starting cash" }).fill("100");
  await page.getByRole("button", { name: "Open till", exact: true }).click();
  await expect(page.getByRole("button", { name: /Selling for Atrium/ })).toBeVisible();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await logExpense("Till supplies", "20", "Cash from the till");
  await page.getByRole("button", { name: /^Till supplies/ }).click();
  const edit = page.getByRole("dialog", { name: "Edit expense" });
  await expect(edit.getByRole("combobox", { name: "What for" })).toHaveValue("Till supplies");
  await expect(edit.getByRole("textbox", { name: "Amount" })).toHaveValue("20.00");
  await expect(edit.getByRole("button", { name: "Cash from the till" })).toHaveAttribute("aria-pressed", "true");
  await edit.getByRole("combobox", { name: "What for" }).fill("Ice packs");
  await edit.getByRole("textbox", { name: "Amount" }).fill("25.50");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Ice packs.*25\.50/ })).toBeVisible();

  await page.getByRole("button", { name: "Count drawer and close" }).click();
  const closing = page.getByRole("dialog", { name: /^Close shift/ });
  const drawer = closing.locator(".tile").filter({ hasText: "Expected in the drawer" });
  await expect(drawer.getByText("₱74.50", { exact: true })).toBeVisible();
  await reviewStock("Closing stock");
  await logExpense("Closing fare", "30", "Own pocket", closing);
  await expect(drawer.getByText("₱74.50", { exact: true })).toBeVisible();
  await logExpense("Closing supplies", "10", "Cash from the till", closing);
  await expect(drawer.getByText("₱64.50", { exact: true })).toBeVisible();
  await closing.getByRole("button", { name: /^Ice packs/ }).click();
  await edit.getByRole("button", { name: "Own pocket" }).click();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await expect(drawer.getByText("₱90", { exact: true })).toBeVisible();
  await removeExpense("Closing fare", closing);

  await closing.getByRole("button", { name: "Type the total" }).click();
  await closing.getByRole("textbox", { name: "Cash on hand" }).fill("90");
  await closing.getByRole("button", { name: "Close shift and see report" }).click();
  const pin = page.getByRole("dialog", { name: "Owner PIN" });
  for (const digit of "1234") await pin.getByRole("button", { name: digit, exact: true }).click();
  await pin.getByRole("button", { name: "Confirm" }).click();
  const report = page.getByRole("dialog", { name: /Shift .* closed/ });
  await expect(report.locator('[data-popo-motion="victoryHop"]')).toHaveAttribute("data-animating", "");
  await report.getByText("Show as text", { exact: true }).click();
  await expect(report.locator("pre")).toContainText("Closing supplies");
  await expect(report.locator("pre")).toContainText("Ice packs");
  await expect(report.locator("pre")).not.toContainText("Closing fare");
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
  await expect(share.locator("pre")).toHaveText(/POP POS$/);
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
  await expect(report.locator("pre")).toHaveText(/POP POS$/);
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
  await expect(sheet.locator("pre")).toHaveText(/POP POS$/);
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await page.setViewportSize({ width: 768, height: 844 });
  await expect(label).toHaveCSS("clip-path", "none");
});

test("Blue Halo raises first place and can jump to your row on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 660 });
  await seedTill(page, true, false, { rankedAs: "owner" });
  await page.getByRole("button", { name: "Shifts", exact: true }).click();
  await page.getByRole("button", { name: "Leaderboard", exact: true }).click();

  const podium = page.getByRole("list", { name: "Top ranks" });
  const top = podium.getByRole("listitem");
  await expect(top).toHaveCount(3);
  await expect(top.nth(0)).toContainText("Mika Reyes");
  const [winner, second, third] = await Promise.all([0, 1, 2].map((index) => top.nth(index).boundingBox()));
  expect(winner!.y).toBeLessThan(second!.y - 70);
  expect(second!.x).toBeLessThan(winner!.x);
  expect(third!.x).toBeGreaterThan(winner!.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

  const myRank = page.getByRole("list", { name: "Remaining ranks" }).getByRole("listitem").filter({ hasText: "Ana Cruz" });
  const jump = page.getByRole("button", { name: "Jump to your rank, number 6" });
  const crown = podium.locator('img[src$="/leaderboard-crown.webp"]');
  await expect(crown).toBeVisible();
  await expect.poll(() => crown.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  for (const photo of [top.nth(0), top.nth(1), myRank, jump].map((element) => element.locator(".avatar img"))) {
    await expect(photo).toHaveCSS("border-radius", "50%");
    await expect(photo).toHaveCSS("object-fit", "cover");
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalHeight)).toBe(240);
    const size = await photo.boundingBox();
    expect(size!.width).toBeCloseTo(size!.height, 1);
  }
  await expect(top.nth(0)).not.toContainText("Profit");
  await top.nth(0).getByRole("button", { name: "View rank 1 details for Mika Reyes" }).click();
  const rankDetails = page.getByRole("dialog", { name: "Mika Reyes" });
  await expect(rankDetails.getByText("Profit ₱43,000")).toBeVisible();
  await rankDetails.getByRole("button", { name: "Close", exact: true }).click();
  await expect(rankDetails).toBeHidden();

  await jump.click();
  await expect(myRank).toBeFocused();
  await expect(myRank).toBeInViewport();

  await page.getByRole("combobox", { name: "Date range" }).selectOption("week");
  await expect(page.getByRole("heading", { name: "No rankings yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Jump to your rank/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to shifts" }).click();
  await expect(page.getByRole("button", { name: "Leaderboard", exact: true })).toBeFocused();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});

test("Blue Halo displays quotas and shifts for team members", async ({ page }) => {
  await seedTill(page, true, false, { rankedAs: "member" });
  await page.getByRole("button", { name: "Shifts", exact: true }).click();
  await page.getByRole("button", { name: "Leaderboard", exact: true }).click();

  const podium = page.getByRole("list", { name: "Top ranks" });
  await expect(podium).toHaveAccessibleDescription("Ranked by quotas hit, then shifts worked");
  await expect(podium.getByText("1 quota hit", { exact: true })).toHaveCount(3);
  await expect(page.getByRole("main")).not.toContainText(/₱|Profit|Loss/);
});

test("The Shifts header keeps Add when selecting a day with no shifts", async ({ page }) => {
  await seedTill(page, true);
  await page.getByRole("button", { name: "Shifts", exact: true }).click();
  const header = page.locator(".page-top").filter({ has: page.getByRole("heading", { name: "Shifts", exact: true }) });
  const add = header.getByRole("button", { name: "Add", exact: true });
  await expect(add).toBeInViewport();
  await page.getByRole("button", { name: "Sunday, November 22", exact: true }).click();
  await expect(page.getByText("Nothing scheduled", { exact: true })).toBeVisible();
  await expect(add).toBeInViewport();
  await add.click();
  await page.getByRole("menuitem", { name: "Add a shift", exact: true }).click();
  const single = page.getByRole("dialog", { name: "New shift", exact: true });
  await expect(single.getByLabel("Date", { exact: true })).toHaveValue("2026-11-22");
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

test("Back from Sales restores the item sheet, then each underlying shift view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 620 });
  await seedTill(page, true, true);
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: /^Past shifts/ }).click();
  const past = page.getByRole("dialog", { name: "Past shifts" });
  await past.getByRole("button", { name: /Closed market/ }).click();
  const details = page.getByRole("dialog", { name: "Closed market", exact: true });
  const seller = details.getByRole("button", { name: /Espresso.*1 sold/ });
  await seller.scrollIntoViewIfNeeded();
  const body = details.locator(".sheet-body").first();
  const scroll = await body.evaluate((node) => node.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  await details.getByRole("button", { name: "Edit", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit shift", exact: true });
  await edit.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBe(scroll);
  await seller.click();
  const item = page.getByRole("dialog", { name: "Espresso", exact: true });
  await item.getByRole("button", { name: "See in Sales" }).click();
  await expect(page.getByRole("button", { name: /Remove item Espresso/ })).toBeVisible();
  await page.getByRole("button", { name: "Back to till" }).click();
  await expect(item).toBeFocused();
  await item.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBe(scroll);
  await details.getByRole("button", { name: "Close", exact: true }).click();
  await expect(past).toBeVisible();
  await past.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to selling" })).toBeVisible();
});

test("Change from till opening restores the same spot in the shift list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await seedTill(page, true, false, { opening: true });
  await page.getByRole("button", { name: "Till", exact: true }).click();
  const shift = page.getByRole("button", { name: /Atrium/ });
  await shift.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 40));
  const scroll = await page.evaluate(() => window.scrollY);
  expect(scroll).toBeGreaterThan(0);
  await shift.click();
  await expect(page.getByRole("heading", { name: "Open till" })).toBeVisible();
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await expect(shift).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
});
