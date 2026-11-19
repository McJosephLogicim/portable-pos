ALTER TABLE "portable_pos"."businesses" ADD COLUMN "settings" jsonb;--> statement-breakpoint
ALTER TABLE "portable_pos"."sales" ADD COLUMN "subtotal" bigint;--> statement-breakpoint
ALTER TABLE "portable_pos"."sales" ADD COLUMN "discount" jsonb;--> statement-breakpoint
ALTER TABLE "portable_pos"."sales" ADD COLUMN "payment" jsonb;--> statement-breakpoint
ALTER TABLE "portable_pos"."shifts" ADD COLUMN "settings" jsonb;