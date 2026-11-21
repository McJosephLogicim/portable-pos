CREATE TABLE "portable_pos"."completed_onboarding" (
	"user_id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portable_pos"."completed_onboarding" ENABLE ROW LEVEL SECURITY;