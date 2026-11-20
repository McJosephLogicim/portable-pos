import { z } from "zod";
import { checkSettings } from "../lib/settings";
import { stockListFields } from "../lib/stock-lists";
import { batchStockUses, checkPrepRecipes, duplicateSku, maxBatchServings } from "../lib/stock";
import { planActions } from "../lib/team";
import { ensure } from "./errors";

const key = z.string().trim().min(1).max(128);
const name = z.string().trim().min(1).max(120);
const pin = z.string().regex(/^\d{4,8}$/, "Use a 4 to 8 digit owner PIN.");
const amount = z.number().int().min(0).max(2147483647);
const sku = z.string().trim().min(1).max(64).optional();
const notes = z.string().trim().max(400).optional();
const margin = z.number().min(0).lt(100);
const stockListName = (field: keyof typeof stockListFields) =>
  z.string().trim().max(stockListFields[field].maxLength);
const stockUse = z.object({ stockId: key, amount: z.number().positive().max(100000), notes: z.string().trim().max(160).optional() });
const product = z.object({
  id: key,
  name,
  price: amount,
  category: z.string().trim().max(100),
  image: z
    .string()
    .max(512)
    .regex(/^\/(?!\/)/)
    .optional(),
  stock: z.boolean().optional(),
  uses: z
    .array(stockUse)
    .max(20)
    .optional(),
  costing: z.object({
    batch: z.object({
      servings: z.number().int().min(1).max(maxBatchServings),
      deductFromStock: z.boolean().optional(),
      uses: z.array(stockUse).min(1).max(20).refine(
        (uses) => new Set(uses.map((use) => use.stockId)).size === uses.length,
      ),
    }).optional(),
    laborPerServing: amount.optional(),
    otherPerServing: amount.optional(),
    targetMargin: margin.optional(),
    sku,
    notes,
  }).optional(),
  groups: z
    .array(
      z.object({
        id: key,
        name,
        required: z.boolean(),
        options: z
          .array(z.object({ id: key, name, price: amount }))
          .min(1)
          .max(64),
      }),
    )
    .max(32),
}).transform((item) => {
  const batch = item.costing?.batch;
  if (!batch?.deductFromStock) return item;
  const { stock: _, ...rest } = item;
  return { ...rest, uses: batchStockUses(batch) };
});
const line = z.object({
  productId: key,
  optionIds: z.array(key).max(256),
  quantity: z.number().int().min(1).max(999),
});

// Only accept a cart and tender as sale inputs. Descriptive fields and prices are
// always taken from the shift's menu, including during offline sync.
const sale = z.object({
  id: z.uuid(),
  shiftId: z.uuid(),
  sequence: z.number().int().positive().max(2147483647),
  createdAt: z.iso.datetime({ offset: true }),
  lines: z.array(line).min(1).max(500),
  // A hint for pre-versioned clients to find an existing menu revision.
  subtotal: amount.optional(),
  tender: key,
  // Only the discount's id is trusted. Its amount is recomputed from the shift.
  discount: z.object({ id: key }).optional(),
  received: amount,
  // Uploaded before the sale syncs, so only private image addresses arrive here.
  proofs: z.array(z.string().regex(/^\/api\/proofs\/[0-9a-f-]{36}$/)).max(4).optional(),
});
const expense = z.object({
  id: z.uuid(),
  shiftId: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
  label: z.string().trim().min(1).max(80),
  amount: amount.min(1),
  source: z.enum(["till", "pocket"]),
  by: z.string().trim().max(80).optional(),
});
const event = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sale"), id: z.uuid(), shiftId: z.uuid(), sale, menuVersion: z.union([z.literal("opening"), z.uuid()]).optional() }),
  z.object({ type: z.literal("expense"), id: z.uuid(), shiftId: z.uuid(), expense }),
  z.object({ type: z.literal("unexpense"), id: z.uuid(), shiftId: z.uuid(), targetId: z.uuid() }),
  z.object({
    type: z.literal("availability"),
    id: z.uuid(),
    shiftId: z.uuid(),
    targetId: key,
    soldOut: z.boolean(),
  }),
]);
export type InputEvent = z.infer<typeof event>;

const settings = z.object({
  receiptNote: z.string().trim().max(200),
  payments: z
    .array(
      z.object({
        id: key,
        name: z.string().trim().min(1).max(40),
        kind: z.enum(["cash", "wallet", "card", "bank", "other"]),
        on: z.boolean(),
        proof: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(24),
  discounts: z
    .array(
      z.object({
        id: key,
        name: z.string().trim().min(1).max(40),
        type: z.enum(["percent", "fixed"]),
        value: z.number().int().min(1).max(2147483647),
        on: z.boolean(),
        proof: z.boolean().optional(),
      }),
    )
    .max(24),
  checklist: z
    .array(
      z.object({
        id: key,
        text: z.string().trim().min(1).max(120),
        image: z.string().max(512).regex(/^\/(?!\/)/).optional(),
      }),
    )
    .max(30)
    .optional(),
  stockItems: z
    .array(
      z.object({
        id: key,
        name: z.string().trim().min(1).max(60),
        unit: z.string().trim().min(1).max(16),
        purchase: z.object({
          price: amount,
          quantity: z.number().min(0.001).max(1_000_000),
          yieldPercent: z.number().min(0.01).max(100).optional(),
        }).optional(),
        prep: z.object({
          yieldQuantity: z.number().min(0.001).max(1_000_000),
          uses: z.array(stockUse).min(1).max(20),
          extraBatchCost: amount.optional(),
        }).optional(),
        details: z.object({
          sku,
          category: stockListName("category").optional(),
          kind: stockListName("kind").min(1).optional(),
          packDescription: z.string().trim().max(120).optional(),
          supplier: stockListName("supplier").optional(),
          costUpdatedOn: z.iso.date().optional(),
          notes,
        }).optional(),
      }),
    )
    .max(100)
    .optional(),
  stockLists: z.object({
    category: z.array(stockListName("category").min(1)).optional(),
    kind: z.array(stockListName("kind").min(1)).optional(),
    supplier: z.array(stockListName("supplier").min(1)).optional(),
  }).optional(),
  pricing: z.object({ targetMargin: margin, roundingIncrement: amount.min(1) }).optional(),
  logo: z.string().max(512).regex(/^\/(?!\/)/).optional(),
  brand: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  font: z.string().regex(/^[a-z-]{1,24}$/).optional(),
  radius: z.enum(["square", "soft", "round"]).optional(),
  ink: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
});

// Stock can be counted in fractions, like 1.5 kg.
const counts = z.record(key, z.number().min(0).max(1000000));
/** A shift started on the spot when a till opens without one scheduled. */
const walkIn = z.object({
  place: z.string().trim().max(120).optional(),
  hours: z.number().int().min(1).max(24),
});
/** Coins and bills: denomination in minor units to how many. */
const cashCount = z
  .record(z.string().regex(/^[1-9]\d{0,8}$/, "Invalid coin or bill."), z.number().int().min(0).max(100000))
  .refine((c) => Object.keys(c).length <= 40, "Too many kinds of coins and bills.")
const role = z.enum(["cashier", "server", "both"]);
const tag = z.object({ id: key, name: z.string().trim().min(1).max(80) });
const booking = z.object({
  id: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  place: z
    .object({
      name: z.string().trim().min(1).max(160),
      address: z.string().trim().max(240).optional(),
      lat: z.number().min(-90).max(90).optional(),
      lon: z.number().min(-180).max(180).optional(),
    })
    .nullable(),
  organizer: tag.nullable(),
  event: tag.nullable(),
  seats: z.number().int().min(1).max(50),
  staff: z
    .array(
      z.object({
        memberId: key,
        name: z.string().max(120),
        role,
        salary: amount.optional(),
      }),
    )
    .max(50),
  rent: amount.optional(),
  quota: amount,
  incentive: amount,
});
const ownerPin = pin;
export const planCommand = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("invite"),
    name,
    email: z.string().trim().max(254),
    rate: amount,
    pin: ownerPin,
  }),
  z.object({
    action: z.literal("member"),
    memberId: z.uuid(),
    name,
    rate: amount,
    owner: z.boolean().optional(),
    pin: ownerPin,
  }),
  z.object({ action: z.literal("removeMember"), memberId: z.uuid(), pin: ownerPin }),
  z.object({
    action: z.literal("organizers"),
    organizers: z.array(tag.extend({ events: z.array(tag).max(200) })).max(200),
    pin: ownerPin,
  }),
  z.object({ action: z.literal("booking"), booking, pin: ownerPin }),
  z.object({
    action: z.literal("bulkBookings"),
    bookings: z.array(booking).min(1).max(120),
    pin: ownerPin,
  }),
  z.object({ action: z.literal("deleteBooking"), bookingId: z.uuid(), pin: ownerPin }),
  z.object({
    action: z.literal("assign"),
    bookingId: z.uuid(),
    memberId: z.uuid(),
    role,
    replace: z.uuid().optional(),
    pin: ownerPin,
  }),
  z.object({
    action: z.literal("leave"),
    bookingId: z.uuid(),
    memberId: z.uuid(),
    pin: ownerPin.optional(),
  }),
  z.object({ action: z.literal("join"), bookingId: z.uuid(), role }),
  z.object({
    action: z.literal("role"),
    bookingId: z.uuid(),
    memberId: z.uuid(),
    role,
    pin: ownerPin.optional(),
  }),
]);

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("bootstrap") }),
  z.object({
    action: z.literal("setup"),
    // Set when adding another business, so a retried request makes only one.
    id: z.uuid().optional(),
    name,
    currency: z.string().regex(/^[A-Z]{3}$/),
    timeZone: z.string().min(1).max(100),
    pin,
  }),
  z.object({
    action: z.literal("menu"),
    menu: z.array(product).max(1000),
    pin,
    deviceId: key.optional(),
    stock: counts.optional(),
  }),
  z.object({
    action: z.literal("settings"),
    deviceId: key,
    name,
    currency: z.string().regex(/^[A-Z]{3}$/),
    timeZone: z.string().min(1).max(100),
    settings,
    pin,
  }),
  z.object({
    action: z.literal("mode"),
    mode: z.enum(["simple", "advanced"]),
    pin,
  }),
  z.object({
    action: z.literal("open"),
    deviceId: key,
    openingCash: amount,
    openingCount: cashCount.optional(),
    stock: counts.default({}),
    checked: z.array(key).max(30).default([]),
    bookingId: z.uuid().optional(),
    newShift: walkIn.optional(),
  }),
  z.object({
    action: z.literal("profile"),
    // Left out: your own profile. Someone else's needs the owner and the PIN.
    memberId: z.uuid().optional(),
    name: name.optional(),
    photo: z.string().max(512).regex(/^\/api\/images\/[0-9a-f-]{36}$/).nullable().optional(),
    pin: pin.optional(),
  }),
  z.object({
    action: z.literal("link"),
    deviceId: key,
    newShift: walkIn,
  }),
  z.object({
    action: z.literal("sync"),
    deviceId: key,
    events: z.array(event).max(1000),
  }),
  z.object({
    action: z.literal("reverse"),
    deviceId: key,
    saleId: z.uuid(),
    reason: z.string().trim().min(1).max(500),
    pin,
  }),
  z.object({
    action: z.literal("close"),
    deviceId: key,
    shiftId: z.uuid(),
    countedCash: amount,
    closingCount: cashCount.optional(),
    closingStock: counts.optional(),
    pin,
  }),
]);

export function parseCommand(input: unknown) {
  const plan =
    typeof input === "object" &&
    input !== null &&
    (planActions as readonly unknown[]).includes((input as { action?: unknown }).action);
  const parsed = (plan ? planCommand : command).safeParse(input);
  if (!parsed.success) {
    // Field paths and schema rules stay on the server. The app checks forms before sending,
    // so this only happens with an outdated app or a hand-made request.
    ensure(false, "Something in that didn't look right. Check it and try again, or reload the app.");
  }
  const value = parsed.data;
  if (value.action === "settings") {
    try {
      checkSettings(value.settings);
      checkPrepRecipes(value.settings.stockItems);
      const duplicate = duplicateSku(value.settings.stockItems?.map((item) => item.details?.sku) ?? []);
      if (duplicate) throw Error(`Stock SKU ${duplicate} is already in use.`);
    } catch (error) {
      ensure(false, (error as Error).message);
    }
  }
  if (value.action === "setup" || value.action === "settings") {
    ensure(
      Intl.supportedValuesOf("currency").includes(value.currency),
      "Choose a valid currency.",
    );
    try {
      new Intl.DateTimeFormat("en", { timeZone: value.timeZone });
    } catch {
      ensure(false, "Choose a valid time zone.");
    }
  }
  if (value.action === "menu") {
    const duplicate = duplicateSku(value.menu.map((item) => item.costing?.sku));
    if (duplicate) ensure(false, `Menu SKU ${duplicate} is already in use.`);
    ensure(
      Buffer.byteLength(JSON.stringify(value.menu), "utf8") <= 350_000,
      "This menu is too large for an offline till.",
    );
    const ids = value.menu.flatMap((item) => [
      item.id,
      ...item.groups.flatMap((group) => [
        group.id,
        ...group.options.map((opt) => opt.id),
      ]),
    ]);
    ensure(
      new Set(ids).size === ids.length,
      "Two menu items or options ended up the same. Reload the app and try again.",
    );
  }
  return value;
}
