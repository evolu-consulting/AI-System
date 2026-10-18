-- HUB-FR-146 · HUB-FR-147 · P-d2 tool + rẽ nhánh (plan-db §3). Viết tay, idempotent như 0036 (CHECK dựng lại chỉ khi chưa
-- chứa giá trị mới). Chỉ dựng lại CHECK nới enum — không bảng/cột hub mới, không mất dữ liệu: giữ đủ giá trị cũ, thêm cuối.
-- `process_thread_events_placement_ck` không đổi (`branch` ⇒ `flow`).
DO $$
BEGIN
  -- stage_runs_status_ck (0019, 0036): + skipped (stage bị nhảy qua khi rẽ nhánh — PD2-R13).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_runs_status_ck'
                 AND conrelid = 'hub.stage_runs'::regclass AND pg_get_constraintdef(oid) LIKE '%''skipped''%') THEN
    ALTER TABLE hub.stage_runs DROP CONSTRAINT IF EXISTS stage_runs_status_ck;
    ALTER TABLE hub.stage_runs ADD CONSTRAINT stage_runs_status_ck CHECK (status IN (
      'pending', 'queued', 'running', 'waiting_answer', 'waiting_review', 'needs_decision', 'done', 'cancelled',
      'failed', 'waiting_timer', 'skipped'));
  END IF;
  -- review_tasks_reason_ck (0019, 0021, 0031, 0032, 0036): + tool_failed (PD2-R05).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_reason_ck'
                 AND conrelid = 'hub.review_tasks'::regclass AND pg_get_constraintdef(oid) LIKE '%tool_failed%') THEN
    ALTER TABLE hub.review_tasks DROP CONSTRAINT IF EXISTS review_tasks_reason_ck;
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_reason_ck CHECK (reason IS NULL OR reason IN (
      'redo_limit', 'ask_limit', 'template_invalid', 'team_calls', 'team_tokens', 'team_time', 'team_no_change',
      'job_timeout', 'stage_tokens', 'run_tokens', 'agent_failed', 'permission_lost', 'user_inactive', 'interrupted',
      'source_unresolvable', 'back_limit', 'autofix_check_failed', 'sandbox_unavailable',
      'apply_conflict', 'apply_failed', 'retry_exhausted', 'timer_invalid', 'tool_failed'));
  END IF;
  -- hub_audit_log_action_check (… 0036): + tool_call (gọi tool), branch (rẽ nhánh). entity giữ nguyên.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_audit_log_action_check'
                 AND conrelid = 'hub.audit_log'::regclass AND pg_get_constraintdef(oid) LIKE '%tool_call%') THEN
    ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_action_check;
    ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_action_check CHECK (action IN (
      'grant', 'revoke', 'view_trace', 'create', 'update', 'delete', 'enable', 'disable',
      'start', 'cancel', 'decide', 'review', 'answer', 'forward', 'view', 'copy', 'authorize_real_action',
      'rotate', 'check', 'degrade', 'write_fail', 'escalate', 'escalate_skipped', 'tool_call', 'branch'));
  END IF;
  -- process_thread_events_kind_ck (0019): + branch.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_thread_events_kind_ck'
                 AND conrelid = 'hub.process_thread_events'::regclass
                 AND pg_get_constraintdef(oid) LIKE '%''branch''%') THEN
    ALTER TABLE hub.process_thread_events DROP CONSTRAINT IF EXISTS process_thread_events_kind_ck;
    ALTER TABLE hub.process_thread_events ADD CONSTRAINT process_thread_events_kind_ck CHECK (kind IN (
      'block', 'output', 'ask', 'decision', 'task_result', 'forward', 'run_end', 'branch'));
  END IF;
  -- room_messages_process_kind_ck (0019): + branch; giữ vế sender_type = 'process'.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'room_messages_process_kind_ck'
                 AND conrelid = 'hub.room_messages'::regclass AND pg_get_constraintdef(oid) LIKE '%''branch''%') THEN
    ALTER TABLE hub.room_messages DROP CONSTRAINT IF EXISTS room_messages_process_kind_ck;
    ALTER TABLE hub.room_messages ADD CONSTRAINT room_messages_process_kind_ck CHECK (process_kind IS NULL OR (
      sender_type = 'process' AND process_kind IN (
        'block', 'output', 'ask', 'decision', 'task_result', 'forward', 'run_end', 'branch')));
  END IF;
END
$$;
