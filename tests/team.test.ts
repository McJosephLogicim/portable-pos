import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { joinLink } from "../src/lib/join-link";
import { checkOpening, makeSale, stockLeft, updateShiftMenu } from "../src/lib/domain";
import {
  rolesOf,
  shiftRole,
  shiftRoleNames,
  applyPlan,
  bookingProfit,
  daysBetween,
  dayOf,
  redactBooking,
  shiftTimes,
  timeOf,
  zonedInstant,
  type Plan,
} from "../src/lib/team";
import type { Booking, Me, Member, Product, Shift } from "../src/lib/types";
import { readImage, readProof, saveImage } from "../src/server/images";
import { runCommand } from "../src/server/register";

const owner: Member = { id: "o", name: "Owner", email: "o@x.co", roles: ["cashier", "server"], rate: 0, owner: true, joined: true };
const bea: Member = { id: "b", name: "Bea", email: "bea@x.co", roles: ["cashier"], rate: 70000, owner: false, joined: true };
const paolo: Member = { id: "p", name: "Paolo", email: "p@x.co", roles: ["server"], rate: 60000, owner: false, joined: true };
const asOwner: Me = { memberId: "o", name: "Owner", roles: owner.roles, owner: true };
const asBea: Me = { memberId: "b", name: "Bea", roles: bea.roles, owner: false };
const later = Date.parse("2026-12-01T00:00:00Z");
const booking: Booking = {
  id: "k",
  startsAt: "2026-12-05T02:00:00.000Z",
  endsAt: "2026-12-05T10:00:00.000Z",
  place: { name: "Legazpi Park" },
  organizer: null,
  event: null,
  seats: 2,
  staff: [],
  rent: 150000,
  quota: 800000,
  incentive: 20000,
};
const plan: Plan = { members: [owner, bea, paolo], organizers: [], bookings: [booking] };

test("only the owner plans; teammates join open seats in their role", () => {
  assert.throws(() => applyPlan(plan, asBea, { action: "deleteBooking", bookingId: "k" }, later), /owner/);
  const joined = applyPlan(plan, asBea, { action: "join", bookingId: "k", role: "cashier" }, later);
  assert.deepEqual(joined.bookings[0].staff, [{ memberId: "b", name: "Bea", role: "cashier", salary: 70000 }]);
  const full = applyPlan(joined, asOwner, { action: "assign", bookingId: "k", memberId: "p", role: "server" }, later);
  assert.throws(() => applyPlan(full, asOwner, { action: "join", bookingId: "k", role: "cashier" }, later), /filled/);
  // Taking over puts the owner in Bea's seat.
  const taken = applyPlan(full, asOwner, { action: "assign", bookingId: "k", memberId: "o", role: "cashier", replace: "b" }, later);
  assert.deepEqual(taken.bookings[0].staff.map((s) => s.memberId), ["o", "p"]);
  assert.throws(() => applyPlan(joined, asBea, { action: "leave", bookingId: "k", memberId: "b" }, Date.parse(booking.startsAt) + 1), /started/);
  assert.equal(applyPlan(joined, asBea, { action: "leave", bookingId: "k", memberId: "b" }, later).bookings[0].staff.length, 0);
  assert.throws(() => applyPlan(joined, asBea, { action: "leave", bookingId: "k", memberId: "o" }, later), /owner/);
  // Roles are per shift: Bea can switch herself, not others.
  const switched = applyPlan(joined, asBea, { action: "role", bookingId: "k", memberId: "b", role: "server" }, later);
  assert.equal(switched.bookings[0].staff[0].role, "server");
  assert.throws(() => applyPlan(full, asBea, { action: "role", bookingId: "k", memberId: "p", role: "cashier" }, later), /owner/);
});

test("one person can be cashier and server on the same shift", () => {
  const both = applyPlan(plan, asBea, { action: "join", bookingId: "k", role: "both" }, later);
  assert.equal(both.bookings[0].staff[0].role, "both");
  assert.deepEqual(rolesOf("both"), ["cashier", "server"]);
  assert.equal(shiftRole(["server", "cashier"]), "both");
  assert.equal(shiftRole(["server"]), "server");
  const owner = applyPlan(both, asOwner, { action: "role", bookingId: "k", memberId: "b", role: "server" }, later);
  assert.equal(owner.bookings[0].staff[0].role, "server");
  const assigned = applyPlan(plan, asOwner, { action: "assign", bookingId: "k", memberId: "p", role: "both" }, later);
  assert.equal(assigned.bookings[0].staff[0].role, "both");
  assert.equal(shiftRoleNames.both, "Cashier and server");
});

test("removing someone opens their future seats and keeps past names", () => {
  const past = { ...booking, id: "past", startsAt: "2026-11-01T02:00:00.000Z", endsAt: "2026-11-01T08:00:00.000Z", staff: [{ memberId: "b", name: "Bea", role: "cashier" as const, salary: 1 }] };
  const future = { ...booking, staff: past.staff };
  const next = applyPlan({ ...plan, bookings: [past, future] }, asOwner, { action: "removeMember", memberId: "b" }, later);
  assert.equal(next.members.length, 2);
  assert.equal(next.bookings.find((b) => b.id === "past")!.staff.length, 1);
  assert.equal(next.bookings.find((b) => b.id === "k")!.staff.length, 0);
  assert.throws(() => applyPlan(plan, asOwner, { action: "invite", name: "B2", email: "BEA@x.co", rate: 0 }), /already/);
});

test("profit is sales minus rent, pay, and the incentive once the quota is hit", () => {
  const staffed = { ...booking, staff: [{ memberId: "b", name: "Bea", role: "cashier" as const, salary: 70000 }, { memberId: "p", name: "Paolo", role: "server" as const, salary: 60000 }] };
  const miss = bookingProfit({ ...staffed, sales: 700000 });
  assert.equal(miss.hit, false);
  assert.equal(miss.net, 700000 - 150000 - 130000);
  const hit = bookingProfit({ ...staffed, sales: 800000 });
  assert.equal(hit.incentives, 40000);
  assert.equal(hit.net, 800000 - 150000 - 130000 - 40000);
  const seen = redactBooking({ ...staffed, sales: 1 }, asBea);
  assert.equal(seen.rent, undefined);
  assert.equal(seen.sales, undefined);
  assert.equal(seen.staff[0].salary, 70000);
  assert.equal(seen.staff[1].salary, undefined);
});

test("bulk days and times follow the business time zone", () => {
  assert.equal(zonedInstant("2026-11-28", "10:00", "Asia/Manila"), "2026-11-28T02:00:00.000Z");
  assert.equal(zonedInstant("2026-03-08", "03:30", "America/New_York"), "2026-03-08T07:30:00.000Z");
  const night = shiftTimes("2026-11-28", "18:00", "02:00", "Asia/Manila");
  assert.equal(night.endsAt, "2026-11-28T18:00:00.000Z");
  assert.equal(dayOf(night.startsAt, "Asia/Manila"), "2026-11-28");
  assert.equal(timeOf(night.startsAt, "Asia/Manila"), "18:00");
  assert.deepEqual(daysBetween("2026-11-27", "2026-12-06", [0, 6]), ["2026-11-28", "2026-11-29", "2026-12-05", "2026-12-06"]);
});

test("counted items sell down to zero and come back on reversal", () => {
  const bread: Product = { id: "bread", name: "Pandesal", category: "", price: 1000, groups: [], stock: true };
  const tea: Product = { id: "tea", name: "Tea", category: "", price: 500, groups: [] };
  assert.throws(() => checkOpening([bread, tea], undefined, [{ id: "c" }], {}, ["c"]), /Count the Pandesal/);
  assert.throws(() => checkOpening([bread], undefined, [{ id: "c" }], { bread: 2 }, []), /checklist/);
  const shift: Shift = {
    id: randomUUID(), number: 1, businessId: "b", deviceId: "d", openedAt: "", closedAt: null, openingCash: 0,
    menu: [bread, tea], stock: checkOpening([bread, tea], undefined, [], { bread: 2, tea: 9 }, []),
    settings: { currency: "PHP", receiptNote: "", discounts: [], payments: [{ id: "cash", name: "Cash", kind: "cash", on: true }] },
  };
  assert.deepEqual(shift.stock, { bread: 2 });
  const sell = (quantity: number, sales: ReturnType<typeof makeSale>[]) =>
    makeSale({ id: randomUUID(), shift, sequence: sales.length + 1, cart: [{ productId: "bread", optionIds: [], quantity }], soldOut: [], tender: "cash", received: 5000, createdAt: "", stock: stockLeft(shift, sales) });
  assert.throws(() => sell(3, []), /Only 2/);
  const first = sell(2, []);
  assert.throws(() => sell(1, [first]), /sold out/);
  assert.doesNotThrow(() => sell(1, [{ ...first, reversedAt: "now" }]));
  const added = updateShiftMenu(shift, [bread, tea, { ...bread, id: "ube", name: "Ube roll" }], { ube: 6 });
  assert.equal(added.menu.length, 3);
  assert.equal(added.stock!.ube, 6);
});

test(
  "a real Postgres team: invites by email, roles, schedule, and profit",
  {
    skip:
      !process.env.POS_TEST_DATABASE_URL &&
      "Set POS_TEST_DATABASE_URL to a migrated local test database.",
  },
  async (t) => {
    process.env.DATABASE_URL = process.env.POS_TEST_DATABASE_URL;
    for (const [name, value] of Object.entries({
      RESEND_API_KEY: "test-mail-key",
      POS_INVITE_FROM: "Portable POS <team@example.com>",
      POS_APP_URL: "https://pos.example.com",
    })) {
      const previous = process.env[name];
      process.env[name] = value;
      t.after(() => {
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      });
    }
    const mail: { to: string[]; text: string }[] = [];
    let mailStatus = 200;
    t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(new Headers(options.headers).get("Authorization"), "Bearer test-mail-key");
      mail.push(JSON.parse(String(options.body)));
      return new Response("{}", { status: mailStatus });
    });
    const ownerUser = { id: randomUUID(), email: `owner-${randomUUID()}@example.com` };
    const beaEmail = `bea-${randomUUID()}@example.com`;
    const beaUser = { id: randomUUID(), email: beaEmail };
    const paoloEmail = `paolo-${randomUUID()}@example.com`;
    const paoloUser = { id: randomUUID(), email: paoloEmail };
    const pin = "4321";
    const deviceId = randomUUID();
    const as = (who: { id: string; email?: string | null }) => (input: object) => runCommand(who, input);
    const o = as(ownerUser);
    await o({ action: "setup", name: "Pop-up", currency: "PHP", timeZone: "Asia/Manila", pin });
    const bread = { id: "bread", name: "Pandesal", category: "", price: 1000, groups: [], stock: true };
    await o({ action: "menu", menu: [bread], pin });
    const stockItem = { id: bread.id, name: bread.name, unit: "piece" };
    const purchase = { price: 500, quantity: 1 };
    const details = { sku: "BAK-BREAD", supplier: "Bakery", notes: "Order weekly" };
    const pricing = { targetMargin: 55, roundingIncrement: 500 };
    const garnish = { id: "crumbs", name: "Bread crumbs", unit: "g" };
    const prep = { yieldQuantity: 50, uses: [{ stockId: stockItem.id, amount: 1 }] };
    await o({ action: "settings", deviceId, name: "Pop-up", currency: "PHP", timeZone: "Asia/Manila", pin, settings: { receiptNote: "", payments: [{ id: "cash", name: "Cash", kind: "cash", on: true }], discounts: [], checklist: [{ id: "float", text: "Count float" }], stockItems: [{ ...stockItem, purchase, details }, { ...garnish, prep }], pricing } });
    const costing = { laborPerServing: 200, targetMargin: 60, sku: "MENU-BREAD", notes: "Toast lightly", batch: { servings: 12, uses: [{ stockId: garnish.id, amount: 50, notes: "Use fine crumbs" }] } };
    await o({ action: "menu", menu: [{ ...bread, costing }], pin });
    let snap = await o({ action: "invite", name: "Bea", email: beaEmail.toUpperCase(), rate: 70000, pin });
    snap = await o({ action: "invite", name: "Paolo", email: paoloEmail, rate: 60000, pin });
    assert.equal(snap.team!.length, 3);
    assert.equal(snap.me!.owner, true);
    assert.deepEqual(snap.business!.settings.stockItems, [{ ...stockItem, purchase, details }, { ...garnish, prep }]);
    assert.deepEqual(snap.business!.settings.pricing, pricing);
    assert.deepEqual(snap.menu[0].costing, costing);
    // An unconfirmed address can't claim the invite.
    assert.equal((await runCommand({ id: beaUser.id, email: null }, { action: "bootstrap" })).business, null);
    const bea = as(beaUser);
    const asBea = await bea({ action: "bootstrap" });
    assert.equal(asBea.business!.name, "Pop-up");
    assert.equal(asBea.me!.owner, false);
    assert.deepEqual(asBea.business!.settings.stockItems, [stockItem, garnish]);
    assert.equal(asBea.business!.settings.pricing, undefined);
    assert.equal(asBea.menu[0].costing, undefined);
    assert.deepEqual(asBea.team, []);
    await assert.rejects(bea({ action: "menu", menu: [], pin }), /owner/);
    await assert.rejects(bea({ action: "setup", name: "Mine", currency: "PHP", timeZone: "UTC", pin }), { status: 409 });
    const paolo = as(paoloUser);
    const asPaolo = await paolo({ action: "bootstrap" });

    const id = randomUUID();
    const start = new Date(Date.now() + 15 * 60000).toISOString();
    const end = new Date(Date.now() + 8 * 3600000).toISOString();
    const booking = { id, startsAt: start, endsAt: end, place: { name: "Legazpi Park", lat: 14.55, lon: 121.01 }, organizer: { id: "wm", name: "Weekend Market" }, event: { id: "sun", name: "Sunday Market" }, seats: 2, staff: [], rent: 150000, quota: 2000, incentive: 500 };
    await assert.rejects(bea({ action: "booking", booking, pin }), /owner/);
    await o({ action: "booking", booking, pin });
    await assert.rejects(o({ action: "booking", booking: { ...booking, id: randomUUID(), endsAt: start }, pin }), /end after/);
    snap = await bea({ action: "join", bookingId: id, role: "cashier" });
    assert.equal(snap.bookings![0].staff[0].name, "Bea");
    assert.equal(snap.bookings![0].rent, undefined);
    snap = await paolo({ action: "join", bookingId: id, role: "server" });
    // Paolo serves and also runs the till.
    snap = await paolo({ action: "role", bookingId: id, memberId: asPaolo.me!.memberId, role: "both" });
    assert.equal(snap.bookings![0].staff.find((s) => s.memberId === asPaolo.me!.memberId)?.role, "both");
    await assert.rejects(o({ action: "join", bookingId: id, role: "cashier" }), /filled/);
    // Taking someone off a shift needs the owner PIN; leaving your own does not.
    await assert.rejects(o({ action: "leave", bookingId: id, memberId: snap.me!.memberId }), { status: 403 });
    const ownerMe = (await o({ action: "bootstrap" })).me!;
    snap = await o({ action: "assign", bookingId: id, memberId: ownerMe.memberId, role: "cashier", replace: asBea.me!.memberId, pin });
    assert.deepEqual(snap.bookings![0].staff.map((s) => s.name).sort(), ["Owner " + ownerUser.email.split("@")[0].slice(6).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), "Paolo"].sort());

    const openingStock = { bread: 2, crumbs: 50 };
    await assert.rejects(o({ action: "open", deviceId, openingCash: 0, stock: openingStock, checked: [] }), /checklist/);
    await assert.rejects(o({ action: "open", deviceId, openingCash: 0, stock: {}, checked: ["float"] }), /Count/);
    const opened = await o({ action: "open", deviceId, openingCash: 0, stock: openingStock, checked: ["float"], bookingId: id });
    const shift = opened.shift!;
    assert.equal(shift.menu[0].costing, undefined);
    assert.deepEqual(shift.settings.stockItems, [stockItem, garnish]);
    assert.equal(shift.settings.pricing, undefined);
    assert.deepEqual(shift.stock, openingStock);
    assert.equal(shift.bookingId, id);
    const recosted = await o({ action: "menu", menu: [{ ...bread, costing: { ...costing, laborPerServing: 250 } }], pin });
    assert.equal(recosted.menu[0].costing?.laborPerServing, 250);
    assert.equal(recosted.shift!.menuVersion, shift.menuVersion);
    const sale = (n: number, quantity: number) => {
      const s = makeSale({ id: randomUUID(), shift, sequence: n, cart: [{ productId: "bread", optionIds: [], quantity }], soldOut: [], tender: "cash", received: 5000, createdAt: new Date().toISOString() });
      return { type: "sale" as const, id: s.id, shiftId: shift.id, sale: s };
    };
    await o({ action: "sync", deviceId, events: [sale(1, 2)] });
    // A second phone sold the last bread while offline. The money was taken, so it's kept
    // and the stock shows one short until the closing count settles it.
    const late = await o({ action: "sync", deviceId: randomUUID(), events: [sale(2, 1)] });
    assert.equal(late.sales.filter((s) => s.shiftId === shift.id).length, 2);
    // An item added mid-shift goes on sale with the count given.
    const added = await o({ action: "menu", menu: [bread, { ...bread, id: "ube", name: "Ube" }], stock: { ube: 4 }, deviceId, pin });
    assert.equal(added.shift!.stock!.ube, 4);
    snap = await o({ action: "bootstrap" });
    assert.equal(snap.bookings![0].sales, 3000);

    const editedMenu = [
      { ...bread, name: "Fresh Pandesal", stock: false },
      {
        ...bread,
        id: "ube",
        name: "Ube roll",
        groups: [{
          id: "size", name: "Size", required: true,
          options: [{ id: "large", name: "Large", price: 500 }],
        }],
      },
    ];
    await o({ action: "menu", menu: editedMenu, deviceId, pin });
    const refreshed = await o({ action: "bootstrap" });
    assert.equal(refreshed.shift!.id, shift.id);
    assert.deepEqual(refreshed.shift!.stock, { ...openingStock, ube: 4 });
    assert.equal(stockLeft(refreshed.shift!, refreshed.sales).bread, -1);
    assert.equal(refreshed.sales[0].lines[0].name, "Pandesal");
    assert.equal(refreshed.shift!.menu[0].name, "Fresh Pandesal");
    const cart = { productId: "ube", optionIds: [], quantity: 1 };
    const checkout = (optionIds: string[]) => makeSale({
      id: randomUUID(), shift: refreshed.shift!, sequence: 2, cart: [{ ...cart, optionIds }],
      soldOut: [], tender: "cash", received: 1500, createdAt: new Date().toISOString(),
    });
    assert.throws(() => checkout([]), /Choose one option for Size/);
    const ubeSale = checkout(["large"]);
    const synced = await o({
      action: "sync", deviceId,
      events: [{ type: "sale", id: ubeSale.id, shiftId: shift.id, sale: ubeSale, menuVersion: refreshed.shift!.menuVersion }],
    });
    assert.deepEqual(synced.sales.find((s) => s.id === ubeSale.id)?.lines, [{
      productId: "ube", quantity: 1, optionIds: ["large"],
      name: "Ube roll", options: ["Large"], unitPrice: 1500,
    }]);
    snap = await o({ action: "removeMember", memberId: asPaolo.me!.memberId, pin });
    assert.equal(snap.bookings![0].staff.length, 1);
    assert.equal((await paolo({ action: "bootstrap" })).business, null);
    // Photos: only the owner adds them, and they come back byte for byte.
    const photo = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const url = await saveImage(ownerUser, "image/jpeg", photo);
    assert.match(url, /^\/api\/images\/[0-9a-f-]{36}$/);
    const stored = await readImage(url.split("/").pop()!);
    assert.equal(stored!.type, "image/jpeg");
    assert.deepEqual(Buffer.from(stored!.data), photo);
    await assert.rejects(saveImage(beaUser, "image/jpeg", photo), /owner/);
    await assert.rejects(saveImage(ownerUser, "image/svg+xml", photo), /JPEG/);
    assert.equal(await readImage("../etc"), null);

    // Proof photos are private: anyone on the team adds them, only the team sees them.
    const proofUrl = await saveImage(beaUser, "image/jpeg", photo, true);
    assert.match(proofUrl, /^\/api\/proofs\//);
    const proofId = proofUrl.split("/").pop()!;
    assert.equal(await readImage(proofId), null);
    assert.ok(await readProof(ownerUser, proofId));
    assert.equal(await readProof({ id: randomUUID() }, proofId), null);

    // Profile photos: anyone sets their own, only the owner sets someone else's.
    const face = await saveImage(beaUser, "image/jpeg", photo, false, true);
    assert.match(face, /^\/api\/images\//);
    snap = await bea({ action: "profile", photo: face });
    assert.equal(snap.me!.photo, face);
    snap = await bea({ action: "profile", name: "Bea Santos" });
    assert.equal(snap.me!.name, "Bea Santos");
    assert.equal(snap.me!.photo, face);
    await assert.rejects(bea({ action: "profile", memberId: ownerMe.memberId, photo: face }), { status: 403 });
    snap = await o({ action: "profile", memberId: asBea.me!.memberId, photo: null, pin });
    assert.equal(snap.team!.find((m) => m.id === asBea.me!.memberId)!.photo, undefined);
    snap = await o({ action: "profile", photo: url });
    assert.equal(snap.faces![ownerMe.memberId], url);

    // A second business: its own menu and team, and the first stays the default.
    const second = randomUUID();
    snap = await o({ action: "setup", id: second, name: "Night stall", currency: "PHP", timeZone: "Asia/Manila", pin: "9999" });
    assert.equal(snap.business!.id, second);
    assert.deepEqual(snap.menu, []);
    assert.deepEqual(snap.businesses!.map((b) => b.name), ["Pop-up", "Night stall"]);
    // Retrying the same request doesn't make a third.
    snap = await o({ action: "setup", id: second, name: "Night stall", currency: "PHP", timeZone: "Asia/Manila", pin: "9999" });
    assert.equal(snap.businesses!.length, 2);
    assert.equal((await o({ action: "bootstrap" })).business!.name, "Pop-up");
    const night = (input: object) => runCommand({ ...ownerUser, businessId: second }, input);
    assert.equal((await night({ action: "bootstrap" })).business!.name, "Night stall");
    await assert.rejects(night({ action: "menu", menu: [bread], pin }), /PIN/);
    const ownBusiness = randomUUID();
    await bea({ action: "setup", id: ownBusiness, name: "Bea's stall", currency: "PHP", timeZone: "UTC", pin });
    const invite = { action: "invite", name: "Bea", email: beaEmail, rate: 50000, pin: "9999" };
    mailStatus = 503;
    const failed = await night(invite);
    assert.equal(failed.inviteDelivery, "failed");
    assert.equal(failed.team!.filter((m) => m.email === beaEmail && !m.joined).length, 1);
    const pendingBea = failed.team!.find((m) => m.email === beaEmail)!;
    await assert.rejects(night({
      action: "member", memberId: pendingBea.id, name: pendingBea.name, rate: pendingBea.rate, owner: true, pin: "9999",
    }), /accept the invitation/);
    mailStatus = 200;
    const resent = await night(invite);
    assert.equal(resent.inviteDelivery, "sent");
    assert.equal(resent.team!.length, failed.team!.length);
    assert.deepEqual(mail.at(-1)?.to, [beaEmail]);
    assert.ok(mail.at(-1)?.text.includes(joinLink("https://pos.example.com", second)));
    assert.equal(mail.length, 4);
    // The same confirmed account can open the new team and still owns its business.
    const beaBoth = await bea({ action: "bootstrap" });
    assert.equal(beaBoth.business?.id, ownBusiness);
    assert.equal(beaBoth.me?.owner, true);
    assert.deepEqual(beaBoth.businesses!.map((b) => b.name).sort(), ["Bea's stall", "Night stall", "Pop-up"]);
    const beaNight = await runCommand({ ...beaUser, businessId: second }, { action: "bootstrap" });
    assert.equal(beaNight.business!.name, "Night stall");
    assert.equal(beaNight.me!.owner, false);
    await assert.rejects(night(invite), { status: 409 });
    assert.equal(mail.length, 4);
    // Someone not on a business can't open it by id.
    assert.equal((await runCommand({ ...paoloUser, businessId: second }, { action: "bootstrap" })).business, null);

    await t.test("owner access can be assigned and revoked for one business", async () => {
      const asBeaAtNight = (input: object) => runCommand({ ...beaUser, businessId: second }, input);
      const originalOwner = resent.team!.find((m) => m.id === resent.me!.memberId)!;
      assert.equal(originalOwner.primaryOwner, true);
      const promote = {
        action: "member", memberId: pendingBea.id, name: pendingBea.name, rate: pendingBea.rate, owner: true, pin: "9999",
      };
      await assert.rejects(night({ ...promote, pin: "0000" }), /PIN/);
      await assert.rejects(asBeaAtNight(promote), /Only the owner/);
      await assert.rejects(night({ ...promote, memberId: asBea.me!.memberId }), { status: 404 });
      const granted = await night(promote);
      assert.equal(granted.team!.find((m) => m.id === pendingBea.id)?.owner, true);
      assert.equal((await night(promote)).team!.length, granted.team!.length);

      const ownerSettings = { action: "mode", mode: "simple", pin: "9999" };
      const promoted = await asBeaAtNight(ownerSettings);
      assert.equal(promoted.me!.owner, true);
      assert.equal(promoted.business!.settings.mode, "simple");
      assert.equal(promoted.businesses!.find((b) => b.id === second)?.owner, true);
      assert.equal(promoted.businesses!.find((b) => b.id === asBea.business!.id)?.owner, false);
      assert.equal(promoted.businesses!.find((b) => b.id === ownBusiness)?.owner, true);
      assert.equal((await bea({ action: "bootstrap" })).business?.id, ownBusiness);
      await assert.rejects(asBeaAtNight({
        ...promote, memberId: originalOwner.id, name: originalOwner.name, rate: originalOwner.rate, owner: false,
      }), /original owner/);

      await night({ ...promote, owner: false });
      const revoked = await asBeaAtNight({ action: "bootstrap" });
      assert.equal(revoked.me!.owner, false);
      assert.equal(revoked.team!.length, 0);
      await assert.rejects(asBeaAtNight(ownerSettings), /Only the owner/);
    });
  },
);
