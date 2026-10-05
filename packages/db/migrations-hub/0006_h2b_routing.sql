-- HUB-FR-91 · HUB-FR-94 · HUB-FR-62 · plan H2b §3, plan-db §1 (D1): run gọi thẳng agent (kind='direct', Q1=B responder),
-- Orchestrator theo tenant (R13–R15), giới hạn run đang chạy theo user (R16, index), lý do job `refused` (F4, R27).
-- Viết tay, idempotent (IF NOT EXISTS; đổi CHECK qua DO $$ … pg_constraint): chạy được trên DB sạch và DB đã có 0005.
-- Chỉ nới tập giá trị / thêm cột NULL / thêm index — không mất dữ liệu. RLS/GRANT không đổi (plan-db §1).

-- ── runs: agent_id (direct), orchestrator_tenant_id, responder_* ─────────────────────────────────────────────────────
ALTER TABLE hub.runs ADD COLUMN IF NOT EXISTS agent_id uuid,
  ADD COLUMN IF NOT EXISTS orchestrator_tenant_id uuid,
  ADD COLUMN IF NOT EXISTS responder_key text,
  ADD COLUMN IF NOT EXISTS responder_name text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_kind_check' AND conrelid = 'hub.runs'::regclass
                 AND pg_get_constraintdef(oid) LIKE '%''direct''%') THEN
    ALTER TABLE hub.runs DROP CONSTRAINT IF EXISTS runs_kind_check;
    ALTER TABLE hub.runs ADD CONSTRAINT runs_kind_check CHECK (kind IN ('orchestrated', 'command', 'direct'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_direct_ck' AND conrelid = 'hub.runs'::regclass) THEN
    ALTER TABLE hub.runs ADD CONSTRAINT runs_direct_ck CHECK ((kind = 'direct') = (agent_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_responder_ck' AND conrelid = 'hub.runs'::regclass) THEN
    ALTER TABLE hub.runs ADD CONSTRAINT runs_responder_ck CHECK (
      (kind = 'direct') = (responder_key IS NOT NULL)
      AND (responder_key IS NULL) = (responder_name IS NULL)
      AND (responder_name IS NULL OR char_length(responder_name) BETWEEN 1 AND 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_orch_tenant_ck' AND conrelid = 'hub.runs'::regclass) THEN
    ALTER TABLE hub.runs ADD CONSTRAINT runs_orch_tenant_ck CHECK (
      orchestrator_tenant_id IS NULL OR (kind = 'orchestrated' AND orchestrator_tenant_id = tenant_id));
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runs_user_running_idx ON hub.runs (tenant_id, user_id) WHERE status = 'running';
--> statement-breakpoint

-- ── orchestrator_settings: hàng mặc định id=1 (tenant_id NULL), hàng tenant id từ sequence (R13–R15, P6) ──────────
ALTER TABLE hub.orchestrator_settings ADD COLUMN IF NOT EXISTS tenant_id uuid;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS hub.orchestrator_settings_id_seq AS smallint START WITH 2 MINVALUE 2
  OWNED BY hub.orchestrator_settings.id;
--> statement-breakpoint
ALTER TABLE hub.orchestrator_settings ALTER COLUMN id SET DEFAULT nextval('hub.orchestrator_settings_id_seq');
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE hub.orchestrator_settings DROP CONSTRAINT IF EXISTS orchestrator_settings_id_check;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orchestrator_settings_scope_ck'
                 AND conrelid = 'hub.orchestrator_settings'::regclass) THEN
    ALTER TABLE hub.orchestrator_settings ADD CONSTRAINT orchestrator_settings_scope_ck
      CHECK ((id = 1) = (tenant_id IS NULL));
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_settings_tenant_uq ON hub.orchestrator_settings (tenant_id)
  WHERE tenant_id IS NOT NULL;
--> statement-breakpoint

-- ── jobs: lý do `refused` (F4, R27) — tập 0004 + refused (= JOB_FAIL_REASONS sau C2) ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_error_reason_check'
                 AND conrelid = 'hub.jobs'::regclass AND pg_get_constraintdef(oid) LIKE '%''refused''%') THEN
    ALTER TABLE hub.jobs DROP CONSTRAINT IF EXISTS jobs_error_reason_check;
    ALTER TABLE hub.jobs ADD CONSTRAINT jobs_error_reason_check CHECK (
      error_reason IS NULL
      OR error_reason IN ('quota', 'tenant_slots', 'provider_busy', 'provider_unavailable', 'orphaned', 'crash',
                          'cancelled', 'timeout', 'invalid_payload', 'invalid_output', 'sandbox', 'credential',
                          'upstream', 'refused')
    );
  END IF;
END
$$;
