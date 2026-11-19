CREATE TABLE "portable_pos"."images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "portable_pos"."images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portable_pos"."images" ADD CONSTRAINT "images_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "portable_pos"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "images_business_id_index" ON "portable_pos"."images" USING btree ("business_id");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portable_pos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE portable_pos.images TO portable_pos_app;

    CREATE POLICY application_role ON portable_pos.images
      FOR ALL TO portable_pos_app USING (true) WITH CHECK (true);
  END IF;
END;
$$;
