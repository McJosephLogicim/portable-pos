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
  const add = page.locator(".sell-head .page-top").getByRole("button", { name: "Add", exact: true });
  await context.setOffline(true);
  await expect(add).toHaveAttribute("aria-disabled", "true");
  await add.click({ force: true });
  await expect(page.locator(".toast:not(.exit-ghost)")).toContainText("Connect to the internet to add items.");
  await expect(page.getByRole("menuitem")).toHaveCount(0);
});

test("Bulk menu items reuse choice groups and go live on Sell", async ({ page }) => {
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

  await bulk.getByRole("button", { name: "Choices for Ginger soda", exact: true }).click();
  const gingerChoices = page.getByRole("dialog", { name: "Choices for Ginger soda", exact: true });
  await gingerChoices.getByRole("button", { name: "Pick one", exact: true }).click();
  await gingerChoices.getByRole("combobox", { name: "Choice name", exact: true }).click();
  await gingerChoices.getByRole("option", { name: /^Milk/ }).click();
  await expect(gingerChoices.getByRole("combobox", { name: "Option 2 name" })).toHaveValue("Oat milk");
  await expect(gingerChoices.getByRole("textbox", { name: "Option 2 extra price" })).toHaveValue("30");

  await gingerChoices.getByRole("button", { name: "Add-ons", exact: true }).click();
  await gingerChoices.getByRole("button", { name: "Save choices", exact: true }).click();
  await expect(gingerChoices.getByRole("alert")).toContainText("Name each choice");
  await gingerChoices.getByRole("combobox", { name: "Choice name", exact: true }).nth(1).fill("Toppings");
  await gingerChoices.getByRole("combobox", { name: "Option 1 name", exact: true }).nth(1).fill("Candied ginger");
  await gingerChoices.getByRole("textbox", { name: "Option 1 extra price", exact: true }).nth(1).fill("15");
  await gingerChoices.getByRole("button", { name: "Save choices", exact: true }).click();
  await expect(gingerChoices).toBeHidden();
  await expect(bulk.getByRole("button", { name: "2 choices for Ginger soda", exact: true })).toBeVisible();

  await bulk.getByRole("button", { name: "Choices for Yuzu soda", exact: true }).click();
  const yuzuChoices = page.getByRole("dialog", { name: "Choices for Yuzu soda", exact: true });
  await yuzuChoices.getByRole("button", { name: "Add-ons", exact: true }).click();
  await yuzuChoices.getByRole("combobox", { name: "Choice name", exact: true }).click();
  await yuzuChoices.getByRole("option", { name: /^Toppings.*from Ginger soda/ }).click();
  await expect(yuzuChoices.getByRole("textbox", { name: "Option 1 extra price" })).toHaveValue("15");
  await yuzuChoices.getByRole("button", { name: "Save choices", exact: true }).click();
  await expect(yuzuChoices).toBeHidden();
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
  await page.getByRole("button", { name: /^Add Ginger soda/ }).click();
  const orderOptions = page.getByRole("dialog", { name: "Ginger soda", exact: true });
  await expect(orderOptions.getByRole("radio", { name: "Whole milk" })).toBeChecked();
  await orderOptions.getByText("Oat milk", { exact: true }).click();
  await orderOptions.getByRole("button", { name: /^Candied ginger/ }).click();
  await expect(orderOptions.getByRole("button", { name: /Add ₱125/ })).toBeEnabled();
  await orderOptions.getByRole("button", { name: "Close", exact: true }).click();

  await page.setViewportSize({ width: 320, height: 844 });
  await page.locator(".sell-head .page-top").getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Add an item", "Add bulk"]);
  await page.getByRole("menuitem", { name: "Add bulk", exact: true }).click();
  await bulk.getByRole("textbox", { name: "Item 1 name", exact: true }).fill("Test item");
  await bulk.getByRole("button", { name: "Choices for Test item", exact: true }).click();
  const sellChoices = page.getByRole("dialog", { name: "Choices for Test item", exact: true });
  await expect(sellChoices.getByRole("button", { name: "Pick one", exact: true })).toBeVisible();
  await expect(sellChoices.getByRole("button", { name: "Add-ons", exact: true })).toBeVisible();
});

test("Stock Lists tabs keep a contextual Add menu for each empty list", async ({ page }) => {
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
  for (const [label, noun, field] of [
    ["Prep categories", "prep category", "category"],
    ["Stock types", "stock type", "kind"],
    ["Suppliers", "supplier", "supplier"],
  ]) {
    const card = page.locator(".empty.card").filter({ hasText: `No ${label.toLowerCase()} yet` });
    await expect(card.getByRole("button", { name: "Add", exact: true })).toBeVisible();
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
  await page.getByRole("group", { name: "Prep categories", exact: true }).getByRole("button", { name: "Syrups", exact: true }).click();
  await expect(page.locator(".empty.card").filter({ hasText: "No prep items in Syrups" }).getByRole("button", { name: "Add", exact: true })).toBeVisible();
});

test("Stock items stage two records and save them with one PIN", async ({ page }) => {
  await startDemo(page);
  await page.getByRole("button", { name: /^Recipes/ }).click();
  await page.getByRole("button", { name: /^Stock items/ }).click();
  const types = page.getByRole("group", { name: "Stock types", exact: true });
  await types.getByRole("button", { name: "Ingredient", exact: true }).click();
  const add = page.locator(".empty.card").filter({ hasText: "No stock items in Ingredient" }).getByRole("button", { name: "Add", exact: true });
  await add.click();
  await page.getByRole("menuitem", { name: "Add bulk" }).click();
  const bulk = page.getByRole("dialog", { name: "Add stock items in bulk" });
  for (const name of ["Cacao nibs", "Tea leaves"]) {
    await bulk.getByRole("button", { name: "Add a stock item" }).click();
    const editor = page.getByRole("dialog", { name: "New stock item" });
    await editor.getByRole("textbox", { name: "Name", exact: true }).fill(name);
    await editor.getByRole("button", { name: "Add to batch", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(bulk.getByText(name, { exact: true })).toBeVisible();
  }
  await bulk.getByRole("button", { name: "Add 2 stock items" }).click();
  await confirmPin(page);
  await expect(bulk).toBeHidden();
  await expect(page.getByRole("button", { name: /^Cacao nibs/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Tea leaves/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Fresh milk/ })).toBeHidden();
  await types.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Fresh milk/ })).toBeVisible();
});

test("Other editable lists open their own bulk editors from the same menu", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await startDemo(page);

  async function check(row: RegExp, singleLabel: string, bulkTitle: string, back: string, empty = false) {
    await page.getByRole("button", { name: row }).click();
    const add = empty
      ? page.locator(".empty.card").getByRole("button", { name: "Add", exact: true })
      : await summaryAdd(page);
    await add.click();
    await expect(page.getByRole("menuitem")).toHaveText([singleLabel, "Add bulk"]);
    await page.getByRole("menuitem", { name: "Add bulk" }).click();
    const bulk = page.getByRole("dialog", { name: bulkTitle, exact: true });
    await expect(bulk).toBeVisible();
    await bulk.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: back, exact: true }).click();
  }

  await check(/^Payment methods/, "Add a payment method", "Add payment methods in bulk", "Back to settings");
  await check(/^Discounts/, "Add a discount", "Add discounts in bulk", "Back to settings");
  await check(/^Organizers/, "Add an organizer", "Add organizers in bulk", "Back to settings");
  await check(/^Opening checklist/, "Add a step", "Add steps in bulk", "Back to settings");
  await page.getByRole("button", { name: /^Recipes/ }).click();
  await check(/^Categories/, "Add a category", "Add categories in bulk", "Back to recipes");
  await check(/^Choices/, "Add a choice", "Add choices in bulk", "Back to recipes");
  await check(/^Prep What you make/, "Add a prep item", "Add prep items in bulk", "Back to recipes", true);

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
  await page.getByRole("group", { name: "Choice types" }).getByRole("button", { name: "Add-ons", exact: true }).click();
  const add = page.locator(".empty.card").filter({ hasText: "No add-ons yet" }).getByRole("button", { name: "Add", exact: true });
  await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(1);
  await add.click();
  await page.getByRole("menuitem", { name: "Add a choice", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "New choice", exact: true });
  await expect(sheet.getByRole("button", { name: "Add-ons", exact: true })).toHaveAttribute("aria-pressed", "true");
});
