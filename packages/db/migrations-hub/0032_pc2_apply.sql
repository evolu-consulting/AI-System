-- HUB-FR-129 · HUB-FR-130 · HUB-BR-14 · PC2-R06 · PC2-R13 · PC2-R15 · PC2-R16 · P-c2 áp bản sửa (spec P-c2 §4, plan §2).
-- Viết tay, idempotent như 0021/0031 (IF NOT EXISTS / DO $$ kiểm pg_constraint·pg_policies). Chỉ THÊM bảng + nới CHECK —
-- không mất dữ liệu. (1) hub.autofix_applies (RLS "T", UPDATE theo cột C6); (2) review_tasks_reason_ck += apply_conflict,
-- apply_failed; (3) jobs_type_ck += source.apply và jobs_agent_ck cho source.apply không agent (C15).

-- ── (1) Bảng kết quả một lần Áp (≤ 1 hàng / job; job_id null khi no_changes/branch_only local) ───────────────────────
-- err_req_ck: failed/check_failed phải có error_code (C11). branch_ck khớp AUTOFIX_BRANCH_RE `ai/<run>/<stage_key>`
-- (STAGE_KEY_RE `[a-z0-9-]{1,32}`). GRANT UPDATE theo cột (status→PR) thay vì append-only — DELETE/cột khác = 42501.
CREATE TABLE IF NOT EXISTS hub.autofix_applies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  stage_run_id uuid NOT NULL,
  job_id uuid,
  autofix_result_id uuid,
  source_key text NOT NULL,
  mode text NOT NULL,
  status text NOT NULL,
  branch text,
  pin_sha text,
  target_sha text,
  head_sha text,
  rebased boolean NOT NULL DEFAULT false,
  provider text,
  pr_number integer,
  pr_url text,
  auto_merge text,
  error_code text,
  detail text,
  conflict_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  test_exit_code integer,
  test_duration_ms integer,
  test_log_attachment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autofix_applies_job_uq UNIQUE (job_id),
  CONSTRAINT autofix_applies_mode_ck CHECK (mode IN ('pr', 'auto_merge', 'branch_only')),
  CONSTRAINT autofix_applies_status_ck CHECK (status IN
    ('no_changes', 'branch_only', 'pushed', 'pr_opened', 'conflict', 'check_failed', 'failed')),
  CONSTRAINT autofix_applies_provider_ck CHECK (provider IS NULL OR provider IN ('github')),
  CONSTRAINT autofix_applies_auto_ck CHECK (auto_merge IS NULL OR auto_merge IN ('on', 'failed')),
  CONSTRAINT autofix_applies_err_ck CHECK (error_code IS NULL OR error_code IN
    ('auth', 'no_credential', 'push_rejected', 'network', 'rate_limited', 'provider_error', 'check_failed',
     'unsupported_provider')),
  CONSTRAINT autofix_applies_err_req_ck CHECK (status NOT IN ('failed', 'check_failed') OR error_code IS NOT NULL),
  CONSTRAINT autofix_applies_sha_ck CHECK ((pin_sha IS NULL OR pin_sha ~ '^[0-9a-f]{40}$')
    AND (target_sha IS NULL OR target_sha ~ '^[0-9a-f]{40}$') AND (head_sha IS NULL OR head_sha ~ '^[0-9a-f]{40}$')),
  CONSTRAINT autofix_applies_branch_ck CHECK (branch IS NULL OR branch ~ '^ai/[0-9a-f-]{36}/[a-z0-9-]{1,32}$'),
  CONSTRAINT autofix_applies_url_ck CHECK (pr_url IS NULL OR (pr_url ~ '^https://' AND length(pr_url) <= 2048)),
  CONSTRAINT autofix_applies_detail_ck CHECK (detail IS NULL OR length(detail) <= 300),
  CONSTRAINT autofix_applies_json_ck CHECK (jsonb_typeof(conflict_files) = 'array' AND jsonb_typeof(failures) = 'array'),
  CONSTRAINT autofix_applies_pushed_ck CHECK (status NOT IN ('pushed', 'pr_opened') OR head_sha IS NOT NULL),
  CONSTRAINT autofix_applies_pr_ck CHECK (status <> 'pr_opened' OR (pr_number IS NOT NULL AND provider IS NOT NULL)),
  CONSTRAINT autofix_applies_run_fk FOREIGN KEY (process_run_id, tenant_id)
    REFERENCES hub.process_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT autofix_applies_result_fk FOREIGN KEY (autofix_result_id)
    REFERENCES hub.autofix_results (id) ON DELETE SET NULL,
  CONSTRAINT autofix_applies_log_fk FOREIGN KEY (test_log_attachment_id)
    REFERENCES hub.attachments (id) ON DELETE SET NULL
);
--> statement-breakpoint
-- view/driver: WHERE stage_run_id=$1 ORDER BY created_at DESC LIMIT 1.
CREATE INDEX IF NOT EXISTS autofix_applies_stage_idx ON hub.autofix_applies (stage_run_id, created_at DESC);
--> statement-breakpoint
-- FK CASCADE từ process_runs.
CREATE INDEX IF NOT EXISTS autofix_applies_run_idx ON hub.autofix_applies (process_run_id);
--> statement-breakpoint
-- Đọc log test (PC-R14 mở rộng): test_log_attachment_id=$1 + FK SET NULL khi xoá attachment.
CREATE INDEX IF NOT EXISTS autofix_applies_log_att_idx ON hub.autofix_applies (test_log_attachment_id)
  WHERE test_log_attachment_id IS NOT NULL;
--> statement-breakpoint

-- ── RLS + GRANT (mẫu v_t 0031; agent_runtime/hub_ro KHÔNG quyền) ─────────────────────────────────────────────────────
ALTER TABLE hub.autofix_applies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'autofix_applies'
                 AND policyname = 'autofix_applies_hub_rw') THEN
    EXECUTE format('CREATE POLICY autofix_applies_hub_rw ON hub.autofix_applies FOR ALL TO hub_rw USING %s WITH CHECK %s',
      v_t, v_t);
  END IF;
END
$$;
--> statement-breakpoint
-- C6: SELECT/INSERT + UPDATE chỉ các cột push→PR; cột khác/DELETE = 42501.
GRANT SELECT, INSERT ON hub.autofix_applies TO hub_rw;
--> statement-breakpoint
GRANT UPDATE (status, provider, pr_number, pr_url, auto_merge, error_code, detail, updated_at)
  ON hub.autofix_applies TO hub_rw;
--> statement-breakpoint

-- ── (2)(3) Nới CHECK (mẫu 0021/0031): giữ đủ giá trị cũ, thêm giá trị mới cuối mảng ──────────────────────────────────
DO $$
BEGIN
  -- review_tasks_reason_ck (0019, 0021, 0031): + apply_conflict, apply_failed (DecisionReason P-c2).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_reason_ck'
                 AND conrelid = 'hub.review_tasks'::regclass AND pg_get_constraintdef(oid) LIKE '%apply_conflict%') THEN
    ALTER TABLE hub.review_tasks DROP CONSTRAINT IF EXISTS review_tasks_reason_ck;
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_reason_ck CHECK (reason IS NULL OR reason IN (
      'redo_limit', 'ask_limit', 'template_invalid', 'team_calls', 'team_tokens', 'team_time', 'team_no_change',
      'job_timeout', 'stage_tokens', 'run_tokens', 'agent_failed', 'permission_lost', 'user_inactive', 'interrupted',
      'source_unresolvable', 'back_limit', 'autofix_check_failed', 'sandbox_unavailable',
      'apply_conflict', 'apply_failed'));
  END IF;
  -- jobs_type_ck (0021): + source.apply (giữ source.resolve); C15.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_type_ck'
                 AND conrelid = 'hub.jobs'::regclass AND pg_get_constraintdef(oid) LIKE '%''source.apply''%') THEN
    ALTER TABLE hub.jobs DROP CONSTRAINT IF EXISTS jobs_type_check;
    ALTER TABLE hub.jobs DROP CONSTRAINT IF EXISTS jobs_type_ck;
    ALTER TABLE hub.jobs ADD CONSTRAINT jobs_type_ck
      CHECK (type IN ('agent.cli', 'agent.run', 'workflow.async', 'source.resolve', 'source.apply'));
  END IF;
  -- agent_id null hợp lệ cho workflow.async, source.resolve VÀ source.apply (không agent — C15).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_agent_ck'
                 AND conrelid = 'hub.jobs'::regclass AND pg_get_constraintdef(oid) LIKE '%''source.apply''%') THEN
    ALTER TABLE hub.jobs DROP CONSTRAINT IF EXISTS jobs_agent_ck;
    ALTER TABLE hub.jobs ADD CONSTRAINT jobs_agent_ck
      CHECK (type IN ('workflow.async', 'source.resolve', 'source.apply') OR agent_id IS NOT NULL);
  END IF;
END
$$;
