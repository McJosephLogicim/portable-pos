import { expect, test, type Locator } from "@playwright/test";

const appUrl = process.env.POS_TEST_APP_URL ?? "http://localhost:3000";

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });

async function expectPopoToMove(mascot: Locator) {
  await expect.poll(() => mascot.evaluate((image) => image.getAnimations().length)).toBe(1);
  const frames = await mascot.evaluate((image) => {
    const animation = image.getAnimations()[0];
    animation.pause();
    animation.currentTime = 0;
    const start = getComputedStyle(image).transform;
    animation.currentTime = 760;
    return { start, middle: getComputedStyle(image).transform };
  });
  expect(frames.middle).not.toBe(frames.start);
}

test("Popo waits for the artwork and the viewport, and respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const artwork = Promise.withResolvers<void>();
  await page.route("**/mascots/popo/welcome.webp", async (route) => {
    await artwork.promise;
    await route.continue();
  });

  try {
    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    const welcome = page.locator('img[src$="/welcome.webp"]');
    await expect(welcome).toBeVisible();
    await expect(welcome).toHaveCSS("animation-name", "none");
    const offscreen = await page.addStyleTag({
      content: 'img[src$="/welcome.webp"] { position: relative; top: 150vh; }',
    });
    artwork.resolve();
    await expect.poll(() => welcome.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(welcome).toHaveCSS("animation-name", "none");
    await offscreen.evaluate((style) => { style.parentNode?.removeChild(style); });
    await expectPopoToMove(welcome);
  } finally {
    artwork.resolve();
  }

  await page.getByRole("button", { name: "Try the demo" }).click();
  await page.getByRole("button", { name: "Till", exact: true }).click();
  const drawer = page.locator(".hero").filter({ hasText: "Expected in the drawer" });
  const mascot = drawer.locator("img");
  await expect(drawer).toHaveCSS("overflow", "hidden");
  await expectPopoToMove(mascot);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(mascot).toHaveCSS("animation-name", "none");
  await expect(mascot).toBeVisible();
});
