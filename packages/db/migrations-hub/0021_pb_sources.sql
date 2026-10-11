-- HUB-FR-120…122 · ADM-FR-68 · WRK-FR-27 · PB-R05/R11/R17/R20 · CR-060 · nguồn tham chiếu (spec §4, plan §5).
-- Viết tay, idempotent như 0019 (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / DO $$ kiểm pg_constraint·pg_policies).
-- Chỉ THÊM bảng/cột nullable + nới CHECK + bỏ NOT NULL vài cột hub.jobs cho job `source.resolve` (không run) — không mất dữ liệu.

-- ── (1) hub.sources (RLS "T") ────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  kind text NOT NULL,
  config jsonb NOT NULL,
  description text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  last_pin jsonb,
  last_pin_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT sources_key_ck CHECK (key ~ '^[a-z0-9-]{2,32}$'),
  CONSTRAINT sources_kind_ck CHECK (kind IN ('git_remote', 'local_path', 'library')),
  CONSTRAINT sources_config_ck CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT sources_desc_ck CHECK (char_length(description) <= 500),
  CONSTRAINT sources_version_ck CHECK (version >= 1),
  CONSTRAINT sources_last_pin_ck CHECK (last_pin IS NULL OR jsonb_typeof(last_pin) = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sources_tenant_key_uq ON hub.sources (tenant_id, key) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sources_tenant_idx ON hub.sources (tenant_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

-- ── (2) hub.source_job_reads (audit append-only, RLS "T", PB-R11) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.source_job_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  stage_run_id uuid NOT NULL,
  job_id uuid NOT NULL,
  source_id uuid NOT NULL,
  source_key text NOT NULL,
  pin jsonb NOT NULL,
  files_read text[],
  bytes_read bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_job_reads_pin_ck CHECK (jsonb_typeof(pin) = 'object'),
  CONSTRAINT source_job_reads_run_fk FOREIGN KEY (process_run_id, tenant_id)
    REFERENCES hub.process_runs (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS source_job_reads_run_idx ON hub.source_job_reads (process_run_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS source_job_reads_source_idx ON hub.source_job_reads (source_id);
--> statement-breakpoint

-- ── (3) Cột nullable thêm (không default ⇒ hàng cũ không đổi) ─────────────────────────────────────────────────────────
ALTER TABLE hub.process_defs ADD COLUMN IF NOT EXISTS sources jsonb;
--> statement-breakpoint
ALTER TABLE hub.process_defs ADD COLUMN IF NOT EXISTS inputs jsonb;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS pinned_sources jsonb;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS sources_pinned_at timestamptz;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS inputs jsonb;
--> statement-breakpoint
DO $$
BEGIN
  -- Cột là MẢNG JSON. App (drizzle) lưu mảng thật ⇒ jsonb_typeof='array'. Kênh kiểm tra DB ghi qua `$1::jsonb`+JSON.stringify
  -- lưu jsonb-STRING ("[]"/"{}") ⇒ xét theo giá trị đã giải mã (D-07): array ok, object chặn.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_defs_sources_ck'
                 AND conrelid = 'hub.process_defs'::regclass) THEN
    ALTER TABLE hub.process_defs ADD CONSTRAINT process_defs_sources_ck CHECK (sources IS NULL OR
      jsonb_typeof(CASE WHEN jsonb_typeof(sources) = 'string'
                        THEN (sources #>> '{}')::jsonb ELSE sources END) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_defs_inputs_ck'
                 AND conrelid = 'hub.process_defs'::regclass) THEN
    ALTER TABLE hub.process_defs ADD CONSTRAINT process_defs_inputs_ck CHECK (inputs IS NULL OR
      jsonb_typeof(CASE WHEN jsonb_typeof(inputs) = 'string'
                        THEN (inputs #>> '{}')::jsonb ELSE inputs END) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_runs_pinned_sources_ck'
                 AND conrelid = 'hub.process_runs'::regclass) THEN
    ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_pinned_sources_ck
      CHECK (pinned_sources IS NULL OR jsonb_typeof(pinned_sources) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_runs_inputs_ck'
                 AND conrelid = 'hub.process_runs'::regclass) THEN
    ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_inputs_ck
      CHECK (inputs IS NULL OR jsonb_typeof(inputs) = 'array');
  END IF;
END
$$;
--> statement-breakpoint

-- ── (4) hub.jobs: job `source.resolve` (không run/agent/provider) ────────────────────────────────────────────────────
ALTER TABLE hub.jobs ALTER COLUMN run_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE hub.jobs ALTER COLUMN step_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE hub.jobs ALTER COLUMN conversation_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE hub.jobs ALTER COLUMN provider_key DROP NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  -- jobs_type_ck (tên mới, gồm source.resolve): bỏ cả jobs_type_check cũ (0002) lẫn jobs_type_ck.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_type_ck'
                 AND conrelid = 'hub.jobs'::regclass AND pg_get_constraintdef(oid) LIKE '%''source.resolve''%') THEN
    ALTER TABLE hub.jobs DROP CONSTRAINT IF EXISTS jobs_type_check;
    ALTER TABLE hub.jobs DROP CONSTRAINT IF EXISTS jobs_type_ck;
    ALTER TABLE hub.jobs ADD CONSTRAINT jobs_type_ck
      CHECK (type IN ('agent.cli', 'agent.run', 'workflow.async', 'source.resolve'));
  END IF;
  -- agent_id null hợp lệ cho workflow.async VÀ source.resolve.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_agent_ck'
                 AND conrelid = 'hub.jobs'::regclass AND pg_get_constraintdef(oid) LIKE '%''source.resolve''%') THEN
    ALTER TABLE hub.jobs DROP CONSTRAINT IF EXISTS jobs_agent_ck;
    ALTER TABLE hub.jobs ADD CONSTRAINT jobs_agent_ck
      CHECK (type IN ('workflow.async', 'source.resolve') OR agent_id IS NOT NULL);
  END IF;
  -- review_tasks_reason_ck (0019): thêm source_unresolvable (DecisionReason mới).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_reason_ck'
                 AND conrelid = 'hub.review_tasks'::regclass AND pg_get_constraintdef(oid) LIKE '%source_unresolvable%') THEN
    ALTER TABLE hub.review_tasks DROP CONSTRAINT IF EXISTS review_tasks_reason_ck;
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_reason_ck CHECK (reason IS NULL OR reason IN (
      'redo_limit', 'ask_limit', 'template_invalid', 'team_calls', 'team_tokens', 'team_time', 'team_no_change',
      'job_timeout', 'stage_tokens', 'run_tokens', 'agent_failed', 'permission_lost', 'user_inactive', 'interrupted',
      'source_unresolvable'));
  END IF;
  -- attachments.origin += library (kho H2c dùng lại cho nguồn library, PB-R04).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attachments_origin_check'
                 AND conrelid = 'hub.attachments'::regclass AND pg_get_constraintdef(oid) LIKE '%''library''%') THEN
    ALTER TABLE hub.attachments DROP CONSTRAINT IF EXISTS attachments_origin_check;
    ALTER TABLE hub.attachments ADD CONSTRAINT attachments_origin_check
      CHECK (origin IN ('upload', 'output', 'library'));
  END IF;
END
$$;
--> statement-breakpoint

-- ── (5) RLS + GRANT (mẫu v_t như 0019; agent_runtime KHÔNG quyền) ────────────────────────────────────────────────────
ALTER TABLE hub.sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE hub.source_job_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'sources'
                 AND policyname = 'sources_hub_rw') THEN
    EXECUTE format('CREATE POLICY sources_hub_rw ON hub.sources FOR ALL TO hub_rw USING %s WITH CHECK %s', v_t, v_t);
  END IF;
  -- audit: FOR ALL ở RLS; chỉ GRANT SELECT/INSERT ⇒ UPDATE/DELETE = 42501 (append-only, PB-R11).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'source_job_reads'
                 AND policyname = 'source_job_reads_hub_rw') THEN
    EXECUTE format('CREATE POLICY source_job_reads_hub_rw ON hub.source_job_reads FOR ALL TO hub_rw USING %s WITH CHECK %s',
      v_t, v_t);
  END IF;
END
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.sources TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON hub.source_job_reads TO hub_rw;
