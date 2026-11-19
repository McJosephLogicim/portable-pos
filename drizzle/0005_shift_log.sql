CREATE TABLE "portable_pos"."expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shift_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"label" text NOT NULL,
	"amount" bigint NOT NULL,
	"source" text NOT NULL,
	"by" text,
	"voided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "portable_pos"."expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portable_pos"."shifts" ADD COLUMN "closing_stock" jsonb;--> statement-breakpoint
ALTER TABLE "portable_pos"."shifts" ADD COLUMN "opened_by" text;--> statement-breakpoint
ALTER TABLE "portable_pos"."shifts" ADD COLUMN "opening_count" jsonb;--> statement-breakpoint
ALTER TABLE "portable_pos"."shifts" ADD COLUMN "closing_count" jsonb;--> statement-breakpoint
ALTER TABLE "portable_pos"."shifts" ADD COLUMN "used_stock" jsonb;--> statement-breakpoint
ALTER TABLE "portable_pos"."expenses" ADD CONSTRAINT "expenses_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "portable_pos"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_shift_id_index" ON "portable_pos"."expenses" USING btree ("shift_id");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portable_pos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE portable_pos.expenses TO portable_pos_app;

    CREATE POLICY application_role ON portable_pos.expenses
      FOR ALL TO portable_pos_app USING (true) WITH CHECK (true);
  END IF;
END;
$$;
