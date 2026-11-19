import { z } from "zod";
import { checkSettings } from "../lib/settings";
import { planActions } from "../lib/team";
import { ensure } from "./errors";

const key = z.string().trim().min(1).max(128);
const name = z.string().trim().min(1).max(120);
const pin = z.string().regex(/^\d{4,8}$/, "Use a 4 to 8 digit owner PIN.");
const amount = z.number().int().min(0).max(2147483647);
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
});
const line = z.object({
  productId: key,
  optionIds: z.array(key).max(256),
  quantity: z.number().int().min(1).max(999),
});

// Only accept a cart and tender as sale inputs. Descriptive fields and prices are
// always taken from the immutable shift snapshot, including after an offline sync.
const sale = z.object({
  id: z.uuid(),
  shiftId: z.uuid(),
  sequence: z.number().int().positive().max(2147483647),
  createdAt: z.iso.datetime({ offset: true }),
  lines: z.array(line).min(1).max(500),
  tender: key,
  // Only the discount's id is trusted. Its amount is recomputed from the shift.
  discount: z.object({ id: key }).optional(),
  received: amount,
});
const event = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sale"), id: z.uuid(), shiftId: z.uuid(), sale }),
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
      }),
    )
    .max(24),
  checklist: z
    .array(z.object({ id: key, text: z.string().trim().min(1).max(120) }))
    .max(30)
    .optional(),
});

const counts = z.record(key, z.number().int().min(0).max(99999));
const role = z.enum(["cashier", "server"]);
const roles = z.array(role).min(1, "Pick cashier, server, or both.").max(2);
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
    roles,
    rate: amount,
    pin: ownerPin,
  }),
  z.object({
    action: z.literal("member"),
    memberId: z.uuid(),
    name,
    roles,
    rate: amount,
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
]);

const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("bootstrap") }),
  z.object({
    action: z.literal("setup"),
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
    action: z.literal("open"),
    deviceId: key,
    openingCash: amount,
    stock: counts.default({}),
    checked: z.array(key).max(30).default([]),
    bookingId: z.uuid().optional(),
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
    const issue = parsed.error.issues[0];
    ensure(
      false,
      `Check ${issue.path.join(".") || "the request"}. ${issue.message}`,
    );
  }
  const value = parsed.data;
  if (value.action === "settings") {
    try {
      checkSettings(value.settings);
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
      "Each menu item and option needs a unique identifier.",
    );
  }
  return value;
}
