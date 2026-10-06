-- HUB-FR-78 · HUB-FR-87 · H3b-R08, R16, R22 (plan-db H3b §1): audit Hub append-only, quyền ghi grant cho hub_rw, index trace.
CREATE TABLE IF NOT EXISTS hub.audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid NOT NULL,
  actor_id uuid,
  actor_username text,
  actor_role text,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  entity_name text NOT NULL DEFAULT '',
  hub_config_version integer,
  before jsonb,
  after jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT hub_audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT hub_audit_log_seq_uq UNIQUE (seq),
  CONSTRAINT hub_audit_log_action_check CHECK (action IN ('grant', 'revoke', 'view_trace')),
  CONSTRAINT hub_audit_log_entity_check CHECK (entity IN ('agent_grant', 'run')),
  CONSTRAINT hub_audit_log_actor_role_check
    CHECK (actor_role IS NULL OR actor_role IN ('platform_admin', 'tenant_admin', 'member')),
  CONSTRAINT hub_audit_log_entity_name_check CHECK (char_length(entity_name) <= 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS hub_audit_log_tenant_seq_idx ON hub.audit_log (tenant_id, seq DESC);
CREATE INDEX IF NOT EXISTS hub_audit_log_entity_seq_idx ON hub.audit_log (entity, entity_id, seq DESC);
CREATE INDEX IF NOT EXISTS hub_audit_log_actor_seq_idx ON hub.audit_log (actor_id, seq DESC);
--> statement-breakpoint
-- Append-only cả với owner (như admin.audit_log M4-R11): UPDATE/DELETE theo hàng + TRUNCATE theo câu → P0001.
CREATE OR REPLACE FUNCTION hub.audit_log_append_only() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'hub.audit_log is append-only (%)', TG_OP;
END $$;
REVOKE ALL ON FUNCTION hub.audit_log_append_only() FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_audit_log_append_only'
                 AND tgrelid = 'hub.audit_log'::regclass) THEN
    CREATE TRIGGER hub_audit_log_append_only BEFORE UPDATE OR DELETE ON hub.audit_log
      FOR EACH ROW EXECUTE FUNCTION hub.audit_log_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_audit_log_append_only_truncate'
                 AND tgrelid = 'hub.audit_log'::regclass) THEN
    CREATE TRIGGER hub_audit_log_append_only_truncate BEFORE TRUNCATE ON hub.audit_log
      FOR EACH STATEMENT EXECUTE FUNCTION hub.audit_log_append_only();
  END IF;
END $$;
--> statement-breakpoint
-- Trace (R18): usage theo run — usage_logs chỉ có index (tenant_id, at)/(job_id). Bảng nhỏ ở dev; prod: xem PRODUCTION-NOTES (I3).
CREATE INDEX IF NOT EXISTS usage_logs_run_idx ON hub.usage_logs (run_id) WHERE run_id IS NOT NULL;
--> statement-breakpoint
-- R08, R22 (PL2): hub_rw ghi grant + khoá/tăng hub_config_version (UPDATE chỉ một cột; FOR UPDATE cần quyền UPDATE).
GRANT INSERT, DELETE ON hub.agent_grants TO hub_rw;
GRANT UPDATE (hub_config_version) ON hub.config_meta TO hub_rw;
GRANT SELECT, INSERT ON hub.audit_log TO hub_rw;
