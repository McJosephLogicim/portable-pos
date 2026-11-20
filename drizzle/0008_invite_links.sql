DROP INDEX "portable_pos"."members_email";--> statement-breakpoint
ALTER TABLE "portable_pos"."members" ADD COLUMN "invite_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "members_invite_code" ON "portable_pos"."members" USING btree ("invite_code");--> statement-breakpoint
CREATE UNIQUE INDEX "members_email" ON "portable_pos"."members" USING btree ("business_id",lower("email")) WHERE "portable_pos"."members"."email" <> '';--> statement-breakpoint
-- Pending invites from before invite links get a link too.
DO $$
DECLARE
  digits constant text := '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  r record;
  code text;
BEGIN
  FOR r IN SELECT id FROM "portable_pos"."members" WHERE "user_id" IS NULL AND "invite_code" IS NULL LOOP
    LOOP
      code := '';
      FOR i IN 1..8 LOOP
        code := code || substr(digits, 1 + floor(random() * 62)::int, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "portable_pos"."members" WHERE "invite_code" = code);
    END LOOP;
    UPDATE "portable_pos"."members" SET "invite_code" = code WHERE id = r.id;
  END LOOP;
END $$;
