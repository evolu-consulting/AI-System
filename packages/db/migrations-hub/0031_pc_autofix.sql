-- HUB-FR-128 · HUB-FR-130 · HUB-BR-14 · PC-R12 · PC-R14 · P-c1 tự-sửa (spec P-c §4, plan §2).
-- Viết tay, idempotent như 0021/0024 (IF NOT EXISTS / DO $$ kiểm pg_constraint/pg_policies). Chỉ THÊM bảng + nới CHECK —
-- không mất dữ liệu. (1) hub.autofix_results (append-only, RLS "T"); (2) review_tasks_reason_ck += autofix_check_failed,
-- sandbox_unavailable; (3) jobs_error_reason_check += container.

-- ── (1) Bảng kết quả một vòng tự-sửa (1 hàng / job) ──────────────────────────────────────────────────────────────────
-- diff_ck một chiều (không ok ⇒ không diff); chiều "ok ⇒ có diff" kiểm ở service vì FK attachment ON DELETE SET NULL.
-- branch_ck khớp STAGE_KEY_RE `[a-z0-9-]{1,32}` (chat/processes.ts) — đổi regex đó ⇒ migration mới sửa CHECK này.
CREATE TABLE IF NOT EXISTS hub.autofix_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  stage_run_id uuid NOT NULL,
  job_id uuid NOT NULL,
  round smallint NOT NULL,
  source_key text NOT NULL,
  pin jsonb NOT NULL,
  branch text NOT NULL,
  base_sha text NOT NULL,
  head_sha text NOT NULL,
  status text NOT NULL,
  failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  diff_stats jsonb,
  diff_attachment_id uuid,
  test_log_attachment_id uuid,
  test_exit_code integer,
  test_duration_ms integer,
  commands jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autofix_results_job_uq UNIQUE (job_id),
  CONSTRAINT autofix_results_status_ck CHECK (status IN ('ok', 'no_changes', 'check_failed')),
  CONSTRAINT autofix_results_diff_ck CHECK (status = 'ok' OR diff_attachment_id IS NULL),
  CONSTRAINT autofix_results_round_ck CHECK (round BETWEEN 1 AND 100),
  CONSTRAINT autofix_results_sha_ck CHECK (base_sha ~ '^[0-9a-f]{40}$' AND head_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT autofix_results_branch_ck CHECK (branch ~ '^ai/[0-9a-f-]{36}/[a-z0-9-]{1,32}$'),
  CONSTRAINT autofix_results_json_ck CHECK (jsonb_typeof(failures) = 'array' AND jsonb_typeof(commands) = 'array'
    AND jsonb_typeof(pin) = 'object' AND (diff_stats IS NULL OR jsonb_typeof(diff_stats) = 'object')),
  CONSTRAINT autofix_results_run_fk FOREIGN KEY (process_run_id, tenant_id)
    REFERENCES hub.process_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT autofix_results_diff_fk FOREIGN KEY (diff_attachment_id) REFERENCES hub.attachments (id) ON DELETE SET NULL,
  CONSTRAINT autofix_results_log_fk FOREIGN KEY (test_log_attachment_id) REFERENCES hub.attachments (id) ON DELETE SET NULL
);
--> statement-breakpoint
-- basePatchOf / view: WHERE stage_run_id=$1 [AND status='ok'] ORDER BY created_at DESC LIMIT 1.
CREATE INDEX IF NOT EXISTS autofix_results_stage_idx ON hub.autofix_results (stage_run_id, created_at DESC);
--> statement-breakpoint
-- FK CASCADE từ process_runs.
CREATE INDEX IF NOT EXISTS autofix_results_run_idx ON hub.autofix_results (process_run_id);
--> statement-breakpoint
-- Đọc file (plan §6.6): diff_attachment_id=$1 OR test_log_attachment_id=$1 (BitmapOr) + FK SET NULL khi xoá attachment.
CREATE INDEX IF NOT EXISTS autofix_results_diff_att_idx ON hub.autofix_results (diff_attachment_id)
  WHERE diff_attachment_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS autofix_results_log_att_idx ON hub.autofix_results (test_log_attachment_id)
  WHERE test_log_attachment_id IS NOT NULL;
--> statement-breakpoint

-- ── RLS + GRANT (mẫu v_t 0021; append-only như source_job_reads; agent_runtime/hub_ro KHÔNG quyền) ─────────────────
ALTER TABLE hub.autofix_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'autofix_results'
                 AND policyname = 'autofix_results_hub_rw') THEN
    EXECUTE format('CREATE POLICY autofix_results_hub_rw ON hub.autofix_results FOR ALL TO hub_rw USING %s WITH CHECK %s',
      v_t, v_t);
  END IF;
END
$$;
--> statement-breakpoint
-- Chỉ SELECT/INSERT ⇒ UPDATE/DELETE = 42501 (PC-R12 append-only).
GRANT SELECT, INSERT ON hub.autofix_results TO hub_rw;
--> statement-breakpoint

-- ── (2)(3) Nới CHECK (mẫu 0024): giữ đủ giá trị cũ, thêm giá trị mới cuối mảng ───────────────────────────────────────
DO $$
BEGIN
  -- review_tasks_reason_ck (0019, 0021, 0024): DecisionReason P-c (PC-R10).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_reason_ck'
                 AND conrelid = 'hub.review_tasks'::regclass AND pg_get_constraintdef(oid) LIKE '%sandbox_unavailable%') THEN
    ALTER TABLE hub.review_tasks DROP CONSTRAINT IF EXISTS review_tasks_reason_ck;
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_reason_ck CHECK (reason IS NULL OR reason IN (
      'redo_limit', 'ask_limit', 'template_invalid', 'team_calls', 'team_tokens', 'team_time', 'team_no_change',
      'job_timeout', 'stage_tokens', 'run_tokens', 'agent_failed', 'permission_lost', 'user_inactive', 'interrupted',
      'source_unresolvable', 'back_limit', 'autofix_check_failed', 'sandbox_unavailable'));
  END IF;
  -- jobs_error_reason_check (0000, 0004, 0006, 0007): lỗi container sandbox Runtime (WRK-FR-29).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_error_reason_check'
                 AND conrelid = 'hub.jobs'::regclass AND pg_get_constraintdef(oid) LIKE '%''container''%') THEN
    ALTER TABLE hub.jobs DROP CONSTRAINT IF EXISTS jobs_error_reason_check;
    ALTER TABLE hub.jobs ADD CONSTRAINT jobs_error_reason_check CHECK (
      error_reason IS NULL
      OR error_reason IN ('quota', 'tenant_slots', 'provider_busy', 'provider_unavailable', 'orphaned', 'crash',
                          'cancelled', 'timeout', 'invalid_payload', 'invalid_output', 'sandbox', 'credential',
                          'upstream', 'refused', 'attachment', 'container')
    );
  END IF;
END
$$;
