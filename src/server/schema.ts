import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { isNull, sql } from "drizzle-orm";
import type {
  Organizer,
  Place,
  Product,
  Role,
  StaffSlot,
  Tag,
  ReceiptLine,
  Sale,
  Settings,
  ShiftSettings,
  Tender,
} from "../lib/types";

export const register = pgSchema("portable_pos");
const money = (name: string) => bigint(name, { mode: "number" });
const date = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" });

type MenuRevision = { id: string; appliedAt: string; previousMenu: Product[] };

export const businesses = register
  .table("businesses", {
    id: uuid().primaryKey().defaultRandom(),
    // One person can own several businesses.
    ownerId: uuid("owner_id").notNull(),
    name: text().notNull(),
    currency: text().notNull(),
    timeZone: text("time_zone").notNull(),
    pinHash: text("pin_hash").notNull(),
    failedPins: integer("failed_pins").default(0).notNull(),
    lastFailedAt: date("last_failed_at"),
    menu: jsonb().$type<Product[]>().default([]).notNull(),
    // Null until the owner saves settings; read as the defaults for the currency.
    settings: jsonb().$type<Settings>(),
    organizers: jsonb().$type<Organizer[]>().default([]).notNull(),
    createdAt: date("created_at").defaultNow().notNull(),
  }, (t) => [index().on(t.ownerId)])
  .enableRLS();

export const shifts = register
  .table(
    "shifts",
    {
      id: uuid().primaryKey().defaultRandom(),
      businessId: uuid("business_id")
        .references(() => businesses.id)
        .notNull(),
      deviceId: text("device_id").notNull(),
      number: integer().notNull(),
      openedAt: date("opened_at").notNull(),
      closedAt: date("closed_at"),
      openingCash: money("opening_cash").notNull(),
      countedCash: money("counted_cash"),
      difference: money("difference"),
      menu: jsonb().$type<Product[]>().notNull(),
      menuHistory: jsonb("menu_history").$type<MenuRevision[]>().default([]).notNull(),
      soldOut: jsonb("sold_out").$type<string[]>().default([]).notNull(),
      // Null for shifts opened before settings existed (cash, QR and card).
      settings: jsonb().$type<ShiftSettings>(),
      stock: jsonb().$type<Record<string, number>>(),
      bookingId: uuid("booking_id"),
      checklist: jsonb().$type<string[]>(),
      closingStock: jsonb("closing_stock").$type<Record<string, number>>(),
      openedBy: text("opened_by"),
      openingCount: jsonb("opening_count").$type<Record<string, number>>(),
      closingCount: jsonb("closing_count").$type<Record<string, number>>(),
      usedStock: jsonb("used_stock").$type<Record<string, number>>(),
    },
    (t) => [
      unique().on(t.businessId, t.number),
      uniqueIndex("one_open_shift").on(t.businessId).where(isNull(t.closedAt)),
    ],
  )
  .enableRLS();

export const sales = register
  .table(
    "sales",
    {
      id: uuid().primaryKey(),
      shiftId: uuid("shift_id")
        .references(() => shifts.id)
        .notNull(),
      sequence: integer().notNull(),
      createdAt: date("created_at").notNull(),
      lines: jsonb().$type<ReceiptLine[]>().notNull(),
      subtotal: money("subtotal"),
      discount: jsonb().$type<NonNullable<Sale["discount"]>>(),
      total: money("total").notNull(),
      tender: text().$type<Tender>().notNull(),
      payment: jsonb().$type<Sale["payment"]>(),
      received: money("received").notNull(),
      change: money("change").notNull(),
      reversedAt: date("reversed_at"),
      reason: text(),
      // Photos of the payment or the discount ID, stored as private images.
      proofs: jsonb().$type<string[]>(),
    },
    (t) => [unique().on(t.shiftId, t.sequence)],
  )
  .enableRLS();

export const syncedEvents = register
  .table(
    "synced_events",
    {
      id: uuid().primaryKey(),
      shiftId: uuid("shift_id")
        .references(() => shifts.id)
        .notNull(),
      fingerprint: text().notNull(),
    },
    (t) => [index().on(t.shiftId)],
  )
  .enableRLS();

/** Money spent during a shift, from the till or out of someone's pocket. */
export const expenses = register
  .table(
    "expenses",
    {
      id: uuid().primaryKey(),
      shiftId: uuid("shift_id")
        .references(() => shifts.id)
        .notNull(),
      createdAt: date("created_at").notNull(),
      label: text().notNull(),
      amount: money("amount").notNull(),
      source: text().$type<"till" | "pocket">().notNull(),
      by: text(),
      voidedAt: date("voided_at"),
    },
    (t) => [index().on(t.shiftId)],
  )
  .enableRLS();

/** People on a business's team. The owner has a row too, so they can work shifts. */
export const members = register
  .table(
    "members",
    {
      id: uuid().primaryKey(),
      businessId: uuid("business_id")
        .references(() => businesses.id)
        .notNull(),
      // Null until the invited person signs in with the invited email or opens their invite link.
      userId: uuid("user_id"),
      // Empty when the owner invited them by link only.
      email: text().notNull(),
      // The code in a pending invite's /i/ link. Cleared once someone joins with it.
      inviteCode: text("invite_code"),
      name: text().notNull(),
      roles: jsonb().$type<Role[]>().notNull(),
      rate: money("rate").default(0).notNull(),
      owner: boolean().default(false).notNull(),
      // A profile photo, shown on shifts, leaderboards and shift reports.
      photo: text(),
      createdAt: date("created_at").defaultNow().notNull(),
    },
    (t) => [
      // A person can be on several businesses, once each.
      uniqueIndex("members_business_user").on(t.businessId, t.userId),
      index("members_user_index").on(t.userId),
      uniqueIndex("members_email").on(t.businessId, sql`lower(${t.email})`).where(sql`${t.email} <> ''`),
      uniqueIndex("members_invite_code").on(t.inviteCode),
    ],
  )
  .enableRLS();

/** Scheduled shifts: when and where people work, and what the slot costs. */
export const bookings = register
  .table(
    "bookings",
    {
      id: uuid().primaryKey(),
      businessId: uuid("business_id")
        .references(() => businesses.id)
        .notNull(),
      startsAt: date("starts_at").notNull(),
      endsAt: date("ends_at").notNull(),
      place: jsonb().$type<Place>(),
      organizer: jsonb().$type<Tag>(),
      event: jsonb().$type<Tag>(),
      seats: integer().notNull(),
      staff: jsonb().$type<StaffSlot[]>().default([]).notNull(),
      rent: money("rent").default(0).notNull(),
      quota: money("quota").default(0).notNull(),
      incentive: money("incentive").default(0).notNull(),
    },
    (t) => [index().on(t.businessId, t.startsAt)],
  )
  .enableRLS();

const bytes = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** Photos of menu items, checklist steps, logos and sale proofs. Served by id, which is never reused. */
export const images = register
  .table(
    "images",
    {
      id: uuid().primaryKey(),
      businessId: uuid("business_id")
        .references(() => businesses.id)
        .notNull(),
      type: text().notNull(),
      data: bytes().notNull(),
      // Proof photos are only served to people on the business.
      private: boolean().default(false).notNull(),
      createdAt: date("created_at").notNull(),
    },
    (t) => [index().on(t.businessId)],
  )
  .enableRLS();
