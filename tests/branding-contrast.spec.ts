import { expect, test, type Locator, type Page } from "@playwright/test";
import type { RegisterState } from "../src/lib/types";

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });

async function startBrandedDemo(page: Page, brand: string, currency: string) {
  await page.goto(process.env.POS_TEST_APP_URL ?? "http://localhost:3000");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page.getByRole("button", { name: "Account and settings" })).toBeVisible();
  await page.evaluate(({ brand, currency }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("portable-pos-register", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("registers", "readwrite");
      const store = tx.objectStore("registers");
      const read = store.get("demo-register-v2");
      read.onsuccess = () => {
        const state = read.result as RegisterState;
        state.business!.settings.brand = brand;
        state.business!.currency = currency;
        state.shift!.settings.currency = currency;
        store.put(state, "demo-register-v2");
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { brand, currency });
  await page.reload();
}

async function expectTextContrast(text: Locator, surface: string, amount: string) {
  const { color, amountColor, contrast } = await text.evaluate((element, { surface, amount }) => {
    const color = getComputedStyle(element).color;
    const amountColor = getComputedStyle(document.querySelector(amount)!).color;
    const background = getComputedStyle(document.querySelector(surface)!);
    const stops = background.backgroundImage.match(/(?:rgba?|color)\([^)]+\)/g) ?? [];
    const colors = stops.length > 0 ? stops : [background.backgroundColor];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    const luminance = (cssColor: string, backdrop?: string) => {
      ctx.clearRect(0, 0, 1, 1);
      if (backdrop) {
        ctx.fillStyle = backdrop;
        ctx.fillRect(0, 0, 1, 1);
      }
      ctx.fillStyle = cssColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data, (byte) => {
        const channel = byte / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = Math.min(...colors.map((stop) => {
      const levels = [luminance(color, stop), luminance(stop)];
      return (Math.max(...levels) + 0.05) / (Math.min(...levels) + 0.05);
    }));
    return { color, amountColor, contrast };
  }, { surface, amount });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  expect(color).toBe(amountColor);
}

test("A light text color previews, saves, and follows the business theme", async ({ page }) => {
  await startBrandedDemo(page, "#be185d", "PHP");
  const openBranding = async () => {
    await page.getByRole("button", { name: "Account and settings" }).click();
    await page.getByRole("button", { name: /^Sunday Supply.*Demo stall/ }).click();
    await page.getByText("More appearance options", { exact: true }).click();
  };
  await openBranding();
  const cream = page.getByRole("button", { name: "Text color #fff2d9", exact: true });
  await cream.click();
  const creamRgb = "rgb(255, 242, 217)";
  await expect(page.locator(".brand-preview .strong")).toHaveCSS("color", creamRgb);
  await expect(page.locator(".brand-sample .btn").first()).toHaveCSS("color", creamRgb);
  await expect(page.locator(".brand-sample .btn.secondary")).toHaveCSS("color", "rgb(10, 10, 10)");
  const pin = page.getByRole("dialog", { name: "Owner PIN" });
  for (const digit of "1234") await pin.getByRole("button", { name: digit, exact: true }).click();
  await pin.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator(".toast")).toContainText("Saved");

  await page.reload();
  await page.getByRole("button", { name: /^Add Espresso/ }).click();
  const charge = page.locator(".charge-bar");
  await expect(charge.locator(".unit")).toHaveCSS("color", creamRgb);
  await expectTextContrast(charge.locator(".unit"), ".charge-bar", ".charge-bar .num");
  await openBranding();
  await expect(cream).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("Pick any brand color").fill("#f9b9d4");
  await expect(page.locator(".brand-preview .strong")).toHaveCSS("color", creamRgb);
  await expect(page.locator(".brand-sample .btn").first()).toHaveCSS("color", creamRgb);
  await expectTextContrast(page.locator(".brand-preview .strong"), ".brand-preview", ".brand-preview .label");
  await expectTextContrast(page.locator(".brand-sample .btn").first(), ".brand-sample .btn", ".brand-sample .btn");
  const navy = page.getByRole("button", { name: "Text color #1e2a4a", exact: true });
  await navy.click();
  await expect(page.locator(".brand-sample .btn").first()).toHaveCSS("color", "rgb(30, 42, 74)");
  await page.getByRole("button", { name: "Automatic text color", exact: true }).click();
  await expect(page.locator(".brand-sample .btn").first()).toHaveCSS("color", "rgb(0, 0, 0)");
});

for (const [brand, currency, sign] of [
  ["#be185d", "PHP", "₱"],
  ["#db5a91", "PHP", "₱"],
  ["#f9b9d4", "USD", "$"],
  ["#767676", "EUR", "€"],
  ["#ffffff", "PHP", "₱"],
]) {
  test(`Checkout currency and text stay readable on ${brand} (${currency})`, async ({ page }) => {
    await startBrandedDemo(page, brand, currency);
    await page.getByRole("button", { name: /^Add Espresso/ }).click();

    const charge = page.locator(".charge-bar");
    const totalSymbol = charge.locator(".unit");
    await expect(totalSymbol).toHaveText(sign);
    await expectTextContrast(totalSymbol, ".charge-bar", ".charge-bar .num");
    await charge.hover();
    await page.mouse.down();
    await expect(page.locator(".charge-bar:active")).toBeVisible();
    await expectTextContrast(totalSymbol, ".charge-bar", ".charge-bar .num");
    await page.mouse.up();

    const checkout = page.getByRole("dialog", { name: "Charge", exact: true });
    await checkout.getByRole("button", { name: "Cash", exact: true }).click();
    const prefix = checkout.locator(".money-input .prefix");
    await expect(prefix).toHaveText(sign);
    await expectTextContrast(prefix, ".money-input .input", ".money-input .input");
    await checkout.getByRole("button", { name: "Exact", exact: true }).click();
    await page.getByRole("button", { name: "Confirm sale", exact: true }).click();

    const hero = page.getByRole("dialog", { name: "Sale complete" }).locator(".sale-hero");
    await expect(hero.locator(".unit")).toHaveText(sign);
    await expect(hero).toHaveCSS("background-image", /^radial-gradient/);
    await expectTextContrast(hero.locator(".unit"), ".sale-hero", ".sale-hero .num");
    await expectTextContrast(hero.locator(".hero-label").first(), ".sale-hero", ".sale-hero .num");
  });
}
