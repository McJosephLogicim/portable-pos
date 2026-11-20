import { expect, test, type Page } from "@playwright/test";

// Run against a local demo: POS_TEST_APP_URL=http://localhost:3000 npx playwright test tests/toast.spec.ts
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "block" });

async function removeItem(page: Page) {
  await page.goto(process.env.POS_TEST_APP_URL ?? "http://localhost:3000");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await page.getByRole("button", { name: "Account and settings" }).click();
  await page.getByRole("button", { name: /^Recipes/ }).click();
  await page.getByRole("button", { name: /^Menu items/ }).click();
  await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveAttribute("aria-haspopup", "menu");
  await page.getByRole("button", { name: /^Espresso/ }).click();
  const remove = page.getByRole("button", { name: "Remove from menu", exact: true });
  await expect(remove).toHaveText("Remove");
  await remove.click();
  const confirm = page.getByRole("dialog", { name: "Remove from menu?", exact: true });
  await expect(confirm.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
  await confirm.getByRole("button", { name: "Remove", exact: true }).click();
  const pin = page.getByRole("dialog", { name: "Owner PIN", exact: true });
  await expect(pin).toBeVisible();
  await page.keyboard.type("1234");
  await pin.getByRole("button", { name: "Confirm", exact: true }).click();
  const toast = page.locator(".toast:not(.exit-ghost)");
  await expect(toast).toContainText("Removed Espresso");
  await expect(page.getByRole("button", { name: /^Espresso/ })).toHaveCount(0);
  return toast;
}

test("clicking the toast padding dismisses it without undoing the removal", async ({ page }) => {
  const toast = await removeItem(page);
  await toast.click({ position: { x: 50, y: 3 } });
  await expect(toast).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Espresso/ })).toHaveCount(0);
});

test("a downward touch swipe dismisses the toast", async ({ page, context }) => {
  const toast = await removeItem(page);
  const box = (await toast.boundingBox())!;
  const session = await context.newCDPSession(page);
  const x = box.x + box.width / 3;
  const y = box.y + box.height / 2;
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 24 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + 60 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(toast).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Espresso/ })).toHaveCount(0);
});

test("upward and short drags leave the toast available", async ({ page }) => {
  const toast = await removeItem(page);
  const box = (await toast.boundingBox())!;
  const x = box.x + box.width / 3;
  const y = box.y + box.height / 2;
  for (const dy of [-55, 20]) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy, { steps: 5 });
    await page.mouse.up();
    await expect(toast).toHaveCount(1);
  }
});

test("Undo restores the item, and the resulting plain toast can be dismissed", async ({ page }) => {
  const toast = await removeItem(page);
  await toast.getByRole("button", { name: "Undo", exact: true }).tap();
  await expect(page.getByRole("button", { name: /^Espresso/ })).toBeVisible();
  await expect(toast).not.toContainText("Removed Espresso");
  await toast.getByRole("button", { name: /^Dismiss notification:/ }).tap();
  await expect(toast).toHaveCount(0);
});

test("a toast can be dismissed with the keyboard", async ({ page }) => {
  const toast = await removeItem(page);
  await toast.getByRole("button", { name: /^Dismiss notification:/ }).focus();
  await page.keyboard.press("Enter");
  await expect(toast).toHaveCount(0);
});
