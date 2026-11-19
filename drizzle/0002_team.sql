CREATE TABLE "portable_pos"."bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"place" jsonb,
	"organizer" jsonb,
	"event" jsonb,
	"seats" integer NOT NULL,
	"staff" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rent" bigint DEFAULT 0 NOT NULL,
	"quota" bigint DEFAULT 0 NOT NULL,
	"incentive" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portable_pos"."bookings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "portable_pos"."members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"roles" jsonb NOT NULL,
	"rate" bigint DEFAULT 0 NOT NULL,
	"owner" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portable_pos"."members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portable_pos"."businesses" ADD COLUMN "organizers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "portable_pos"."shifts" ADD COLUMN "stock" jsonb;--> statement-breakpoint
ALTER TABLE "portable_pos"."shifts" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "portable_pos"."shifts" ADD COLUMN "checklist" jsonb;--> statement-breakpoint
ALTER TABLE "portable_pos"."bookings" ADD CONSTRAINT "bookings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "portable_pos"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portable_pos"."members" ADD CONSTRAINT "members_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "portable_pos"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_business_id_starts_at_index" ON "portable_pos"."bookings" USING btree ("business_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "members_user" ON "portable_pos"."members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_email" ON "portable_pos"."members" USING btree ("business_id",lower("email"));