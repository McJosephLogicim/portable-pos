DROP INDEX "portable_pos"."one_open_shift";--> statement-breakpoint
ALTER TABLE "portable_pos"."shifts" ADD COLUMN "left_stock" jsonb;--> statement-breakpoint
ALTER TABLE "portable_pos"."shifts" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_booking" ON "portable_pos"."shifts" USING btree ("business_id","booking_id") WHERE "portable_pos"."shifts"."closed_at" is null;