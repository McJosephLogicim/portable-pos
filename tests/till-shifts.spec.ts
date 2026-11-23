import { expect, test, type Locator, type Page } from "@playwright/test";
import { demoBootstrap } from "../src/lib/demo";
import { makeSale } from "../src/lib/domain";
import type { Booking, RegisterState } from "../src/lib/types";

test.use({ viewport: { width: 390, height: 844 } });

type StaffAccess = "member" | "co-owner" | "owner";

async function seedTill(
  page: Page,
  withShifts: boolean,
  withPastSale: boolean | "unscheduled" = false,
  { opening = false, rankedAs, withExpenses = false, staffAs, linked = false }: { opening?: boolean; rankedAs?: "owner" | "member"; withExpenses?: boolean; staffAs?: StaffAccess; linked?: boolean } = {},
) {
  await page.clock.setFixedTime(new Date("2026-11-21T04:00:00Z"));
  await page.goto(process.env.POS_TEST_APP_URL ?? "http://localhost:3000");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page.getByRole("button", { name: "Account and settings" })).toBeVisible();
  const demo = demoBootstrap("test-device");
  const espresso = demo.menu.find((item) => item.name === "Espresso")!;
  const sales = withPastSale ? [makeSale({
    id: "past-sale", shift: { ...demo.shift!, id: withPastSale === "unscheduled" ? "unscheduled" : "past" }, sequence: 1, soldOut: [],
    tender: "cash", received: espresso.price, createdAt: "2026-11-21T01:30:00Z",
    cart: [{ productId: espresso.id, quantity: 1, optionIds: [] }],
  })] : [];
  await page.evaluate(async ({ withShifts, sales, opening, rankedAs, withExpenses, staffAs, linked }) => {
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
          const shift = { ...state.shift!, number: 3, bookingId: linked ? "booking-1" : undefined };
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
          if ((!staffAs || opening) && state.me)
            first.staff = [{ memberId: state.me.memberId, name: state.me.name, role: "cashier" }];
          if (linked) second.staff = first.staff;
          if (staffAs) {
            const person = state.team!.find((person) => person.id === state.me!.memberId)!;
            state.me!.owner = person.owner = staffAs !== "member";
            person.primaryOwner = staffAs === "owner";
            second.staff = [{ memberId: "demo-bea", name: "Bea Santos", role: "cashier" }];
            closed.endsAt = "2026-11-21T06:00:00Z";
          }
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
            second.staff = first.staff;
            future.staff = first.staff;
            state.business!.settings.checklist = [];
            state.business!.settings.stockItems!.find((i) => i.id === "milk")!.onHand = 5;
            state.menu.find((item) => item.name === "Espresso")!.stock = true;
          }
          state.sales = sales;
          if (withExpenses) {
            const entry = { shiftId: past.id, createdAt: past.openedAt, source: "till" as const };
            state.expenses = [
              { ...entry, id: "ice", label: "Ice packs", amount: 2000 },
              { ...entry, id: "fare", label: "Delivery fare", amount: 3000, source: "pocket", by: "Ana" },
              { ...entry, id: "void", label: "Wrong expense", amount: 4000, voidedAt: past.openedAt },
              { ...entry, shiftId: shift.id, id: "other", label: "Other shift expense", amount: 5000 },
            ];
          }
          store.put(state, "demo-register-v2");
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  }, { withShifts, sales, opening, rankedAs, withExpenses, staffAs, linked });
  await page.reload();
}

for (const staffAs of ["member", "co-owner", "owner"] as const) {
  test(`claim an open shift seat as ${staffAs}`, async ({ page }) => {
    await seedTill(page, true, false, { staffAs });
    await page.getByRole("button", { name: "Shifts", exact: true }).click();
    await page.getByRole("button", { name: /Atrium/ }).click();
    const details = page.getByRole("dialog", { name: "Atrium • Nov 21 • Shift 1", exact: true });
    await details.getByRole("button", { name: "Join shift", exact: true }).click();
    const role = page.getByRole("dialog", { name: "Join shift", exact: true });
    await role.getByRole("button", { name: "Cashier", exact: true }).click();
    await role.getByRole("button", { name: "Join as server", exact: true }).click();
    await expect(details.getByText("Ana Cruz (you)")).toBeVisible();
    await expect(details.getByText(/^Server(?: · |$)/)).toBeVisible();
    await expect(details.getByRole("button", { name: "Join shift", exact: true })).toHaveCount(0);
    await details.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: /Garden/ }).click();
    const full = page.getByRole("dialog", { name: "Garden • Nov 21 • Shift 1", exact: true });
    await expect(full.getByRole("button", { name: "Join shift", exact: true })).toHaveCount(0);
    await full.getByRole("button", { name: "Close", exact: true }).click();

    await page.getByRole("button", { name: /Closed market/ }).click();
    const ended = page.getByRole("dialog", { name: "Closed market • Nov 21 • Shift 1", exact: true });
    await expect(ended.getByRole("button", { name: "Join shift", exact: true })).toHaveCount(0);
  });
}

test("Starting a shift is the only primary action when a member can also change roles", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await seedTill(page, true, false, { staffAs: "member", opening: true });
  await page.getByRole("button", { name: "Shifts", exact: true }).click();
  await page.getByRole("button", { name: /Atrium/ }).click();
  const details = page.getByRole("dialog", { name: /^Atrium/ });
  const primary = details.locator("button.btn:not(.secondary, .ghost, .destructive)");
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveText("Start shift");
  await expect(details.getByRole("button", { name: "Change role" })).toHaveClass(/\bsecondary\b/);
  await expect(details.getByRole("button", { name: "Leave", exact: true })).toHaveClass(/\bghost\b/);
  const footerButtons = details.locator(".sheet-foot").getByRole("button");
  await expect(footerButtons).toHaveText(["Start shift", "Change role", "Leave"]);
  const footerRows = await footerButtons.evaluateAll((buttons) =>
    new Set(buttons.map((button) => button.getBoundingClientRect().top)).size,
  );
  expect(footerRows).toBe(3);
  await page.setViewportSize({ width: 768, height: 844 });
  await expect.poll(() => footerButtons.evaluateAll((buttons) => {
    const positions = buttons.map((button) => button.getBoundingClientRect());
    const [primary, secondary, tertiary] = positions;
    return primary.top === secondary.top && secondary.top === tertiary.top &&
      primary.left < secondary.left && secondary.left < tertiary.left;
  })).toBe(true);
  await page.setViewportSize({ width: 320, height: 780 });

  const actions = details.getByRole("group", { name: "Shift actions" });
  const share = actions.getByRole("button", { name: "Share", exact: true });
  const report = actions.getByRole("button", { name: "Report", exact: true });
  for (const button of [share, report]) {
    await expect(button).toHaveClass(/\bbtn\b.*\bsecondary\b/);
    await expect(button).not.toHaveClass(/\blist-row\b/);
  }
  await share.click();
  const shareSheet = page.getByRole("dialog", { name: "Share this shift" });
  await expect(shareSheet.locator("button.btn:not(.secondary)")).toHaveText("Copy");
  await shareSheet.getByRole("button", { name: "Close", exact: true }).click();
  await report.click();
  const reportSheet = page.getByRole("dialog", { name: /^Atrium.*report$/ });
  await expect(reportSheet.getByText("No till report is available for this shift.")).toBeVisible();
});

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
  const pickPayer = async (form: Locator) => {
    await form.getByRole("button", { name: "From team", exact: true }).click();
    const teammates = form.getByRole("combobox", { name: "Teammate", exact: true });
    await expect(teammates).toHaveClass("filter-select-input");
    await expect(teammates.locator("option").filter({ hasText: "Ana Cruz · Owner" })).toHaveCount(1);
    await expect(teammates.locator("option").filter({ hasText: "Kim Dela Cruz" })).toHaveCount(0);
    await teammates.selectOption({ label: "Bea Santos · Member" });
  };
  const logExpense = async (label: string, amount: string, source: "cash" | "gcash" | "team", within: Page | Locator = page) => {
    const add = within.getByRole("region", { name: "Expenses" }).getByRole("button", { name: "Add", exact: true });
    await expect(add).toHaveAttribute("aria-haspopup", "dialog");
    await add.click();
    const form = page.getByRole("dialog", { name: "Log an expense" });
    await expect(form.getByRole("button", { name: "Remove expense" })).toHaveCount(0);
    await form.getByRole("combobox", { name: "What for" }).fill(label);
    await form.getByRole("textbox", { name: "Amount" }).fill(amount);
    if (source === "team") await pickPayer(form);
    else if (source === "gcash") {
      await form.getByRole("combobox", { name: "Payment method", exact: true }).selectOption({ label: "GCash" });
    }
    await form.getByRole("button", { name: /^Log ₱/ }).click();
    await expect(form).toBeHidden();
  };
  const removeExpense = async (label: string, within: Page | Locator = page) => {
    const list = within.getByRole("region", { name: "Expenses" });
    const row = list.getByRole("button").filter({ hasText: label });
    await expect(list.getByRole("button", { name: /Remove/ })).toHaveCount(0);
    await row.click();
    const editor = page.getByRole("dialog", { name: "Edit expense" });
    const remove = editor.getByRole("button", { name: "Remove expense" });
    const confirm = page.getByRole("dialog", { name: "Remove expense?" });
    await remove.click();
    await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor).toBeVisible();
    await remove.click();
    await confirm.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(confirm).toBeHidden();
    await expect(row).toHaveCount(0);
  };
  await reviewStock("Opening stock");
  await expect(page.getByRole("region", { name: "Expenses" })).toHaveCount(0);
  await page.getByRole("button", { name: "Type the total" }).click();
  await page.getByRole("textbox", { name: "Starting cash" }).fill("100");
  await page.getByRole("button", { name: "Open till", exact: true }).click();
  await expect(page.getByRole("button", { name: /Selling for Atrium/ })).toBeVisible();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await logExpense("Till supplies", "20", "cash");
  await page.getByRole("button", { name: /^Till supplies/ }).click();
  const edit = page.getByRole("dialog", { name: "Edit expense" });
  await expect(edit.getByRole("combobox", { name: "What for" })).toHaveValue("Till supplies");
  await expect(edit.getByRole("textbox", { name: "Amount" })).toHaveValue("20.00");
  await expect(edit.getByRole("button", { name: "From till" })).toHaveAttribute("aria-pressed", "true");
  await expect(edit.getByRole("combobox", { name: "Payment method" })).toHaveValue("cash");
  await edit.getByRole("combobox", { name: "What for" }).fill("Ice packs");
  await edit.getByRole("textbox", { name: "Amount" }).fill("25.50");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Ice packs.*25\.50/ })).toBeVisible();

  await page.getByRole("button", { name: /^Selling for Atrium/ }).click();
  const activeShift = page.getByRole("dialog", { name: "Atrium • Nov 21 • Shift 1", exact: true });
  await activeShift.getByRole("button", { name: /Expenses.*25\.50/ }).click();
  const shiftExpenses = page.getByRole("dialog", { name: "Expenses", exact: true });
  await shiftExpenses.getByRole("button", { name: /^Ice packs/ }).click();
  await expect(edit.getByRole("textbox", { name: "Amount" })).toHaveValue("25.50");
  await expect(edit.getByRole("button", { name: "Remove expense" })).toBeVisible();
  await edit.getByRole("button", { name: "Close", exact: true }).click();
  await shiftExpenses.getByRole("button", { name: "Close", exact: true }).click();
  await activeShift.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Count drawer and close" }).click();
  const closing = page.getByRole("dialog", { name: /^Close shift/ });
  const drawer = closing.locator(".tile").filter({ hasText: "Expected in the drawer" });
  await expect(drawer.getByText("₱74.50", { exact: true })).toBeVisible();
  await reviewStock("Closing stock");
  await logExpense("Closing fare", "30", "team", closing);
  await expect(drawer.getByText("₱74.50", { exact: true })).toBeVisible();
  await logExpense("Supplier transfer", "15", "gcash", closing);
  await expect(drawer.getByText("₱74.50", { exact: true })).toBeVisible();
  await logExpense("Closing supplies", "10", "cash", closing);
  await expect(drawer.getByText("₱64.50", { exact: true })).toBeVisible();
  await closing.getByRole("button", { name: /^Ice packs/ }).click();
  await pickPayer(edit);
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
  await expect(report.locator("pre")).toContainText("from till · GCash");
  await expect(report.locator("pre")).toContainText("Pay back Bea Santos ₱25.50");
  await expect(report.locator("pre")).not.toContainText("Closing fare");
});

test("Delete shakes and shows an error for an open till on both Shifts and Till", async ({ page }) => {
  await seedTill(page, true, false, { linked: true });
  const reason = "Close the till before deleting this shift.";
  const details = page.getByRole("dialog", { name: /^Atrium/ });
  const remove = details.getByRole("button", { name: "Delete", exact: true });
  const toast = page.locator(".toast:not(.exit-ghost)");

  for (const tab of ["Till", "Shifts"] as const) {
    const nav = page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: tab, exact: true });
    await nav.press("Enter");
    await expect(nav).toHaveAttribute("aria-current", "page");
    const entry = tab === "Till" ? page.getByRole("button", { name: /^Selling for Atrium/ })
      : page.getByRole("article").filter({ hasText: "Atrium" }).getByRole("button");
    await entry.click();
    await expect(remove).toHaveClass(/\bbtn\b.*\bdanger-text\b/);
    await expect(remove).toHaveAttribute("aria-disabled", "true");
    const feedback = await remove.evaluate((button: HTMLButtonElement) => {
      button.click();
      const frames = button.getAnimations().flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes());
      return {
        tint: frames.some((frame) => "backgroundColor" in frame),
        shake: frames.some((frame) => frame.transform === "translateX(-5px)"),
      };
    });
    expect(feedback).toEqual({ tint: true, shake: true });
    await expect(toast).toContainText(reason);
    await expect(page.getByRole("dialog", { name: "Delete shift?" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Owner PIN" })).toHaveCount(0);
    await details.getByRole("button", { name: "Close", exact: true }).click();
  }
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Selling for Atrium/ })).toBeVisible();
});

test("Today and the Till picker reuse shift details and link only after confirmation", async ({ page }) => {
  await seedTill(page, true, true);
  await page.getByRole("button", { name: "Shifts", exact: true }).click();
  const headerActions = page.getByRole("button", { name: /^(Add|Share the schedule|Leaderboard)$/ });
  await expect(headerActions.nth(0)).toHaveAccessibleName("Add");
  await expect(headerActions.nth(1)).toHaveAccessibleName("Share the schedule");
  await expect(headerActions.nth(2)).toHaveAccessibleName("Leaderboard");
  const today = page.getByRole("article").filter({ hasText: "Atrium" });
  await expect(today.getByRole("button")).toHaveCount(1);
  const todayCard = await today.innerText();
  const details = page.getByRole("dialog", { name: "Atrium • Nov 21 • Shift 1", exact: true });
  await today.getByRole("button", { name: /Atrium/ }).click();
  const actions = details.getByRole("group", { name: "Shift actions" }).getByRole("button");
  await expect(actions).toHaveText(["Report", "Share", "Delete"]);
  const actionRows = () =>
    actions.evaluateAll((buttons) => new Set(buttons.map((button) => button.getBoundingClientRect().top)).size);
  await expect.poll(actionRows).toBe(3);
  await page.setViewportSize({ width: 768, height: 844 });
  await expect.poll(actionRows).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });

  const peopleRow = details.getByRole("button", { name: /Ana Cruz.*Cashier/ });
  const addPerson = details.getByRole("button", { name: "Add someone", exact: true });
  await expect(peopleRow).toHaveCSS("box-shadow", "none");
  await expect(addPerson).toHaveClass("list-row");
  await expect(addPerson).toHaveText("Add");
  await expect(peopleRow.locator("..").getByRole("button", { name: "Add someone" })).toHaveCount(1);
  await actions.getByText("Share", { exact: true }).click();
  const share = page.getByRole("dialog", { name: "Share this shift" });
  await expect(share.getByText(/View shift:/)).toBeVisible();
  await expect(share.locator("pre")).toHaveText(/POP POS$/);
  await share.getByRole("button", { name: "Close", exact: true }).click();
  await details.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete shift?" }).getByRole("button", { name: "Cancel" }).click();
  await details.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Till", exact: true }).click();
  await expect(page.getByRole("button", { name: "Count drawer and close" })).toBeDisabled();
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
  await expect(actions).toHaveText(["Report", "Share", "Delete"]);
  await details.getByRole("button", { name: "Report", exact: true }).click();
  const emptyReport = page.getByRole("dialog", { name: "Atrium • Nov 21 • Shift 1 report", exact: true });
  await expect(emptyReport.getByText("No till report is available for this shift.")).toBeVisible();
  await emptyReport.getByRole("button", { name: "Close", exact: true }).click();

  await details.getByRole("button", { name: "Add till", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Add till to this shift?" });
  await expect(confirmation.getByText("Atrium • Nov 21 • Shift 1", { exact: true })).toBeVisible();
  await expect(confirmation.locator(".sheet-foot").getByRole("button")).toHaveText(["Add till", "Cancel"]);
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
  const activeShift = page.getByRole("button", { name: "Remove shift Atrium • Nov 21 • Shift 1", exact: true });
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
  await expect(page.getByRole("dialog", { name: "Atrium • Nov 21 • Shift 1 report" })).toBeVisible();
});

test("Past shift cards open details for both scheduled and unscheduled tills", async ({ page }) => {
  await seedTill(page, true, "unscheduled");
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: /Past shifts/ }).click();
  const past = page.getByRole("dialog", { name: "Past shifts" });
  await expect(past.getByRole("article")).toHaveCount(2);
  await past.getByRole("button", { name: /Closed market/ }).click();
  const scheduled = page.getByRole("dialog", { name: "Closed market • Nov 21 • Shift 1", exact: true });
  await expect(scheduled.getByRole("group", { name: "Shift actions" }).getByRole("button")).toHaveText(["Report", "Share", "Delete"]);
  await scheduled.getByRole("button", { name: "Report", exact: true }).click();
  const report = page.getByRole("dialog", { name: "Closed market • Nov 21 • Shift 1 report" });
  await expect(report.getByRole("img", { name: "Closed market • Nov 21 • Shift 1 report" })).toBeVisible();
  const reportButtons = report.locator(".sheet-foot").getByRole("button");
  await expect(reportButtons).toHaveText([/^(Share|Save)$/, "Copy"]);
  const copy = report.getByRole("button", { name: "Copy", exact: true });
  await expect(copy).toHaveClass(/\bsecondary\b/);
  await report.getByText("Show as text", { exact: true }).click();
  await expect(report.locator("pre")).toHaveText(/POP POS$/);
  await report.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = (callback) => callback(null);
  });
  await scheduled.getByRole("button", { name: "Report", exact: true }).click();
  const unavailable = report.getByRole("button", { name: "Image unavailable", exact: true });
  await expect(unavailable).toBeDisabled();
  await expect(unavailable).toHaveClass(/\bsecondary\b/);
  await expect(copy).not.toHaveClass(/\bsecondary\b/);
  await expect(reportButtons).toHaveText(["Copy", "Image unavailable"]);
  await report.getByRole("button", { name: "Close", exact: true }).click();
  await scheduled.getByRole("button", { name: "Close", exact: true }).click();
  await past.getByRole("button", { name: /Sunday Supply • Nov 20 • 11:00 AM/ }).click();
  const unscheduled = page.getByRole("dialog", { name: "Sunday Supply • Nov 20 • 11:00 AM", exact: true });
  await unscheduled.getByRole("button", { name: "All 1 sale" }).click();
  const sales = page.getByRole("dialog", { name: "Sales", exact: true });
  await expect(sales.getByText("Espresso", { exact: true })).toBeVisible();
  await sales.getByRole("button", { name: "Close", exact: true }).click();
  await expect(unscheduled.getByRole("group", { name: "Shift actions" }).getByRole("button")).toHaveText(["Report", "Share"]);
  await unscheduled.getByRole("button", { name: "Report", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Sunday Supply • Nov 20 • 11:00 AM report" })).toBeVisible();
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
    await expect(photo.locator("..")).toHaveCSS("mask-image", /svg/);
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
  const details = page.getByRole("dialog", { name: "Closed market • Nov 21 • Shift 1", exact: true });
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

test("Shift profitability opens the sales and expenses behind its totals", async ({ page }) => {
  await seedTill(page, true, true, { withExpenses: true });
  await page.getByRole("button", { name: "Till", exact: true }).click();
  await page.getByRole("button", { name: /^Past shifts/ }).click();
  await page.getByRole("dialog", { name: "Past shifts" }).getByRole("button", { name: /Closed market/ }).click();
  const shift = page.getByRole("dialog", { name: "Closed market" });
  const espresso = demoBootstrap("test-device").menu.find((item) => item.name === "Espresso")!;
  const php = (amount: number) => "₱" + (amount / 100);
  await expect(shift.locator(".list-row").filter({ hasText: /^(Profit|Loss)/ })).toContainText(php(Math.abs(espresso.price - 5000)));

  const salesRow = shift.getByRole("button", { name: /^Sales ₱/ });
  await expect(salesRow).toHaveCSS("box-shadow", "none");
  await salesRow.click();
  const sales = page.getByRole("dialog", { name: "Sales", exact: true });
  await expect(sales.getByText("Espresso", { exact: true })).toBeVisible();
  await expect(sales.getByText(php(espresso.price), { exact: true })).toHaveCount(2);
  await sales.getByRole("button", { name: "Close", exact: true }).click();

  await shift.getByRole("button", { name: "All 1 sale" }).click();
  await expect(sales.getByText("Espresso", { exact: true })).toBeVisible();
  await expect(sales.getByText(php(espresso.price), { exact: true })).toHaveCount(2);
  await sales.getByRole("button", { name: "Close", exact: true }).click();

  const expensesRow = shift.getByRole("button", { name: /Expenses.*₱50/ });
  await expect(expensesRow).toHaveCSS("box-shadow", "none");
  await expensesRow.click();
  const expenses = page.getByRole("dialog", { name: "Expenses", exact: true });
  await expect(expenses.getByText("Ice packs")).toBeVisible();
  await expect(expenses.getByText("Delivery fare")).toBeVisible();
  await expect(expenses.getByText(/Wrong expense|Other shift expense/)).toHaveCount(0);
  await expenses.getByRole("button", { name: "Close", exact: true }).click();
  await expect(shift).toBeVisible();
});
