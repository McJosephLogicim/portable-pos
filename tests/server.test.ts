import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { makeSale } from "../src/lib/domain";
import type { RegisterEvent, Tender } from "../src/lib/types";
import { authenticatedOwner } from "../src/server/auth";
import { getDb } from "../src/server/db";
import { shifts } from "../src/server/schema";
import { historyPage } from "../src/server/snapshot";
import { runCommand } from "../src/server/register";
import { shiftNow } from "./schedule";

test("the register API requires an authenticated Supabase bearer", async () => {
  await assert.rejects(
    authenticatedOwner(new Request("http://localhost/api/pos")),
    { status: 401 },
  );
});

test(
  "undo restores the deleted menu item and scheduled shift without replacing other records",
  { skip: !process.env.POS_TEST_DATABASE_URL && "Set POS_TEST_DATABASE_URL to a migrated local test database." },
  async () => {
    process.env.DATABASE_URL = process.env.POS_TEST_DATABASE_URL;
    const owner = randomUUID();
    const pin = "2718";
    const call = (input: object) => runCommand(owner, { pin, ...input });
    await call({ action: "setup", name: "Undo test", currency: "USD", timeZone: "UTC" });
    const tea = { id: "tea", name: "Tea", category: "Drinks", price: 250, groups: [], costing: { sku: "TEA" } };
    const coffee = { ...tea, id: "coffee", name: "Coffee", costing: { sku: "COFFEE" } };
    await call({ action: "menu", menu: [tea, coffee] });
    const bookingId = await shiftNow(call, pin);
    const opened = await call({ action: "open", openingCash: 0, deviceId: randomUUID(), bookingId });

    const removed = await call({ action: "removeMenuItem", productId: tea.id });
    assert.deepEqual(removed.menu, [coffee]);
    assert.deepEqual(removed.deletedRecord, { kind: "menuItem", item: tea, index: 0 });
    assert.equal(removed.shift!.menu[0].id, tea.id);
    const repriced = { ...coffee, price: 300 };
    await call({ action: "menu", menu: [repriced] });
    const restoreItem = { action: "restoreMenuItem", item: tea, index: 0 };
    assert.deepEqual((await call(restoreItem)).menu, [tea, repriced]);
    assert.deepEqual((await call(restoreItem)).menu, [tea, repriced]);
    await assert.rejects(call({ ...restoreItem, item: { ...tea, price: 350 } }), { status: 409 });

    const deleted = await call({ action: "deleteBooking", bookingId });
    assert.equal(deleted.bookings!.some((entry) => entry.id === bookingId), false);
    assert.equal(deleted.deletedRecord?.kind, "booking");
    const booking = deleted.deletedRecord.booking;
    const restoreShift = { action: "restoreBooking", booking };
    const restored = await call(restoreShift);
    assert.deepEqual(restored.bookings!.find((entry) => entry.id === bookingId), { ...booking, sales: 0 });
    assert.equal(restored.shift!.id, opened.shift!.id);
    assert.equal(restored.shift!.bookingId, bookingId);
    assert.equal((await call(restoreShift)).bookings!.filter((entry) => entry.id === bookingId).length, 1);
    await assert.rejects(call({ ...restoreShift, booking: { ...booking, seats: 3 } }), { status: 409 });
  },
);

test(
  "a business can switch modes and needs a scheduled shift to open in either mode",
  { skip: !process.env.POS_TEST_DATABASE_URL && "Set POS_TEST_DATABASE_URL to a migrated local test database." },
  async () => {
    process.env.DATABASE_URL = process.env.POS_TEST_DATABASE_URL;
    const owner = randomUUID();
    const deviceId = randomUUID();
    const pin = "1742";
    const setup = { action: "setup", name: "Mode test", currency: "USD", timeZone: "UTC", pin };
    const cmd = (input: object) => runCommand(owner, input);
    const initial = await cmd(setup);
    const item = { id: "tea", name: "Tea", category: "Drinks", price: 250, groups: [], costing: { laborPerServing: 50 } };
    await cmd({ action: "menu", menu: [item], pin });
    const open = { action: "open", openingCash: 1000, deviceId };
    await assert.rejects(cmd(open), /Pick a scheduled shift/);

    const changeMode = { action: "mode", mode: "simple", pin };
    await assert.rejects(cmd({ ...changeMode, pin: "2742" }), { status: 403 });
    await cmd(changeMode);
    const staleSettings = await cmd({
      ...setup,
      action: "settings",
      deviceId,
      settings: { ...initial.business!.settings, receiptNote: "Thank you" },
    });
    assert.equal(staleSettings.business!.settings.mode, "simple");
    await assert.rejects(cmd(open), /Pick a scheduled shift/);

    const bookingId = await shiftNow(cmd, pin);
    const scheduledOpen = { ...open, bookingId };
    const [first, retry] = await Promise.all([cmd(scheduledOpen), cmd(scheduledOpen)]);
    const shift = first.shift!;
    assert.equal(shift.bookingId, bookingId);
    assert.equal(retry.shift!.id, shift.id);
    assert.equal(shift.settings.receiptNote, "Thank you");

    const advanced = await cmd({ ...changeMode, mode: "advanced" });
    assert.equal(advanced.business!.settings.mode, "advanced");
    assert.deepEqual(advanced.menu[0].costing, item.costing);
    assert.equal(advanced.shift!.id, shift.id);
    await cmd({ action: "close", shiftId: shift.id, countedCash: 1000, deviceId, pin });
    await assert.rejects(cmd(open), /Pick a scheduled shift/);
  },
);

test(
  "linking an open till assigns its existing sales to a scheduled shift and safely retries",
  { skip: !process.env.POS_TEST_DATABASE_URL && "Set POS_TEST_DATABASE_URL to a migrated local test database." },
  async () => {
    process.env.DATABASE_URL = process.env.POS_TEST_DATABASE_URL;
    const owner = randomUUID();
    const deviceId = randomUUID();
    const pin = "1742";
    const cmd = (input: object) => runCommand(owner, input);
    await cmd({ action: "setup", name: "Link test", currency: "USD", timeZone: "UTC", pin });
    await cmd({ action: "mode", mode: "simple", pin });
    await cmd({ action: "menu", menu: [{ id: "tea", name: "Tea", category: "", price: 250, groups: [] }], pin });
    const opening = { action: "open", openingCash: 0, deviceId, bookingId: await shiftNow(cmd, pin) };
    const openLegacyTill = async () => {
      const { shift } = await cmd(opening);
      // Recreate a till opened before the scheduled shift requirement.
      await getDb().update(shifts).set({ bookingId: null }).where(eq(shifts.id, shift!.id));
      return shift!;
    };
    const shift = await openLegacyTill();
    const sale = makeSale({
      id: randomUUID(), shift, sequence: 1, soldOut: [], tender: "cash", received: 250,
      cart: [{ productId: "tea", quantity: 1, optionIds: [] }], createdAt: shift.openedAt,
    });
    await cmd({ action: "sync", deviceId, events: [{ type: "sale", id: sale.id, shiftId: shift.id, sale }] });

    const booking = {
      id: randomUUID(), startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(),
      seats: 1, staff: [], place: null, organizer: null, event: null, quota: 0, incentive: 0,
    };
    const other = { ...booking, id: randomUUID() };
    await cmd({ action: "booking", booking, pin });
    await cmd({ action: "booking", booking: other, pin });
    const link = { action: "linkBooking", shiftId: shift.id, bookingId: booking.id };
    await assert.rejects(cmd({ ...link, shiftId: randomUUID() }), { status: 409 });
    await assert.rejects(cmd({ ...link, bookingId: randomUUID() }), { status: 404 });
    const [linked, retried] = await Promise.all([cmd(link), cmd(link)]);
    assert.equal(linked.shift!.id, shift.id);
    assert.equal(retried.shift!.bookingId, booking.id);
    assert.equal(linked.sales[0].id, sale.id);
    assert.equal(linked.bookings!.find((entry) => entry.id === booking.id)!.sales, 250);
    await assert.rejects(cmd({ ...link, bookingId: other.id }), { status: 409 });

    await cmd({ action: "close", shiftId: shift.id, countedCash: 250, deviceId, pin });
    await assert.rejects(cmd(link), { status: 409 });
    const next = await openLegacyTill();
    await assert.rejects(cmd(link), { status: 409 });
    await assert.rejects(cmd({ ...link, shiftId: next.id }), { status: 409, message: "This shift already closed. Choose another shift." });
  },
);

test(
  "a real Postgres register isolates shops, replays safely, and reconciles the drawer",
  {
    skip:
      !process.env.POS_TEST_DATABASE_URL &&
      "Set POS_TEST_DATABASE_URL to a migrated local test database.",
  },
  async () => {
    process.env.DATABASE_URL = process.env.POS_TEST_DATABASE_URL;
    const owner = randomUUID();
    const other = randomUUID();
    const deviceId = randomUUID();
    const pin = "9746";
    const setup = {
      action: "setup",
      name: "Local test booth",
      currency: "USD",
      timeZone: "UTC",
      pin,
    };
    const cmd = (input: object) => runCommand(owner, input);
    const menuItem = {
      id: "tea",
      name: "Tea",
      category: "",
      price: 250,
      groups: [],
    };
    await cmd(setup);
    await runCommand(other, setup);
    await cmd({ action: "menu", menu: [menuItem], pin });
    const open = { action: "open", openingCash: 5000, deviceId, bookingId: await shiftNow(cmd, pin) };
    const [one, retry] = await Promise.all([cmd(open), cmd(open)]);
    const shift = one.shift!;
    assert.equal(retry.shift!.id, shift.id);
    // Another phone joins the open shift instead of opening a second one.
    assert.equal((await cmd({ ...open, deviceId: randomUUID() })).shift!.id, shift.id);
    function receipt(sequence: number, tender: Tender, received: number) {
      return makeSale({
        id: randomUUID(),
        shift,
        sequence,
        soldOut: [],
        cart: [{ productId: "tea", quantity: 1, optionIds: [] }],
        tender,
        received,
        createdAt: shift.openedAt,
      });
    }
    const cash = receipt(1, "cash", 500);
    const qr = receipt(2, "qr", 250);
    const card = receipt(3, "card", 250);
    const events = [cash, qr, card].map((sale) => ({
      id: sale.id,
      shiftId: shift.id,
      type: "sale" as const,
      sale,
      ...(sale === qr ? {} : { menuVersion: "opening" }),
    }));
    const edited = await cmd({ action: "menu", menu: [{ ...menuItem, price: 1000 }], pin });
    assert.equal(edited.shift?.menu[0].price, 1000);
    assert.ok(edited.shift?.menuVersion);
    // An older offline client still uses its cached price after another phone edits it.
    qr.createdAt = new Date(Date.now() + 1000).toISOString();
    // A local client can't choose its own prices or the description on the server receipt.
    cash.lines[0].unitPrice = 1;
    cash.lines[0].name = "changed";
    cash.total = 1;
    const sync = (events: RegisterEvent[]) => ({
      action: "sync",
      events,
      deviceId,
    });
    await assert.rejects(runCommand(other, sync(events)), { status: 409 });
    const [synced, replayed] = await Promise.all([
      cmd(sync(events)),
      cmd(sync(events)),
    ]);
    assert.equal(synced.sales.length, 3);
    assert.equal(replayed.sales.length, 3);
    assert.equal(
      synced.sales.find((s) => s.id === cash.id)?.lines[0].name,
      "Tea",
    );
    assert.equal(synced.sales.find((s) => s.id === cash.id)?.change, 250);
    const stop: RegisterEvent = {
      type: "availability",
      shiftId: shift.id,
      id: randomUUID(),
      targetId: "tea",
      soldOut: true,
    };
    const next = receipt(4, "card", 250);
    const blocked = {
      type: "sale" as const,
      shiftId: shift.id,
      id: next.id,
      sale: next,
      menuVersion: "opening",
    };
    // A phone that was offline already took the money, so a sold-out mark from another
    // phone doesn't turn the sale away.
    const late = await cmd(sync([stop, blocked]));
    assert.deepEqual(late.soldOut, ["tea"]);
    assert.equal(late.sales.find((s) => s.id === next.id)?.sequence, 4);
    assert.deepEqual(
      (await runCommand(other, { action: "bootstrap" })).sales,
      [],
    );
    await assert.rejects(
      runCommand(other, {
        action: "reverse",
        pin,
        deviceId,
        saleId: cash.id,
        reason: "wrong shop",
      }),
      { status: 409 },
    );
    const reverse = {
      action: "reverse",
      saleId: cash.id,
      reason: "Entered twice",
      deviceId,
      pin,
    };
    await assert.rejects(cmd({ ...reverse, pin: "0000" }), { status: 403 });
    await cmd(reverse);
    const closed = await cmd({
      action: "close",
      shiftId: shift.id,
      countedCash: 4950,
      pin,
      deviceId,
    });
    assert.equal(closed.shift, null);
    assert.equal(closed.shifts[0].difference, -50);
    assert.equal(
      closed.sales.find((s) => s.id === cash.id)?.reason,
      "Entered twice",
    );
    assert.equal((await cmd(sync(events))).sales.length, 4);
    await assert.rejects(cmd(reverse), { status: 409 });
    const reopened = await cmd({ ...open, bookingId: await shiftNow(cmd, pin) });
    assert.equal(reopened.shift!.number, 2);
    assert.equal(reopened.shift!.menu[0].price, 1000);
    assert.deepEqual(reopened.soldOut, []);
    const many = Array.from({ length: 101 }, (_, index) => {
      const sale = makeSale({
        id: randomUUID(),
        shift: reopened.shift!,
        sequence: index + 1,
        cart: [{ productId: "tea", quantity: 1, optionIds: [] }],
        soldOut: [],
        tender: "card",
        received: 1000,
        createdAt: "2026-05-01T09:00:00.000Z",
      });
      return {
        type: "sale" as const,
        id: sale.id,
        shiftId: sale.shiftId,
        sale,
      };
    });
    const page = await cmd(sync(many));
    const otherId = (await runCommand(other, { action: "bootstrap" })).business!.id;
    assert.equal(page.sales.length, 100);
    assert.ok(page.nextSales);
    const tail = await getDb().transaction((tx) =>
      historyPage(tx, page.business!.id, page.nextSales),
    );
    assert.equal(tail.sales.length, 5);
    assert.equal(tail.nextSales, undefined);
    assert.equal(
      new Set([...page.sales, ...tail.sales].map((sale) => sale.id)).size,
      105,
    );
    assert.deepEqual(
      (
        await getDb().transaction((tx) =>
          historyPage(tx, otherId, page.nextSales),
        )
      ).sales,
      [],
    );
    await assert.rejects(
      getDb().transaction((tx) => historyPage(tx, page.business!.id, "broken cursor")),
      { status: 400 },
    );
    const business = reopened.business!;
    const settingsCmd = {
      action: "settings",
      deviceId,
      name: "Renamed booth",
      currency: "USD",
      timeZone: "UTC",
      pin,
      settings: {
        ...business.settings,
        payments: business.settings.payments.filter((p) => p.id !== "qr"),
        discounts: [
          { id: "staff", name: "Staff", type: "percent", value: 10, on: true },
        ],
      },
    };
    await assert.rejects(cmd({ ...settingsCmd, currency: "JPY" }), {
      status: 409,
    });
    const saved = await cmd(settingsCmd);
    assert.equal(saved.business!.name, "Renamed booth");
    assert.equal(saved.shift!.settings.discounts[0].id, "staff");
    assert.equal(
      saved.shift!.settings.payments.find((p) => p.id === "qr")?.on,
      false,
    );
    const discounted = makeSale({
      id: randomUUID(),
      shift: saved.shift!,
      sequence: 102,
      cart: [{ productId: "tea", quantity: 1, optionIds: [] }],
      soldOut: [],
      tender: "card",
      discountId: "staff",
      received: 900,
      createdAt: new Date().toISOString(),
    });
    const withDiscount = await cmd(
      sync([
        { type: "sale", id: discounted.id, shiftId: discounted.shiftId, sale: discounted },
      ]),
    );
    const stored = withDiscount.sales.find((s) => s.id === discounted.id)!;
    assert.equal(stored.total, 900);
    assert.equal(stored.discount?.amount, 100);
    assert.equal(stored.payment.name, "Card");
    for (let attempt = 0; attempt < 5; attempt++) {
      await assert.rejects(cmd({ action: "menu", menu: [], pin: "0000" }), {
        status: 403,
      });
    }
    await assert.rejects(cmd({ action: "menu", menu: [], pin }), {
      status: 429,
    });
  },
);
