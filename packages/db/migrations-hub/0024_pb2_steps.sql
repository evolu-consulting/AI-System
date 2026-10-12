-- HUB-FR-104 · HUB-FR-106 · HUB-FR-113 · HUB-FR-118 · HUB-FR-136 · HUB-BR-25 · P-b2 plan §5: bước song song + quay lại.
-- (1) process_runs.current_step/back_rounds/back_limit (+ backfill current_step = current_stage_idx CHỈ khi vừa thêm cột),
-- (2) stage_runs.round/back_to_step, process_outputs.round, (3) review_tasks_reason_ck += back_limit,
-- (4) bảng append-only process_back_events (RLS tenant, GRANT SELECT/INSERT hub_rw — không UPDATE/DELETE).
-- Viết tay, idempotent (IF NOT EXISTS; DO $$ … information_schema/pg_constraint/pg_policies). Chỉ thêm — không mất dữ liệu.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'hub' AND table_name = 'process_runs'
                 AND column_name = 'current_step') THEN
    ALTER TABLE hub.process_runs ADD COLUMN current_step smallint NOT NULL DEFAULT 0;
    -- Run cũ: mỗi stage một bước ⇒ bước = chỉ số stage (AC-PB2-01).
    UPDATE hub.process_runs SET current_step = current_stage_idx;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS back_rounds smallint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS back_limit smallint NOT NULL DEFAULT 3;
--> statement-breakpoint
ALTER TABLE hub.stage_runs ADD COLUMN IF NOT EXISTS round smallint NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE hub.stage_runs ADD COLUMN IF NOT EXISTS back_to_step smallint;
--> statement-breakpoint
ALTER TABLE hub.process_outputs ADD COLUMN IF NOT EXISTS round smallint NOT NULL DEFAULT 1;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_runs_step_ck'
                 AND conrelid = 'hub.process_runs'::regclass) THEN
    ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_step_ck CHECK (current_step BETWEEN 0 AND 9);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_runs_back_ck'
                 AND conrelid = 'hub.process_runs'::regclass) THEN
    ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_back_ck
      CHECK (back_rounds >= 0 AND back_rounds <= back_limit AND back_limit <= 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stage_runs_round_ck'
                 AND conrelid = 'hub.stage_runs'::regclass) THEN
    ALTER TABLE hub.stage_runs ADD CONSTRAINT stage_runs_round_ck
      CHECK (round >= 1 AND (back_to_step IS NULL OR back_to_step BETWEEN 0 AND 9));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_outputs_round_ck'
                 AND conrelid = 'hub.process_outputs'::regclass) THEN
    ALTER TABLE hub.process_outputs ADD CONSTRAINT process_outputs_round_ck CHECK (round >= 1);
  END IF;
  -- review_tasks_reason_ck (0019, 0021): thêm back_limit (DecisionReason mới, cuối mảng).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_reason_ck'
                 AND conrelid = 'hub.review_tasks'::regclass AND pg_get_constraintdef(oid) LIKE '%back_limit%') THEN
    ALTER TABLE hub.review_tasks DROP CONSTRAINT IF EXISTS review_tasks_reason_ck;
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_reason_ck CHECK (reason IS NULL OR reason IN (
      'redo_limit', 'ask_limit', 'template_invalid', 'team_calls', 'team_tokens', 'team_time', 'team_no_change',
      'job_timeout', 'stage_tokens', 'run_tokens', 'agent_failed', 'permission_lost', 'user_inactive', 'interrupted',
      'source_unresolvable', 'back_limit'));
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.process_back_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  task_id uuid,
  from_stage_idx smallint NOT NULL,
  from_step smallint NOT NULL,
  to_step smallint NOT NULL,
  round_after smallint NOT NULL,
  feedback text NOT NULL,
  decided_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT process_back_events_pkey PRIMARY KEY (id),
  CONSTRAINT process_back_events_ck CHECK (from_stage_idx BETWEEN 0 AND 9 AND to_step >= 0 AND to_step < from_step
    AND from_step <= 9 AND round_after >= 2 AND char_length(feedback) BETWEEN 1 AND 4000),
  CONSTRAINT process_back_events_run_fk FOREIGN KEY (process_run_id, tenant_id)
    REFERENCES hub.process_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT process_back_events_task_fk FOREIGN KEY (task_id) REFERENCES hub.review_tasks (id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_back_events_run_idx ON hub.process_back_events (process_run_id, created_at);
--> statement-breakpoint
-- task_id FK (SET NULL) cần index để xoá review_tasks không quét bảng.
CREATE INDEX IF NOT EXISTS process_back_events_task_idx ON hub.process_back_events (task_id)
  WHERE task_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE hub.process_back_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_back_events'
                 AND policyname = 'process_back_events_hub_rw') THEN
    EXECUTE format('CREATE POLICY process_back_events_hub_rw ON hub.process_back_events FOR ALL TO hub_rw '
      || 'USING %s WITH CHECK %s', v_t, v_t);
  END IF;
END $$;
--> statement-breakpoint
-- Append-only: không UPDATE/DELETE (lỗi quyền 42501). agent_runtime: không quyền.
GRANT SELECT, INSERT ON hub.process_back_events TO hub_rw;
