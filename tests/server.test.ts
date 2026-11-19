import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { makeSale } from "../src/lib/domain";
import type { RegisterEvent, Tender } from "../src/lib/types";
import { authenticatedOwner } from "../src/server/auth";
import { getDb } from "../src/server/db";
import { historyPage } from "../src/server/snapshot";
import { runCommand } from "../src/server/register";

test("the register API requires an authenticated Supabase bearer", async () => {
  await assert.rejects(
    authenticatedOwner(new Request("http://localhost/api/pos")),
    { status: 401 },
  );
});

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
    const open = { action: "open", openingCash: 5000, deviceId };
    const [one, retry] = await Promise.all([cmd(open), cmd(open)]);
    const shift = one.shift!;
    assert.equal(retry.shift!.id, shift.id);
    await assert.rejects(cmd({ ...open, deviceId: randomUUID() }), {
      status: 409,
    });
    await cmd({ action: "menu", menu: [{ ...menuItem, price: 1000 }], pin });
    function receipt(sequence: number, tender: Tender, received: number) {
      return makeSale({
        id: randomUUID(),
        shift,
        sequence,
        soldOut: [],
        cart: [{ productId: "tea", quantity: 1, optionIds: [] }],
        tender,
        received,
        createdAt: new Date().toISOString(),
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
    }));
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
    const next = receipt(4, "cash", 250);
    const blocked = {
      type: "sale" as const,
      shiftId: shift.id,
      id: next.id,
      sale: next,
    };
    await assert.rejects(cmd(sync([stop, blocked])), { status: 422 });
    assert.deepEqual((await cmd({ action: "bootstrap" })).soldOut, []);
    await cmd(sync([stop]));
    await assert.rejects(cmd(sync([blocked])), { status: 422 });
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
    assert.equal((await cmd(sync(events))).sales.length, 3);
    await assert.rejects(cmd(reverse), { status: 409 });
    const reopened = await cmd(open);
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
    assert.equal(page.sales.length, 100);
    assert.ok(page.nextSales);
    const tail = await getDb().transaction((tx) =>
      historyPage(tx, owner, page.nextSales),
    );
    assert.equal(tail.sales.length, 4);
    assert.equal(tail.nextSales, undefined);
    assert.equal(
      new Set([...page.sales, ...tail.sales].map((sale) => sale.id)).size,
      104,
    );
    assert.deepEqual(
      (
        await getDb().transaction((tx) =>
          historyPage(tx, other, page.nextSales),
        )
      ).sales,
      [],
    );
    await assert.rejects(
      getDb().transaction((tx) => historyPage(tx, owner, "broken cursor")),
      { status: 400 },
    );
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
