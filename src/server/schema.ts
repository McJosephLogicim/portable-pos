import {
  bigint,
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
import { isNull } from "drizzle-orm";
import type { Product, ReceiptLine, Tender } from "../lib/types";

export const register = pgSchema("portable_pos");
const money = (name: string) => bigint(name, { mode: "number" });
const date = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "string" });

export const businesses = register
  .table("businesses", {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").unique().notNull(),
    name: text().notNull(),
    currency: text().notNull(),
    timeZone: text("time_zone").notNull(),
    pinHash: text("pin_hash").notNull(),
    failedPins: integer("failed_pins").default(0).notNull(),
    lastFailedAt: date("last_failed_at"),
    menu: jsonb().$type<Product[]>().default([]).notNull(),
  })
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
      soldOut: jsonb("sold_out").$type<string[]>().default([]).notNull(),
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
      total: money("total").notNull(),
      tender: text().$type<Tender>().notNull(),
      received: money("received").notNull(),
      change: money("change").notNull(),
      reversedAt: date("reversed_at"),
      reason: text(),
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
