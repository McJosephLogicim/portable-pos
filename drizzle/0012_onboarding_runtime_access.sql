-- Custom SQL migration file, put your code below! --
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'portable_pos_app') THEN
    GRANT SELECT, INSERT ON TABLE portable_pos.completed_onboarding TO portable_pos_app;

    CREATE POLICY application_role_read ON portable_pos.completed_onboarding
      FOR SELECT TO portable_pos_app USING (true);
    CREATE POLICY application_role_insert ON portable_pos.completed_onboarding
      FOR INSERT TO portable_pos_app WITH CHECK (true);
  END IF;
END;
$$;
