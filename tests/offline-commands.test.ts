import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { checkout, loadRegister, logExpense, mergeServer, queueCommand, retryCommand, saveCart } from "../src/lib/register-store";
import { runCommand } from "../src/server/register";
import type { RegisterResponse } from "../src/lib/types";
import { shiftNow } from "./schedule";

const database = process.env.POS_TEST_DATABASE_URL;
test("an offline shift, till, catalog, sale, expense, float and close replay in order after reload", { skip: !database }, async () => {
  process.env.DATABASE_URL = database;
  const user = crypto.randomUUID(), pin = "6349";
  const call = (input: object) => runCommand(user, input);
  const first = await call({ action: "setup", pin, name: "Offline shop", timeZone: "UTC", currency: "USD" });
  await mergeServer(user, first);
  const queue = (input: Parameters<typeof queueCommand>[1]) => queueCommand(user, input);
  await queue({ action: "completeOnboarding" });
  const tea = { id: "tea", name: "Tea", category: "Drinks", price: 300, groups: [] };
  await queue({ action: "menu", pin, menu: [tea] });
  const bookingId = await shiftNow(async (input) => {
    if ("action" in input && input.action === "bootstrap") return loadRegister(user);
    await queue(input as Parameters<typeof queue>[0]);
  }, pin);
  await queue({ action: "open", bookingId, openingCash: 100, checked: [], stock: {} });
  await queue({ action: "menu", pin, menu: [{ ...tea, price: 350 }] });
  await queue({ action: "adjustTill", shiftId: bookingId, requestId: crypto.randomUUID(), change: { kind: "float", previous: 100, amount: 500 } });
  await saveCart(user, [{ productId: "tea", optionIds: [], quantity: 1 }]);
  const { sale } = await checkout(user, "cash", 350);
  await logExpense(user, { label: "Cups", amount: 50, source: "till" });
  const b = (await loadRegister(user)).business!;
  await queue({ action: "settings", pin, name: "Evening shop", currency: b.currency, timeZone: b.timeZone, settings: b.settings });
  await queue({ action: "close", pin, shiftId: bookingId, countedCash: 800 });
  let state = await loadRegister(user);
  assert.equal(state.shift, null);
  assert.equal(state.shifts[0].difference, 0);
  assert.equal(state.pending.length, 10);
  for (const event of state.pending) {
    let next: RegisterResponse;
    if (event.type === "command") {
      assert.ok(!("pin" in event.request.command));
      const input = { action: "offlineCommand", request: event.request, approval: event.approval };
      next = await call(input);
      next = await call(input); // Server committed, phone lost the first response.
    } else {
      next = await call({ action: "sync", till: bookingId, deviceId: state.deviceId, events: [event] });
    }
    state = await mergeServer(user, next, [event.id]);
    if (state.pending.length) assert.equal(state.shift, null);
  }
  assert.equal(state.pending.length, 0);
  assert.equal(state.business!.name, "Evening shop");
  assert.equal(state.shifts.length, 1);
  assert.equal(state.shifts[0].difference, 0);
  assert.equal(state.shifts[0].openingCash, 500);
  assert.equal(state.sales.length, 1);
  assert.equal(state.sales[0].id, sale.id);
  assert.equal(state.sales[0].total, 350);
  assert.equal(state.expenses?.length, 1);
});

test("queued PINs bind to the original edit, can be corrected, and stale catalogs cannot overwrite another phone", { skip: !database }, async () => {
  process.env.DATABASE_URL = database;
  const user = crypto.randomUUID(), pin = "2378";
  const call = (input: object) => runCommand(user, input);
  await mergeServer(user, await call({ action: "setup", name: "Shop", currency: "USD", timeZone: "UTC", pin }));
  const { state } = await queueCommand(user, { action: "mode", mode: "simple", pin: "7777" });
  const event = state.pending[0];
  assert.ok(event.type === "command");
  const send = (request: typeof event.request, approval?: string) => call({ action: "offlineCommand", request, approval });
  await assert.rejects(send(event.request, event.approval), /Incorrect owner PIN/);
  const fixed = (await retryCommand(user, event.id, pin)).pending[0];
  assert.ok(fixed.type === "command");
  await assert.rejects(send({ ...fixed.request, command: { action: "mode", mode: "advanced" } }, fixed.approval), /PIN again/);
  await mergeServer(user, await send(fixed.request, fixed.approval), [fixed.id]);
  const queued = (await queueCommand(user, { action: "menu", menu: [], pin })).state.pending[0];
  assert.ok(queued.type === "command");
  await call({ action: "menu", pin, menu: [{ id: "remote", name: "Tea", category: "", price: 100, groups: [] }] });
  await assert.rejects(send(queued.request, queued.approval), /edited this business/);
  assert.equal((await call({ action: "bootstrap" })).menu[0].id, "remote");
});

test("offline business setup and primary-owner deletion tolerate a lost response", { skip: !database }, async () => {
  process.env.DATABASE_URL = database;
  const user = crypto.randomUUID(), pin = "7438";
  const call = (input: object) => runCommand(user, input);
  const original = await call({ action: "setup", name: "First", timeZone: "UTC", currency: "USD", pin });
  await mergeServer(user, original);
  const replay = async (state: Awaited<ReturnType<typeof loadRegister>>) => {
    const first = state.pending[0];
    assert.ok(first.type === "command");
    const request = { action: "offlineCommand", request: first.request, approval: first.approval };
    await call(request);
    return mergeServer(user, await call(request), [first.id]);
  };
  const created = await replay((await queueCommand(user, { action: "createBusiness", name: "Second", timeZone: "UTC", currency: "PHP", pin: "8156" })).state);
  assert.equal(created.businesses?.length, 2);
  assert.equal(created.business?.id, original.business!.id);
  const deleting = (await queueCommand(user, { action: "deleteBusiness", businessId: original.business!.id, pin })).state;
  await assert.rejects(queueCommand(user, { action: "profile", name: "Wait" }), /pending account change/);
  const after = await replay(deleting);
  assert.equal(after.business, null);
  assert.deepEqual(after.businesses?.map((b) => b.name), ["Second"]);
});

test("a teammate can join a saved till offline and sync their own profile photo with immutable retries", { skip: !database }, async () => {
  process.env.DATABASE_URL = database;
  const { saveImage } = await import("../src/server/images");
  const owner = crypto.randomUUID(), user = crypto.randomUUID(), pin = "9362";
  const call = (input: object) => runCommand(owner, input);
  const initial = await call({ action: "setup", pin, name: "Roster", timeZone: "UTC", currency: "USD" });
  const businessId = initial.business!.id;
  const invite = await call({ action: "invite", name: "Pat", email: "", rate: 450, pin });
  const code = invite.team!.find((m) => !m.joined)!.inviteCode!;
  const actor = { id: user, businessId };
  await runCommand(actor, { action: "acceptInvite", code });
  const tea = { id: "tea", name: "Tea", category: "", price: 120, groups: [] };
  await call({ action: "menu", menu: [tea], pin });
  const bookingId = await shiftNow(call, pin);
  await call({ action: "open", bookingId, openingCash: 0, deviceId: crypto.randomUUID() });
  const { deviceId } = await loadRegister(user);
  await mergeServer(user, await runCommand(actor, { action: "bootstrap", till: null, deviceId }));
  await assert.rejects(queueCommand(user, { action: "joinTill", shiftId: bookingId }), /assigned/);
  await assert.rejects(queueCommand(user, { action: "menu", menu: [], pin }), /owner/);
  await queueCommand(user, { action: "join", role: "cashier", bookingId });
  await queueCommand(user, { action: "joinTill", shiftId: bookingId });
  await queueCommand(user, { action: "profile", name: "Pat C.", photo: "data:image/jpeg;base64,/9j/4A==" });
  await saveCart(user, [{ productId: "tea", optionIds: [], quantity: 1 }]);
  await checkout(user, "cash", 120);
  let state = await loadRegister(user);
  assert.equal(state.me?.name, "Pat C.");
  for (const event of state.pending) {
    if (event.type === "command") {
      for (const [id, photo] of Object.entries(event.photos ?? {})) {
        const bytes = Buffer.from(photo.split(",")[1], "base64");
        const url = await saveImage(actor, "image/jpeg", bytes, false, true, id);
        assert.equal(await saveImage(actor, "image/jpeg", bytes, false, true, id), url);
        await assert.rejects(saveImage(actor, "image/jpeg", Buffer.from("different"), false, true, id), /already in use/);
        assert.equal(url, event.request.command.photo);
      }
    }
    const body = event.type === "command" ? { action: "offlineCommand", request: event.request, approval: event.approval }
      : { action: "sync", deviceId, events: [event], till: bookingId };
    state = await mergeServer(user, await runCommand(actor, body), [event.id]);
  }
  assert.equal(state.shift?.id, bookingId);
  assert.equal(state.sales.length, 1);
  assert.match(state.me!.photo!, /^\/api\/images\//);
  assert.equal(state.team?.length, 0);
});
