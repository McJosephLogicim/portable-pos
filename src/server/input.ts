import { z } from "zod";
import { checkSettings } from "../lib/settings";
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
});

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
  z.object({ action: z.literal("open"), deviceId: key, openingCash: amount }),
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
  const parsed = command.safeParse(input);
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
