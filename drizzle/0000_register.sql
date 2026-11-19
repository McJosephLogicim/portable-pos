CREATE SCHEMA "portable_pos";
--> statement-breakpoint
CREATE TABLE "portable_pos"."businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"time_zone" text NOT NULL,
	"pin_hash" text NOT NULL,
	"failed_pins" integer DEFAULT 0 NOT NULL,
	"last_failed_at" timestamp with time zone,
	"menu" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "businesses_owner_id_unique" UNIQUE("owner_id")
);
--> statement-breakpoint
ALTER TABLE "portable_pos"."businesses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "portable_pos"."sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shift_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"lines" jsonb NOT NULL,
	"total" bigint NOT NULL,
	"tender" text NOT NULL,
	"received" bigint NOT NULL,
	"change" bigint NOT NULL,
	"reversed_at" timestamp with time zone,
	"reason" text,
	CONSTRAINT "sales_shift_id_sequence_unique" UNIQUE("shift_id","sequence")
);
--> statement-breakpoint
ALTER TABLE "portable_pos"."sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "portable_pos"."shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"number" integer NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"opening_cash" bigint NOT NULL,
	"counted_cash" bigint,
	"difference" bigint,
	"menu" jsonb NOT NULL,
	"sold_out" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "shifts_business_id_number_unique" UNIQUE("business_id","number")
);
--> statement-breakpoint
ALTER TABLE "portable_pos"."shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "portable_pos"."synced_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shift_id" uuid NOT NULL,
	"fingerprint" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portable_pos"."synced_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portable_pos"."sales" ADD CONSTRAINT "sales_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "portable_pos"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portable_pos"."shifts" ADD CONSTRAINT "shifts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "portable_pos"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portable_pos"."synced_events" ADD CONSTRAINT "synced_events_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "portable_pos"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_shift" ON "portable_pos"."shifts" USING btree ("business_id") WHERE "portable_pos"."shifts"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "synced_events_shift_id_index" ON "portable_pos"."synced_events" USING btree ("shift_id");