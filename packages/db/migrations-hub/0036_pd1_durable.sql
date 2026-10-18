-- HUB-FR-143 · HUB-FR-144 · HUB-FR-145 · HUB-FR-115 · P-d1 engine chạy bền (spec P-d §4, plan-db §1, plan-addendum A10).
-- Viết tay, idempotent như 0024/0032 (IF NOT EXISTS / DO $$ kiểm pg_constraint·pg_policies; CHECK dựng lại chỉ khi chưa
-- chứa giá trị mới). Chỉ THÊM cột/bảng/index, DROP NOT NULL, dựng lại CHECK nới enum — không mất dữ liệu. Hàng cũ:
-- ttl_days = 7, retry_count = 0, remind_count = 0 (DEFAULT) — thoả CHECK mới. `unread` theo lô dùng
-- `process_notices_unread_idx` (0019) sẵn có — KHÔNG thêm index (readiness #84).

-- ── (1) process_defs.ttl_days (NULL = không hết hạn — PD-R24) ─────────────────────────────────────────────────────────
ALTER TABLE hub.process_defs ADD COLUMN IF NOT EXISTS ttl_days smallint DEFAULT 7;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_defs_ttl_ck'
                 AND conrelid = 'hub.process_defs'::regclass) THEN
    ALTER TABLE hub.process_defs ADD CONSTRAINT process_defs_ttl_ck
      CHECK (ttl_days IS NULL OR ttl_days BETWEEN 1 AND 365);
  END IF;
END
$$;
--> statement-breakpoint

-- ── (2) process_runs.expires_at nullable + index hết hạn mới (tập active 5 trạng thái gồm waiting_timer) ─────────────
-- process_runs_active_idx (0019) GIỮ: predicate = PROCESS_RUN_CAP_COUNTED (đếm trần không tính waiting_timer, PD-R16).
ALTER TABLE hub.process_runs ALTER COLUMN expires_at DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_runs_expiring_idx ON hub.process_runs (expires_at)
  WHERE expires_at IS NOT NULL
    AND status IN ('running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer');
--> statement-breakpoint
DROP INDEX IF EXISTS hub.process_runs_expires_idx;
--> statement-breakpoint

-- ── (3) stage_runs: thử lại (giá trị chỉ hiệu lực khi retry_attempt/retry_round = attempt/round — plan §4.2) ─────────
ALTER TABLE hub.stage_runs ADD COLUMN IF NOT EXISTS retry_count smallint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE hub.stage_runs ADD COLUMN IF NOT EXISTS retry_attempt smallint;
--> statement-breakpoint
ALTER TABLE hub.stage_runs ADD COLUMN IF NOT EXISTS retry_round smallint;
--> statement-breakpoint
-- PD-R05: mốc bắt đầu cửa sổ "đã gửi side_effect".
ALTER TABLE hub.stage_runs ADD COLUMN IF NOT EXISTS retry_since timestamptz;
--> statement-breakpoint
ALTER TABLE hub.stage_runs ADD COLUMN IF NOT EXISTS last_error_code text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_runs_retry_ck'
                 AND conrelid = 'hub.stage_runs'::regclass) THEN
    ALTER TABLE hub.stage_runs ADD CONSTRAINT stage_runs_retry_ck CHECK (retry_count BETWEEN 0 AND 3
      AND (last_error_code IS NULL OR char_length(last_error_code) <= 64));
  END IF;
  -- Đích FK kép (stage_run_id, tenant_id) của process_timers (0019 chỉ có PK).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_runs_id_tenant_uq'
                 AND conrelid = 'hub.stage_runs'::regclass) THEN
    ALTER TABLE hub.stage_runs ADD CONSTRAINT stage_runs_id_tenant_uq UNIQUE (id, tenant_id);
  END IF;
END
$$;
--> statement-breakpoint

-- ── (4) review_tasks: nhắc lặp + chuyển cấp (chép từ snapshot lúc tạo task review — PD-R19) ─────────────────────────
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS remind_count smallint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS remind_every_h smallint;
--> statement-breakpoint
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS escalate_at timestamptz;
--> statement-breakpoint
-- admin.groups — không FK chéo schema (0019 P3); cùng tenant kiểm ở luật lưu + lúc chuyển (S2).
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS escalate_group_id uuid;
--> statement-breakpoint
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS escalated_at timestamptz;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_remind_ck'
                 AND conrelid = 'hub.review_tasks'::regclass) THEN
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_remind_ck CHECK (remind_count BETWEEN 0 AND 10
      AND (remind_every_h IS NULL OR remind_every_h BETWEEN 4 AND 168)
      AND ((escalate_at IS NULL) = (escalate_group_id IS NULL))
      AND (kind = 'review' OR (remind_every_h IS NULL AND escalate_at IS NULL)));
  END IF;
END
$$;
--> statement-breakpoint
-- Vòng nhắc (cũ + lặp), LIMIT 100. review_tasks_remind_idx (0019) giữ tới khi T9 đổi truy vấn.
CREATE INDEX IF NOT EXISTS review_tasks_remind_due_idx ON hub.review_tasks (remind_at)
  WHERE status = 'open' AND (reminded_at IS NULL OR (remind_every_h IS NOT NULL AND remind_count < 10));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_tasks_escalate_idx ON hub.review_tasks (escalate_at)
  WHERE status = 'open' AND escalated_at IS NULL AND escalate_at IS NOT NULL;
--> statement-breakpoint

-- ── (5) process_timers (mới) — hẹn giờ bền: DB là nguồn (S4), FK kép tenant (S1) ────────────────────────────────────
-- timezone: IANA đọc lúc lưu hẹn wait_until (TZ-R04, hiển thị); retry: NULL.
CREATE TABLE IF NOT EXISTS hub.process_timers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  stage_run_id uuid NOT NULL,
  kind text NOT NULL,
  due_at timestamptz NOT NULL,
  timezone text,
  fired_at timestamptz,
  cancelled_at timestamptz,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT process_timers_pkey PRIMARY KEY (id),
  CONSTRAINT process_timers_key_uq UNIQUE (idempotency_key),
  CONSTRAINT process_timers_kind_ck CHECK (kind IN ('wait_until', 'retry')),
  CONSTRAINT process_timers_state_ck CHECK (NOT (fired_at IS NOT NULL AND cancelled_at IS NOT NULL)
    AND char_length(idempotency_key) BETWEEN 1 AND 200
    AND ((kind = 'wait_until') = (timezone IS NOT NULL))
    AND (timezone IS NULL OR char_length(timezone) <= 64)),
  CONSTRAINT process_timers_run_fk FOREIGN KEY (process_run_id, tenant_id)
    REFERENCES hub.process_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT process_timers_stage_fk FOREIGN KEY (stage_run_id, tenant_id)
    REFERENCES hub.stage_runs (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
-- Ứng viên tới hạn: ORDER BY due_at LIMIT 100 (plan-db §5).
CREATE INDEX IF NOT EXISTS process_timers_due_idx ON hub.process_timers (due_at)
  WHERE fired_at IS NULL AND cancelled_at IS NULL;
--> statement-breakpoint
-- Huỷ hẹn theo run + FK CASCADE từ process_runs.
CREATE INDEX IF NOT EXISTS process_timers_run_idx ON hub.process_timers (process_run_id);
--> statement-breakpoint
-- Đếm khoá idempotency / hẹn chưa bắn của stage + FK CASCADE từ stage_runs.
CREATE INDEX IF NOT EXISTS process_timers_stage_idx ON hub.process_timers (stage_run_id, kind);
--> statement-breakpoint
-- RLS mẫu v_t 0019/0032: ENABLE, KHÔNG FORCE (owner bỏ qua — migrate/fixture); vòng quét đọc ở scope system.
ALTER TABLE hub.process_timers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_timers'
                 AND policyname = 'process_timers_hub_rw') THEN
    EXECUTE format('CREATE POLICY process_timers_hub_rw ON hub.process_timers FOR ALL TO hub_rw USING %s WITH CHECK %s',
      v_t, v_t);
  END IF;
END
$$;
--> statement-breakpoint
-- Không DELETE (huỷ = cancelled_at); agent_runtime/hub_ro KHÔNG quyền.
GRANT SELECT, INSERT, UPDATE ON hub.process_timers TO hub_rw;
--> statement-breakpoint

-- ── (6) Nới CHECK (mẫu 0024/0032): giữ đủ giá trị cũ, thêm giá trị mới cuối mảng ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_runs_status_ck'
                 AND conrelid = 'hub.process_runs'::regclass AND pg_get_constraintdef(oid) LIKE '%waiting_timer%') THEN
    ALTER TABLE hub.process_runs DROP CONSTRAINT IF EXISTS process_runs_status_ck;
    ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_status_ck CHECK (status IN (
      'running', 'waiting_review', 'waiting_answer', 'needs_decision', 'done', 'cancelled', 'failed', 'expired',
      'waiting_timer'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_runs_status_ck'
                 AND conrelid = 'hub.stage_runs'::regclass AND pg_get_constraintdef(oid) LIKE '%waiting_timer%') THEN
    ALTER TABLE hub.stage_runs DROP CONSTRAINT IF EXISTS stage_runs_status_ck;
    ALTER TABLE hub.stage_runs ADD CONSTRAINT stage_runs_status_ck CHECK (status IN (
      'pending', 'queued', 'running', 'waiting_answer', 'waiting_review', 'needs_decision', 'done', 'cancelled',
      'failed', 'waiting_timer'));
  END IF;
  -- review_tasks_reason_ck (0019, 0021, 0031, 0032): + retry_exhausted (PD-R04), timer_invalid (PD-R14).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_reason_ck'
                 AND conrelid = 'hub.review_tasks'::regclass AND pg_get_constraintdef(oid) LIKE '%timer_invalid%') THEN
    ALTER TABLE hub.review_tasks DROP CONSTRAINT IF EXISTS review_tasks_reason_ck;
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_reason_ck CHECK (reason IS NULL OR reason IN (
      'redo_limit', 'ask_limit', 'template_invalid', 'team_calls', 'team_tokens', 'team_time', 'team_no_change',
      'job_timeout', 'stage_tokens', 'run_tokens', 'agent_failed', 'permission_lost', 'user_inactive', 'interrupted',
      'source_unresolvable', 'back_limit', 'autofix_check_failed', 'sandbox_unavailable',
      'apply_conflict', 'apply_failed', 'retry_exhausted', 'timer_invalid'));
  END IF;
  -- PD-R20: grant do chuyển cấp.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_task_assignees_via_ck'
                 AND conrelid = 'hub.review_task_assignees'::regclass
                 AND pg_get_constraintdef(oid) LIKE '%''escalated''%') THEN
    ALTER TABLE hub.review_task_assignees DROP CONSTRAINT IF EXISTS review_task_assignees_via_ck;
    ALTER TABLE hub.review_task_assignees ADD CONSTRAINT review_task_assignees_via_ck
      CHECK (via IN ('initial', 'forward', 'escalated'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_notices_kind_ck'
                 AND conrelid = 'hub.process_notices'::regclass
                 AND pg_get_constraintdef(oid) LIKE '%''escalated''%') THEN
    ALTER TABLE hub.process_notices DROP CONSTRAINT IF EXISTS process_notices_kind_ck;
    ALTER TABLE hub.process_notices ADD CONSTRAINT process_notices_kind_ck CHECK (kind IN (
      'review_requested', 'ask_requested', 'decision_requested', 'reminder', 'task_closed', 'run_finished',
      'escalated'));
  END IF;
  -- hub_audit_log_action_check (0010, 0018, 0019, 0028, 0029): + escalate, escalate_skipped. entity giữ nguyên (0030).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_audit_log_action_check'
                 AND conrelid = 'hub.audit_log'::regclass AND pg_get_constraintdef(oid) LIKE '%escalate_skipped%') THEN
    ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_action_check;
    ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_action_check CHECK (action IN (
      'grant', 'revoke', 'view_trace', 'create', 'update', 'delete', 'enable', 'disable',
      'start', 'cancel', 'decide', 'review', 'answer', 'forward', 'view', 'copy', 'authorize_real_action',
      'rotate', 'check', 'degrade', 'write_fail', 'escalate', 'escalate_skipped'));
  END IF;
END
$$;
