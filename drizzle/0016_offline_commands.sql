CREATE TABLE "portable_pos"."offline_commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"fingerprint" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portable_pos"."offline_commands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portable_pos"."offline_commands" ADD CONSTRAINT "offline_commands_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "portable_pos"."businesses"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portable_pos_app') THEN
    GRANT SELECT, INSERT ON portable_pos.offline_commands TO portable_pos_app;
    CREATE POLICY application_role_read ON portable_pos.offline_commands FOR SELECT TO portable_pos_app USING (true);
    CREATE POLICY application_role_insert ON portable_pos.offline_commands FOR INSERT TO portable_pos_app WITH CHECK (true);
  END IF;
END;
$$;
