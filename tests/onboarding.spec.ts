import { expect, test, type Page } from "@playwright/test";
import { PRACTICE } from "../src/lib/demo";
import type { RegisterState } from "../src/lib/types";

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
test.skip(!process.env.POS_TEST_ONBOARDING, "Use an isolated database and test auth service.");

async function signIn(page: Page, email: string) {
  await page.goto(process.env.POS_TEST_APP_URL ?? "http://localhost:3000");
  await expect(page.getByRole("heading", { name: "POP POS sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Practice with POP POS/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("test-onboarding-password");
  await page.locator("button[type=submit]").click();
}

test("onboarding saves the real setup, keeps till practice local, and completes across devices", async ({ page, browser }) => {
  const email = `owner-${crypto.randomUUID()}@example.test`;
  const sent: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/pos") sent.push(request.postDataJSON().action);
  });
  await signIn(page, email);
  await expect(page.getByRole("heading", { name: "Create your business" })).toBeVisible();
  await page.getByRole("textbox", { name: "Business name" }).fill("Test Coffee");
  await page.locator('input[type="password"]').fill("3951");
  await page.getByRole("button", { name: "Create business" }).click();

  await page.getByRole("button", { name: "Add an item", exact: true }).click();
  const item = page.getByRole("dialog", { name: "New item" });
  await item.getByRole("textbox", { name: "Name", exact: true }).fill("Live iced latte");
  await item.getByRole("textbox", { name: "Price" }).fill("170");
  await item.getByRole("button", { name: "Add item", exact: true }).click();
  const pin = page.getByRole("dialog", { name: "Owner PIN" });
  for (const digit of "3951") await pin.getByRole("button", { name: digit, exact: true }).click();
  await pin.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make your first sale" })).toBeVisible();

  await page.getByRole("button", { name: "Try Sell" }).click();
  await page.getByRole("button", { name: /^Add Live iced latte/ }).click();
  await page.getByRole("button", { name: /^Charge .* for 1 item/ }).click();
  await page.getByRole("button", { name: "Exact" }).click();
  await page.getByRole("button", { name: "Slide to confirm sale", exact: true }).press("Enter");
  await page.getByRole("dialog", { name: "Sale complete" }).getByRole("button", { name: "Continue" }).click();

  await page.getByRole("button", { name: "Add a shift" }).click();
  const shift = page.getByRole("dialog", { name: "New shift" });
  await shift.getByRole("combobox", { name: "Organizer" }).fill("Test Organizers");
  await shift.getByRole("combobox", { name: "Event" }).fill("Test Coffee Pop-up");
  await shift.getByRole("textbox", { name: "Date" }).fill("2030-01-02");
  await shift.getByRole("button", { name: "Add shift", exact: true }).click();
  await expect(shift).toBeHidden();

  await page.getByRole("button", { name: "Open Till" }).click();
  await page.getByRole("dialog", { name: "Shifts" }).getByRole("button", { name: /Test Coffee Pop-up/ }).click();
  await page.getByRole("dialog", { name: "Add till to this shift?" }).getByRole("button", { name: "Add till" }).click();
  await page.getByRole("button", { name: "Count and close" }).click();
  const close = page.getByRole("dialog", { name: "Close shift" });
  await close.getByRole("button", { name: "Type the total" }).click();
  await close.getByRole("textbox", { name: "Cash on hand" }).fill("170");
  await close.getByRole("button", { name: "Close shift and see report" }).click();
  const report = page.getByRole("dialog", { name: "Test Coffee Pop-up • Jan 2 • Shift 1 closed" });
  await expect(report.getByText("Drawer balanced")).toBeVisible();
  await expect(report.getByText("1 sale recorded")).toBeVisible();
  await report.getByRole("button", { name: "Continue" }).click();

  // Reload in the middle of onboarding. The real shift and the local closing exercise survive.
  await page.reload();
  await page.getByRole("button", { name: "Add someone" }).click();
  const invite = page.getByRole("dialog", { name: "Invite someone" });
  await invite.getByRole("textbox", { name: "Name", exact: true }).fill("Live teammate");
  await invite.getByRole("button", { name: "Create", exact: true }).click();
  for (const digit of "3951") await pin.getByRole("button", { name: digit, exact: true }).click();
  await pin.getByRole("button", { name: "Confirm", exact: true }).click();
  const teammate = page.getByRole("dialog", { name: "Live teammate" });
  await expect(teammate.getByRole("button", { name: "Copy invite link" })).toBeVisible();
  await teammate.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Finish setup", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

  for (const action of ["setup", "menu", "booking", "invite", "completeOnboarding"]) expect(sent).toContain(action);
  for (const action of ["sync", "open", "linkBooking", "close"]) expect(sent).not.toContain(action);

  const fresh = await browser.newContext();
  try {
    const anotherDevice = await fresh.newPage();
    const bootstrap = anotherDevice.waitForResponse((resp) => resp.url().endsWith("/api/pos") && resp.request().postDataJSON().action === "bootstrap");
    await signIn(anotherDevice, email);
    const live = await (await bootstrap).json() as RegisterState;
    await expect(anotherDevice.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(anotherDevice.getByRole("progressbar", { name: "Onboarding progress" })).toHaveCount(0);
    expect(live.onboardingComplete).toBe(true);
    expect(live.business?.name).toBe("Test Coffee");
    expect(live.menu).toEqual([expect.objectContaining({ name: "Live iced latte", price: 17000 })]);
    expect(live.bookings).toEqual([expect.objectContaining({ event: expect.objectContaining({ name: "Test Coffee Pop-up" }) })]);
    expect(live.team).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Live teammate", joined: false, inviteCode: expect.any(String) })]));
    expect(live.sales).toEqual([]);
    expect(live.shifts).toEqual([]);
  } finally {
    await fresh.close();
  }

  const local = await page.evaluate((prefix) => new Promise<RegisterState>((resolve, reject) => {
    const request = indexedDB.open("portable-pos-register", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("registers");
      const cursor = tx.objectStore("registers").openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) reject(Error("Practice register missing."));
        else if (String(row.key).startsWith(prefix + ":")) resolve(row.value);
        else row.continue();
      };
      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error);
    };
  }), PRACTICE);
  expect(local.pending).toEqual([]);
  expect(local.sales).toHaveLength(1);
  expect(local.shifts[0]).toMatchObject({ bookingId: local.bookings![0].id, difference: 0 });
});
