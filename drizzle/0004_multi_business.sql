ALTER TABLE "portable_pos"."businesses" DROP CONSTRAINT "businesses_owner_id_unique";--> statement-breakpoint
DROP INDEX "portable_pos"."members_user";--> statement-breakpoint
ALTER TABLE "portable_pos"."businesses" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "portable_pos"."images" ADD COLUMN "private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "portable_pos"."members" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "portable_pos"."sales" ADD COLUMN "proofs" jsonb;--> statement-breakpoint
CREATE INDEX "businesses_owner_id_index" ON "portable_pos"."businesses" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_business_user" ON "portable_pos"."members" USING btree ("business_id","user_id");--> statement-breakpoint
CREATE INDEX "members_user_index" ON "portable_pos"."members" USING btree ("user_id");