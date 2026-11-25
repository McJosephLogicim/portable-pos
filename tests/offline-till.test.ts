import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { stockLeft } from "../src/lib/domain";
import { checkout, dismissSyncIssue, loadRegister, logExpense, mergeServer, queueReversal, saveCart, saveStockCount } from "../src/lib/register-store";
import { runCommand } from "../src/server/register";
import { shiftNow } from "./schedule";

test("offline corrections reconcile rejected PINs and conflicting counts without losing later records", {
  skip: !process.env.POS_TEST_DATABASE_URL && "Requires a migrated disposable database.",
}, async () => {
  process.env.DATABASE_URL = process.env.POS_TEST_DATABASE_URL;
  const user = crypto.randomUUID();
  const pin = "5917";
  const { deviceId } = await loadRegister(user);
  const call = (command: object) => runCommand(user, { deviceId, ...command });
  await call({ action: "setup", name: "Offline till", currency: "USD", timeZone: "UTC", pin });
  await call({ action: "menu", pin, menu: [{ id: "tea", name: "Tea", price: 200, category: "Drinks", groups: [], stock: true }] });
  const bookingId = await shiftNow(call, pin);
  const opened = await call({ action: "open", bookingId, openingCash: 0, stock: { tea: 10 } });
  const till = opened.shift!.id;
  await mergeServer(user, opened);
  await saveCart(user, [{ productId: "tea", quantity: 1, optionIds: [] }]);
  const { sale } = await checkout(user, "cash", 200);
  await queueReversal(user, sale.id, "Wrong item", "8888");
  await logExpense(user, { label: "Ice", amount: 75, source: "till" });
  const batch = (await loadRegister(user)).pending;
  const sync = (events: typeof batch) => call({ action: "sync", till, events });
  const rejected = await sync(batch);
  assert.match(rejected.syncIssues![0].message, /Incorrect owner PIN/);
  assert.deepEqual((await sync(batch)).syncIssues, rejected.syncIssues);
  const local = await mergeServer(user, rejected, batch.map((e) => e.id));
  assert.equal(local.pending.length, 0);
  assert.equal(local.sales[0].reversedAt, undefined);
  assert.equal(local.expenses!.length, 1);
  assert.match(local.syncIssues![0].message, /Receipt #1/);
  await dismissSyncIssue(user, local.syncIssues![0].id);

  const corrected = await queueReversal(user, sale.id, "Wrong item", pin);
  const approval = corrected.pending[0];
  assert.ok(approval.type === "reversal");
  const changed = await sync([{ ...approval, id: crypto.randomUUID(), reason: "Changed after approval" }]);
  assert.match(changed.syncIssues![0].message, /enter the owner PIN again/);
  assert.equal(changed.sales[0].reversedAt, undefined);
  const reversed = await sync([approval]);
  assert.equal(reversed.sales[0].reversedAt, approval.at);
  await mergeServer(user, reversed, [approval.id]);

  const added = await saveStockCount(user, till, crypto.randomUUID(), { kind: "stock", stockId: "tea", previous: 10, amount: 13, addition: true });
  const first = added.pending[0];
  assert.ok(first.type === "stockCount");
  await sync([{ ...first, id: crypto.randomUUID(), amount: 2 }]); // Another phone received stock too.
  const summed = await sync([first]);
  assert.equal(stockLeft(summed.shift!, summed.sales).tea, 15);
  const replay = await mergeServer(user, summed); // Snapshot arrives before this phone sees its ACK.
  assert.equal(stockLeft(replay.shift!, replay.sales).tea, 15);
  const recount = { ...first, id: crypto.randomUUID(), addition: false, previous: 13, amount: 4, at: new Date().toISOString() };
  const conflict = await sync([recount]);
  assert.match(conflict.syncIssues![0].message, /Stock changed/);
  assert.equal(stockLeft(conflict.shift!, conflict.sales).tea, 15);
});
