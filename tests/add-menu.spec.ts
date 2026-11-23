import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });

async function startDemo(page: Page) {
  await page.goto(process.env.POS_TEST_APP_URL ?? "http://localhost:3000");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await page.getByRole("button", { name: "Account and settings" }).click();
}

async function confirmPin(page: Page) {
  const pin = page.getByRole("dialog", { name: "Owner PIN" });
  for (const digit of "1234") await pin.getByRole("button", { name: digit, exact: true }).click();
  await pin.getByRole("button", { name: "Confirm" }).click();
}

async function summaryAdd(page: Page) {
  const add = page.getByRole("button", { name: "Add", exact: true });
  await expect(add).toHaveCount(1);
  const row = page.locator(".page > .between").filter({ has: add });
  await expect(row.locator(".headline")).toBeVisible();
  const summary = (await row.locator(".headline").boundingBox())!;
  const button = (await add.boundingBox())!;
  expect(button.x).toBeGreaterThan(summary.x + summary.width);
  expect(Math.abs(button.y + button.height / 2 - (summary.y + summary.height / 2))).toBeLessThan(1);
  return add;
}

test("Sell explains why Add is blocked while offline", async ({ page, context }) => {
  await startDemo(page);
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  const add = page.getByRole("button", { name: "Add an item to the menu", exact: true });
  await expect(page.locator(".sell-head").getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await context.setOffline(true);
  await expect(add).toHaveAttribute("aria-disabled", "true");
  await add.click({ force: true });
  await expect(page.locator(".toast:not(.exit-ghost)")).toContainText("Connect to the internet to add items.");
  await expect(page.getByRole("menuitem")).toHaveCount(0);
});

test("Bulk menu items share one choice editor and go live on Sell", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("button", { name: /^Recipes/ }).click();
  await page.getByRole("button", { name: /^Menu items/ }).click();

  const add = await summaryAdd(page);
  await add.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem")).toHaveText(["Add an item", "Add bulk"]);
  await page.keyboard.press("Enter");
  const single = page.getByRole("dialog", { name: "New item" });
  await expect(single).toBeVisible();
  await expect(single.getByRole("button", { name: "Pick one", exact: true })).toBeVisible();
  await expect(single.getByRole("button", { name: "Add-ons", exact: true })).toBeVisible();
  await single.getByRole("button", { name: "Close" }).click();

  await add.click();
  await page.getByRole("menuitem", { name: "Add bulk" }).click();
  const bulk = page.getByRole("dialog", { name: "Add menu items in bulk" });
  await bulk.getByRole("textbox", { name: "Item 1 name", exact: true }).fill("Ginger soda");
  await bulk.getByRole("textbox", { name: "Item 1 price", exact: true }).fill("80");
  await bulk.getByRole("textbox", { name: "Item 2 name", exact: true }).fill("Yuzu soda");
  await bulk.getByRole("textbox", { name: "Item 2 price", exact: true }).fill("95");

  const choices = bulk.getByRole("region", { name: "Choices for all items", exact: true });
  await expect(choices).toHaveCount(1);
  await expect(bulk.locator(".card:has(.quick-row) + section")).toHaveAttribute("aria-label", "Choices for all items");
  await choices.getByRole("button", { name: "Pick one", exact: true }).click();
  await choices.getByRole("combobox", { name: "Choice name", exact: true }).click();
  await choices.getByRole("option", { name: /^Milk/ }).click();
  await expect(choices.getByRole("combobox", { name: "Option 2 name" })).toHaveValue("Oat milk");
  await expect(choices.getByRole("textbox", { name: "Option 2 extra price" })).toHaveValue("30");

  await choices.getByRole("button", { name: "Add-ons", exact: true }).click();
  await bulk.getByRole("button", { name: "Add 2 items" }).click();
  await expect(bulk.getByRole("alert")).toContainText("Name each choice");
  await choices.getByRole("combobox", { name: "Choice name", exact: true }).nth(1).fill("Toppings");
  await choices.getByRole("combobox", { name: "Option 1 name", exact: true }).nth(1).fill("Candied ginger");
  await choices.getByRole("textbox", { name: "Option 1 extra price", exact: true }).nth(1).fill("15");
  await bulk.getByRole("button", { name: "Add 2 items" }).click();
  await confirmPin(page);
  await expect(bulk).toBeHidden();
  await expect(page.getByRole("button", { name: /^Ginger soda/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Yuzu soda/ })).toBeVisible();

  await page.getByRole("button", { name: "Back to recipes", exact: true }).click();
  await page.getByRole("button", { name: /^Choices/ }).click();
  const types = page.getByRole("group", { name: "Choice types", exact: true });
  const milk = page.getByRole("button", { name: /^Milk Whole milk/ });
  const toppings = page.getByRole("button", { name: /^Toppings Candied ginger/ });
  await types.getByRole("button", { name: "Pick one", exact: true }).click();
  await expect(milk).toBeVisible();
  await expect(toppings).toBeHidden();
  await types.getByRole("button", { name: "Add-ons", exact: true }).click();
  await expect(toppings).toBeVisible();
  await expect(milk).toBeHidden();
  await types.getByRole("button", { name: "All", exact: true }).click();
  await expect(milk).toBeVisible();
  await expect(toppings).toBeVisible();

  await page.getByRole("button", { name: "Sell", exact: true }).click();
  for (const [name, total] of [["Ginger soda", 125], ["Yuzu soda", 140]] as const) {
    await page.getByRole("button", { name: new RegExp(`^Add ${name}`) }).click();
    const orderOptions = page.getByRole("dialog", { name, exact: true });
    await expect(orderOptions.getByRole("radio", { name: "Whole milk" })).toBeChecked();
    await orderOptions.getByText("Oat milk", { exact: true }).click();
    await orderOptions.getByRole("button", { name: /^Candied ginger/ }).click();
    await expect(orderOptions.getByRole("button", { name: `Add ₱${total}`, exact: true })).toBeEnabled();
    await orderOptions.getByRole("button", { name: "Close", exact: true }).click();
  }

  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.locator(".sell-head").getByRole("button", { name: "Add", exact: true })).toHaveCount(0);
  await page.locator(".items").getByRole("button", { name: "Add an item to the menu", exact: true }).click();
  await expect(single).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveCount(0);
  await single.getByRole("textbox", { name: "Name", exact: true }).fill("Honey latte");
  await single.getByRole("textbox", { name: "Price", exact: true }).fill("150");
  await single.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(single).toBeHidden();
  await expect(page.getByRole("button", { name: /^Add Honey latte/ })).toBeVisible();
});

test("Stock Lists shows each empty group only on its own tab", async ({ page }) => {
  await startDemo(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("portable-pos-register", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("registers", "readwrite");
        const store = tx.objectStore("registers");
        const get = store.get("demo-register-v2");
        get.onsuccess = () => {
          const state = get.result;
          state.business.settings.stockLists = { category: [], kind: [], supplier: [] };
          store.put(state, "demo-register-v2");
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("button", { name: /^Recipes/ }).click();
  await page.getByRole("button", { name: /^Stock lists/ }).click();
  const tabs = page.getByRole("group", { name: "Stock lists", exact: true });
  await expect(tabs.getByRole("button")).toHaveText(["All", "Prep categories", "Stock types", "Suppliers"]);
  await expect(page.getByRole("button", { name: /Filter by list or usage/ })).toHaveCount(0);
  const empty = page.locator(".empty.card");
  await expect(empty).toHaveCount(1);
  await expect(empty).toContainText("No stock list entries yet");
  await expect(empty.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  for (const [label, noun, field] of [
    ["Prep categories", "prep category", "category"],
    ["Stock types", "stock type", "kind"],
    ["Suppliers", "supplier", "supplier"],
  ]) {
    const card = page.locator(".empty.card").filter({ hasText: `No ${label.toLowerCase()} yet` });
    await expect(card).toHaveCount(0);
    await tabs.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(1);
    await card.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByRole("menuitem")).toHaveText([`Add a ${noun}`, "Add bulk"]);
    await page.getByRole("menuitem", { name: `Add a ${noun}`, exact: true }).click();
    const single = page.getByRole("dialog", { name: "New list entry", exact: true });
    await expect(single.getByRole("combobox", { name: "List" })).toHaveValue(field);
    await single.getByRole("button", { name: "Close", exact: true }).click();
    await tabs.getByRole("button", { name: "All", exact: true }).click();
  }
  await tabs.getByRole("button", { name: "Suppliers", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add bulk" }).click();
  const bulk = page.getByRole("dialog", { name: "Add list entries in bulk" });
  await expect(bulk.getByRole("combobox", { name: "List" })).toHaveValue("supplier");
  await bulk.getByRole("textbox", { name: "Names, one per line" }).fill("Local mill\nLocal orchard");
  await bulk.getByRole("button", { name: "Add 2 list entries" }).click();
  await confirmPin(page);
  await expect(bulk).toBeHidden();
  await expect(page.getByRole("button", { name: /^Local mill/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Local orchard/ })).toBeVisible();
  await tabs.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Local mill/ })).toBeVisible();
  await expect(empty).toHaveCount(0);
  await tabs.getByRole("button", { name: "Stock types", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Local mill/ })).toBeHidden();

  await tabs.getByRole("button", { name: "Prep categories", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add a prep category", exact: true }).click();
  const newCategory = page.getByRole("dialog", { name: "New list entry", exact: true });
  await newCategory.getByRole("textbox", { name: "Name", exact: true }).fill("Syrups");
  await newCategory.getByRole("button", { name: "Add prep category", exact: true }).click();
  await expect(newCategory).toBeHidden();
  await page.getByRole("button", { name: "Back to recipes", exact: true }).click();
  await page.getByRole("button", { name: /^Prep What you make/ }).click();
  await expect(page.locator(".empty.card")).toHaveText(/Nothing made ahead yet/);
  await page.getByRole("group", { name: "Prep categories", exact: true }).getByRole("button", { name: "Syrups", exact: true }).click();
  await expect(page.locator(".empty.card").filter({ hasText: "No prep items in Syrups" }).getByRole("button", { name: "Add", exact: true })).toBeVisible();
});

test("Stock Items adds directly to the selected stock type", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("button", { name: /^Recipes/ }).click();
  await page.getByRole("button", { name: /^Stock items/ }).click();
  const types = page.getByRole("group", { name: "Stock types", exact: true });
  await expect(page.locator(".empty.card")).toHaveCount(0);
  await types.getByRole("button", { name: "Ingredient", exact: true }).click();
  const add = page.locator(".empty.card").filter({ hasText: "No stock items in Ingredient" }).getByRole("button", { name: "Add", exact: true });
  await add.click();
  await expect(page.getByRole("menuitem")).toHaveCount(0);
  const editor = page.getByRole("dialog", { name: "New stock item", exact: true });
  await editor.getByRole("textbox", { name: "Name", exact: true }).fill("Cacao nibs");
  await editor.getByRole("button", { name: "Add stock item", exact: true }).click();
  await confirmPin(page);
  await expect(editor).toBeHidden();
  await expect(page.getByRole("button", { name: /^Cacao nibs/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Fresh milk/ })).toBeHidden();
  await types.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Fresh milk/ })).toBeVisible();
});

test("Single-entry pages open their Add form directly and multiline editors keep bulk entry", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await startDemo(page);

  async function check(row: RegExp, title: string, back: string, singleLabel?: string, empty = false) {
    await page.getByRole("button", { name: row }).click();
    const add = empty
      ? page.locator(".empty.card").getByRole("button", { name: "Add", exact: true })
      : await summaryAdd(page);
    await add.click();
    if (singleLabel) {
      await expect(page.getByRole("menuitem")).toHaveText([singleLabel, "Add bulk"]);
      await page.getByRole("menuitem", { name: "Add bulk" }).click();
    } else {
      await expect(page.getByRole("menuitem")).toHaveCount(0);
    }
    const editor = page.getByRole("dialog", { name: title, exact: true });
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: back, exact: true }).click();
  }

  await check(/^Payment methods/, "New payment method", "Back to settings");
  await check(/^Discounts/, "New discount", "Back to settings");
  await check(/^Organizers/, "Add organizers in bulk", "Back to settings", "Add an organizer");
  await check(/^Opening checklist/, "Add steps in bulk", "Back to settings", "Add a step");
  await page.getByRole("button", { name: /^Recipes/ }).click();
  await check(/^Categories/, "New category", "Back to recipes");
  await check(/^Choices/, "New choice", "Back to recipes");
  await check(/^Prep What you make/, "New prep item", "Back to recipes", undefined, true);

  await page.getByRole("button", { name: /^Menu costing/ }).click();
  const categories = page.getByRole("group", { name: "Menu categories", exact: true });
  await categories.getByRole("button", { name: "Bakery", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Butter Croissant/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Espresso/ })).toBeHidden();
});

test("Choices opens a new optional choice from the empty Add-ons tab", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("button", { name: /^Recipes/ }).click();
  await page.getByRole("button", { name: /^Choices/ }).click();
  await expect(page.locator(".empty.card")).toHaveCount(0);
  await page.getByRole("group", { name: "Choice types" }).getByRole("button", { name: "Add-ons", exact: true }).click();
  const add = page.locator(".empty.card").filter({ hasText: "No add-ons yet" }).getByRole("button", { name: "Add", exact: true });
  await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(1);
  await add.click();
  await expect(page.getByRole("menuitem")).toHaveCount(0);
  const sheet = page.getByRole("dialog", { name: "New choice", exact: true });
  await expect(sheet.getByRole("button", { name: "Add-ons", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("Team keeps the pending-invites empty state in its own tab", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("button", { name: /^Team\b/ }).click();
  const tabs = page.getByRole("group", { name: "Team members", exact: true });
  const pending = tabs.getByRole("button", { name: "Yet to sign in", exact: true });
  await pending.click();
  await page.getByRole("button", { name: /^Kim Dela Cruz/ }).click();
  await page.getByRole("dialog", { name: "Kim Dela Cruz", exact: true }).getByRole("button", { name: "Revoke", exact: true }).click();
  await page.getByRole("dialog", { name: "Cancel invitation?", exact: true }).getByRole("button", { name: "Revoke", exact: true }).click();
  await confirmPin(page);

  const empty = page.locator(".empty.card").filter({ hasText: "No pending invites" });
  await expect(pending).toHaveAttribute("aria-pressed", "true");
  await expect(empty).toBeVisible();
  await tabs.getByRole("button", { name: "All", exact: true }).click();
  await expect(empty).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Bea Santos/ })).toBeVisible();

  await pending.click();
  await empty.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Invite someone", exact: true })).toBeVisible();
});

test("menu preview uses the Sell checkout and leaves the live order and sales alone", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  await page.getByRole("button", { name: /^Add Butter Croissant,/ }).click();
  const liveOrder = page.getByRole("button", { name: /^Charge .* for 1 item$/ });
  await expect(liveOrder).toBeVisible();

  await page.getByRole("button", { name: /^Recipes/ }).click();
  await page.getByRole("button", { name: /^Menu items/ }).click();
  await page.getByRole("button", { name: "See menu in action" }).click();
  await expect(page.getByRole("heading", { name: "Menu preview" })).toBeVisible();
  const testOrder = page.getByRole("button", { name: "Test checkout", exact: true });
  await expect(testOrder).toHaveCount(0);
  await page.getByRole("button", { name: /^Add Butter Croissant,/ }).click();
  await testOrder.click();
  await page.getByRole("dialog", { name: "Test checkout" }).getByRole("button", { name: "Exact", exact: true }).click();
  await page.getByRole("button", { name: "Slide to simulate sale", exact: true }).press("Space");
  const done = page.getByRole("dialog", { name: "Test sale complete" });
  await done.getByRole("button", { name: "View receipt" }).click();
  await page.getByRole("dialog", { name: "Test receipt" }).getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Back to menu items" }).click();
  await expect(page.getByRole("button", { name: "See menu in action" })).toBeVisible();
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  await expect(liveOrder).toBeVisible();
  await expect(page.getByRole("main").getByText(/Shift .* · 0 sales/)).toBeVisible();
});

test("recipe back buttons restore each source page and its filters", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 620 });
  await startDemo(page);
  await page.getByRole("button", { name: "Recipes", exact: true }).click();
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /^Menu costing/ }).click();
  const bakery = main.getByRole("group", { name: "Menu categories" }).getByRole("button", { name: "Bakery", exact: true });
  await bakery.click();
  await main.getByRole("button", { name: /^Pricing rules/ }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, 170));
  const costingScroll = await page.evaluate(() => window.scrollY);
  expect(costingScroll).toBeGreaterThan(0);
  await main.getByRole("button", { name: /^Pricing rules/ }).click();
  await expect(main.getByRole("heading", { name: "Pricing rules", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await main.getByRole("button", { name: "Back to menu costing" }).click();
  await expect(bakery).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(costingScroll);
  await main.getByRole("button", { name: "Back to recipes" }).click();
  await expect(main.getByRole("heading", { name: "Recipes", exact: true })).toBeVisible();

  await main.getByRole("button", { name: /^Stock items What you buy/ }).click();
  const search = main.getByRole("searchbox", { name: "Search stock items" });
  await search.fill("milk");
  await main.getByRole("button", { name: "Stock lists", exact: true }).click();
  await main.getByRole("button", { name: "Back to stock items", exact: true }).click();
  await expect(search).toHaveValue("milk");
  await main.getByRole("button", { name: "Back to recipes" }).click();
  await main.getByRole("button", { name: /^Menu items What you sell/ }).click();

  const menuSearch = main.getByRole("searchbox", { name: "Search items" });
  const coffee = main.getByRole("group", { name: "Categories" }).getByRole("button", { name: "Coffee", exact: true });
  await coffee.click();
  await menuSearch.fill("latte");
  await main.getByRole("button", { name: "See menu in action" }).click();
  await expect(main.getByRole("button", { name: /^Add Caffè Latte/ })).toBeVisible();
  await page.goBack();
  await expect(menuSearch).toHaveValue("latte");
  await expect(coffee).toHaveAttribute("aria-pressed", "true");
  await page.goForward();
  await main.getByRole("button", { name: "Back to menu items", exact: true }).click();
  await expect(menuSearch).toHaveValue("latte");
  await expect(coffee).toHaveAttribute("aria-pressed", "true");
});

test("the settings back button restores the page at the same scroll offset", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 620 });
  await startDemo(page);
  const organizers = page.getByRole("button", { name: /^Organizers/ });
  await organizers.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  expect(scroll).toBeGreaterThan(0);
  await organizers.click();
  await page.getByRole("button", { name: "Back to settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scroll);
});

test("checkout Back restores the payment step at the same scroll offset", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await startDemo(page);
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  await page.getByRole("button", { name: /^Add Butter Croissant/ }).click();
  await page.getByRole("button", { name: /^Charge .* for 1 item/ }).click();
  const charge = page.getByRole("dialog", { name: "Charge", exact: true });
  await charge.locator("summary").filter({ hasText: "Discount" }).click();
  await charge.getByRole("textbox", { name: "Other amount" }).fill("200");
  await page.keyboard.press("Tab");
  const next = charge.getByRole("button", { name: /^Next · change/ });
  const body = charge.locator(".sheet-body");
  await body.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  const scroll = await body.evaluate((node) => node.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  await next.click();
  const review = page.getByRole("dialog", { name: "Confirm sale", exact: true });
  await review.getByRole("button", { name: "Back", exact: true }).click();
  await expect(charge.getByRole("textbox", { name: "Other amount" })).toHaveValue("200");
  await expect(charge.getByRole("group", { name: "Discount", exact: true })).toBeVisible();
  await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBe(scroll);
  await next.click();
  await review.getByRole("button", { name: "Close", exact: true }).click();
  await expect(charge).toBeVisible();
});

test("the sale slider springs back after a short drag and saves on a full release", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  await page.getByRole("button", { name: /^Add Butter Croissant,/ }).click();
  await page.getByRole("button", { name: /^Charge .* for 1 item/ }).click();
  await page.getByRole("dialog", { name: "Charge", exact: true }).getByRole("button", { name: "Exact", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Confirm sale", exact: true });
  const thumb = review.getByRole("button", { name: "Slide to confirm sale", exact: true });
  await review.getByRole("button", { name: "Checkout sounds" }).click();
  await thumb.click();
  await expect(review).toBeVisible();

  const lane = thumb.locator("..");
  const fill = lane.locator(":scope > span[aria-hidden=true]").first();
  const thumbGradient = await thumb.evaluate((node) => getComputedStyle(node).backgroundImage);
  await expect(fill).toHaveCSS("background-image", thumbGradient);
  const bounds = (await thumb.boundingBox())!;
  const track = (await lane.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const travel = track.width - bounds.width;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + travel * 0.55, y, { steps: 8 });
  await expect.poll(async () => (await thumb.boundingBox())!.x).toBeGreaterThan(bounds.x + travel / 2);
  await page.mouse.up();
  await expect.poll(async () => (await thumb.boundingBox())!.x).toBeCloseTo(bounds.x);
  await expect(review).toBeVisible();

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + travel, y, { steps: 10 });
  await expect(review.getByRole("status")).toBeEmpty();
  await page.mouse.up();
  const done = page.getByRole("dialog", { name: "Sale complete", exact: true });
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: "New sale" }).click();
  await expect(page.getByText(/Shift .* · 1 sale$/)).toBeVisible();
});

test("all menu category entry points save zero-item categories", async ({ page }) => {
  await startDemo(page);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("portable-pos-register", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("registers", "readwrite");
        const store = tx.objectStore("registers");
        const get = store.get("demo-register-v2");
        get.onsuccess = () => store.put({ ...get.result, menu: [], shift: null, shifts: [], sales: [], pending: [] }, "demo-register-v2");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  const recipes = page.getByRole("button", { name: "Recipes", exact: true });
  const back = page.getByRole("button", { name: "Back to recipes", exact: true });
  const category = page.getByRole("dialog", { name: "New category", exact: true });

  async function addCategory(name: string, pin = false) {
    await category.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await category.getByRole("button", { name: "Add category", exact: true }).click();
    if (pin) await confirmPin(page);
    await expect(category).toBeHidden();
  }

  await recipes.click();
  await page.getByRole("button", { name: /^Categories/ }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await addCategory("Seasonal", true);
  await expect(page.getByRole("button", { name: "Seasonal 0 items" })).toBeVisible();

  await back.click();
  await page.getByRole("button", { name: /^Menu items/ }).click();
  const tabs = page.getByRole("group", { name: "Categories", exact: true });
  await tabs.getByRole("button", { name: "New category" }).click();
  await addCategory("Bundles");
  await expect(tabs.getByRole("button", { name: "Bundles" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add an item" }).click();
  const item = page.getByRole("dialog", { name: "New item" });
  await item.getByRole("button", { name: "New category" }).click();
  await addCategory("Pop-ups");
  await expect(item.getByRole("combobox", { name: "Category" })).toHaveValue("Pop-ups");
  await item.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("menuitem", { name: "Add bulk" }).click();
  const bulk = page.getByRole("dialog", { name: "Add menu items in bulk" });
  await bulk.getByRole("button", { name: "New category" }).click();
  await addCategory("Market drinks");
  await expect(bulk.getByRole("combobox", { name: "Category for these items" })).toHaveValue("Market drinks");
  await bulk.getByRole("button", { name: "Close", exact: true }).click();

  await page.reload();
  await recipes.click();
  await page.getByRole("button", { name: /^Categories/ }).click();
  for (const name of ["Seasonal", "Bundles", "Pop-ups", "Market drinks"])
    await expect(page.getByRole("button", { name: `${name} 0 items` })).toBeVisible();
});
