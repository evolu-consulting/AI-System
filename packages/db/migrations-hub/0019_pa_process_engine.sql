-- HUB-FR-104 · HUB-FR-106 · HUB-FR-113 · HUB-BR-25 · CR-056 · P-a Bước 0b (plan §2, §5, §10; plan-thread §3): quy trình.
-- Không sửa 0000–0018; viết tay, idempotent (IF NOT EXISTS / kiểm pg_constraint, pg_policies / CREATE OR REPLACE /
-- ALTER POLICY / DROP+ADD CHECK). Không FK sang admin.* (P3).
-- (1) 11 bảng mới + outbox `process_thread_events`. FK con → `process_runs (id, tenant_id)` (kép tenant, như rooms).
-- (2) Cột null trên `runs`, `conversations`, `room_messages` (+ `process_kind`, `process_meta`, sender `process`).
-- (3) RLS **T** = scope system OR (scope user AND tenant_id = GUC) trên bảng quy trình; `process_defs` ghi chỉ system;
--     `process_notices` đọc/sửa chỉ của mình; `process_thread_events` INSERT T, SELECT/UPDATE chỉ system.
-- (4) Definer: `is_process_trigger` (policy tin gọi), `process_run_viewer` ('full'/'task'/NULL, §5 + U5),
--     `room_post_process_message` (chỉ system, T4/T5), `is_room_thread` + nhánh (iii) thread quy trình.
-- (5) Policy `room_messages_insert` giữ `sender_type='user'` (user chèn tin `process` ⇒ 42501) + `is_process_trigger`.
-- (6) audit CHECK: action/entity mới. GRANT hub_rw (không DELETE trừ process_defs); agent_runtime không quyền.
-- Thứ tự khoá (plan §10): rooms → advisory → process_runs → stage_runs → team_runs → process_outputs → review_tasks →
-- review_task_assignees → process_notices → process_thread_events (chỉ INSERT) → [createRunTx] → audit_log.
-- Poster (definer): rooms → process_thread_events → room_messages → room_members — không khoá process_runs.

-- ── (1) Bảng nhóm agent (cấu hình, không RLS — như agents) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.agent_teams (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  name jsonb NOT NULL,
  description text NOT NULL DEFAULT '',
  mode text NOT NULL DEFAULT 'sequential',
  lead_agent_id uuid,
  limits jsonb NOT NULL DEFAULT
    '{"max_calls":10,"max_tokens":200000,"max_active_s":600,"summary_tokens":200,"max_plan_steps":5}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_teams_pkey PRIMARY KEY (id),
  CONSTRAINT agent_teams_key_uq UNIQUE (key),
  CONSTRAINT agent_teams_key_ck CHECK (key ~ '^[a-z0-9-]{2,32}$'),
  CONSTRAINT agent_teams_name_ck CHECK (jsonb_typeof(name) = 'object'),
  CONSTRAINT agent_teams_desc_ck CHECK (char_length(description) <= 500),
  CONSTRAINT agent_teams_mode_ck CHECK (mode IN ('sequential', 'lead_plan', 'parallel_merge')),
  CONSTRAINT agent_teams_limits_ck CHECK (jsonb_typeof(limits) = 'object'),
  CONSTRAINT agent_teams_version_ck CHECK (version >= 1),
  CONSTRAINT agent_teams_lead_fk FOREIGN KEY (lead_agent_id) REFERENCES hub.agents (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.agent_team_members (
  team_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  role text NOT NULL,
  sections text[] NOT NULL DEFAULT '{}',
  position smallint NOT NULL,
  CONSTRAINT agent_team_members_pkey PRIMARY KEY (team_id, agent_id),
  CONSTRAINT agent_team_members_position_uq UNIQUE (team_id, position),
  CONSTRAINT agent_team_members_role_ck CHECK (char_length(role) BETWEEN 1 AND 40),
  CONSTRAINT agent_team_members_position_ck CHECK (position >= 0),
  CONSTRAINT agent_team_members_team_fk FOREIGN KEY (team_id) REFERENCES hub.agent_teams (id) ON DELETE CASCADE,
  CONSTRAINT agent_team_members_agent_fk FOREIGN KEY (agent_id) REFERENCES hub.agents (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.agent_team_entitlements (
  team_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT agent_team_entitlements_pkey PRIMARY KEY (team_id, tenant_id),
  CONSTRAINT agent_team_entitlements_team_fk FOREIGN KEY (team_id) REFERENCES hub.agent_teams (id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_team_entitlements_tenant_active_idx ON hub.agent_team_entitlements (tenant_id)
  WHERE revoked_at IS NULL;
--> statement-breakpoint

-- ── (1) Định nghĩa quy trình (null tenant = mẫu platform_admin) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.process_defs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid,
  key text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  input_hint text NOT NULL DEFAULT '',
  run_group_ids uuid[] NOT NULL DEFAULT '{}',
  stages jsonb NOT NULL,
  token_budget integer,
  enabled boolean NOT NULL DEFAULT false,
  source_template_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT process_defs_pkey PRIMARY KEY (id),
  CONSTRAINT process_defs_key_ck CHECK (key ~ '^[a-z0-9-]{2,32}$'),
  CONSTRAINT process_defs_name_ck CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT process_defs_desc_ck CHECK (char_length(description) <= 500),
  CONSTRAINT process_defs_hint_ck CHECK (char_length(input_hint) <= 200),
  CONSTRAINT process_defs_groups_ck CHECK (cardinality(run_group_ids) <= 20),
  CONSTRAINT process_defs_stages_ck CHECK (jsonb_typeof(stages) = 'array'
    AND jsonb_array_length(stages) BETWEEN 1 AND 10),
  CONSTRAINT process_defs_budget_ck CHECK (token_budget IS NULL OR token_budget BETWEEN 1000 AND 5000000),
  CONSTRAINT process_defs_version_ck CHECK (version >= 1),
  CONSTRAINT process_defs_template_fk FOREIGN KEY (source_template_id) REFERENCES hub.process_defs (id)
    ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS process_defs_tenant_key_uq ON hub.process_defs (tenant_id, key)
  WHERE deleted_at IS NULL AND tenant_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS process_defs_template_key_uq ON hub.process_defs (key)
  WHERE tenant_id IS NULL AND deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_defs_tenant_updated_idx ON hub.process_defs (tenant_id, updated_at DESC)
  WHERE deleted_at IS NULL;
--> statement-breakpoint

-- ── (1) Run quy trình ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.process_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_def_id uuid NOT NULL,
  def_version integer NOT NULL,
  snapshot jsonb NOT NULL,
  started_by uuid NOT NULL,
  origin_kind text NOT NULL,
  origin_room_id uuid,
  origin_conversation_id uuid,
  trigger_message_id uuid,
  input text NOT NULL,
  conversation_id uuid NOT NULL,
  flow_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  current_stage_idx smallint NOT NULL DEFAULT 0,
  decision jsonb,
  tokens_total integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  cancelled_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT process_runs_pkey PRIMARY KEY (id),
  CONSTRAINT process_runs_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT process_runs_def_version_ck CHECK (def_version >= 1),
  CONSTRAINT process_runs_snapshot_ck CHECK (jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT process_runs_origin_kind_ck CHECK (origin_kind IN ('room', 'conversation', 'admin')),
  -- SET NULL khi xoá phòng/hội thoại vẫn thoả (không đòi NOT NULL theo kind, chỉ cấm cột của kind khác).
  CONSTRAINT process_runs_origin_ck CHECK (
    (origin_kind = 'room' AND origin_conversation_id IS NULL)
    OR (origin_kind = 'conversation' AND origin_room_id IS NULL)
    OR (origin_kind = 'admin' AND origin_room_id IS NULL AND origin_conversation_id IS NULL)),
  CONSTRAINT process_runs_input_ck CHECK (char_length(input) <= 8000),
  CONSTRAINT process_runs_status_ck CHECK (status IN ('running', 'waiting_review', 'waiting_answer', 'needs_decision',
    'done', 'cancelled', 'failed', 'expired')),
  CONSTRAINT process_runs_stage_idx_ck CHECK (current_stage_idx BETWEEN 0 AND 9),
  CONSTRAINT process_runs_decision_ck CHECK (decision IS NULL OR jsonb_typeof(decision) = 'object'),
  CONSTRAINT process_runs_tokens_ck CHECK (tokens_total >= 0),
  CONSTRAINT process_runs_def_fk FOREIGN KEY (process_def_id) REFERENCES hub.process_defs (id) ON DELETE RESTRICT,
  CONSTRAINT process_runs_room_fk FOREIGN KEY (origin_room_id) REFERENCES hub.rooms (id) ON DELETE SET NULL,
  CONSTRAINT process_runs_origin_conv_fk FOREIGN KEY (origin_conversation_id) REFERENCES hub.conversations (id)
    ON DELETE SET NULL,
  CONSTRAINT process_runs_conv_fk FOREIGN KEY (conversation_id) REFERENCES hub.conversations (id) ON DELETE RESTRICT,
  CONSTRAINT process_runs_trigger_fk FOREIGN KEY (trigger_message_id) REFERENCES hub.room_messages (id)
    ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_runs_active_idx ON hub.process_runs (tenant_id)
  WHERE status IN ('running', 'waiting_review', 'waiting_answer', 'needs_decision');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_runs_started_by_idx ON hub.process_runs (started_by, started_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_runs_origin_room_idx ON hub.process_runs (origin_room_id)
  WHERE origin_room_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_runs_origin_conv_idx ON hub.process_runs (origin_conversation_id)
  WHERE origin_conversation_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_runs_tenant_started_idx ON hub.process_runs (tenant_id, started_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_runs_def_started_idx ON hub.process_runs (process_def_id, started_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_runs_expires_idx ON hub.process_runs (expires_at)
  WHERE status IN ('running', 'waiting_review', 'waiting_answer', 'needs_decision');
--> statement-breakpoint
-- Một flow / run (T2): thread id = flow_id; `is_room_thread` (iii) + luật T7 tra theo flow_id.
CREATE UNIQUE INDEX IF NOT EXISTS process_runs_flow_uq ON hub.process_runs (flow_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS hub.stage_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  stage_idx smallint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt smallint NOT NULL DEFAULT 1,
  attempt_limit smallint NOT NULL DEFAULT 4,
  asks_count smallint NOT NULL DEFAULT 0,
  ask_limit smallint NOT NULL DEFAULT 3,
  template_failures smallint NOT NULL DEFAULT 0,
  current_run_id uuid,
  current_output_id uuid,
  feedback text,
  redo_sections text[],
  passed_by uuid,
  passed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stage_runs_pkey PRIMARY KEY (id),
  CONSTRAINT stage_runs_run_idx_uq UNIQUE (process_run_id, stage_idx),
  CONSTRAINT stage_runs_stage_idx_ck CHECK (stage_idx BETWEEN 0 AND 9),
  CONSTRAINT stage_runs_status_ck CHECK (status IN ('pending', 'queued', 'running', 'waiting_answer', 'waiting_review',
    'needs_decision', 'done', 'cancelled', 'failed')),
  CONSTRAINT stage_runs_counts_ck CHECK (attempt >= 1 AND attempt_limit >= 1 AND asks_count >= 0 AND ask_limit >= 0
    AND template_failures >= 0),
  CONSTRAINT stage_runs_feedback_ck CHECK (feedback IS NULL OR char_length(feedback) <= 4000),
  CONSTRAINT stage_runs_run_fk FOREIGN KEY (process_run_id, tenant_id) REFERENCES hub.process_runs (id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT stage_runs_current_run_fk FOREIGN KEY (current_run_id) REFERENCES hub.runs (id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stage_runs_queued_idx ON hub.stage_runs (updated_at) WHERE status = 'queued';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stage_runs_current_run_idx ON hub.stage_runs (current_run_id)
  WHERE current_run_id IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS hub.team_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  stage_run_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  attempt smallint NOT NULL,
  team_id uuid NOT NULL,
  mode text NOT NULL,
  plan jsonb,
  cursor smallint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  stop_reason text,
  calls smallint NOT NULL DEFAULT 0,
  tokens integer NOT NULL DEFAULT 0,
  active_ms integer NOT NULL DEFAULT 0,
  segment_started_at timestamptz,
  last_hash text,
  same_count smallint NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT team_runs_pkey PRIMARY KEY (id),
  CONSTRAINT team_runs_attempt_ck CHECK (attempt >= 1),
  CONSTRAINT team_runs_mode_ck CHECK (mode IN ('sequential', 'lead_plan', 'parallel_merge')),
  CONSTRAINT team_runs_status_ck CHECK (status IN ('running', 'waiting_answer', 'done', 'limit', 'failed', 'cancelled')),
  CONSTRAINT team_runs_stop_ck CHECK (stop_reason IS NULL
    OR stop_reason IN ('calls', 'tokens', 'time', 'no_change', 'member_failed', 'cancelled')),
  CONSTRAINT team_runs_counts_ck CHECK (cursor >= 0 AND calls >= 0 AND tokens >= 0 AND active_ms >= 0
    AND same_count >= 0),
  CONSTRAINT team_runs_stage_fk FOREIGN KEY (stage_run_id) REFERENCES hub.stage_runs (id) ON DELETE CASCADE,
  CONSTRAINT team_runs_run_fk FOREIGN KEY (process_run_id, tenant_id) REFERENCES hub.process_runs (id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT team_runs_team_fk FOREIGN KEY (team_id) REFERENCES hub.agent_teams (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS team_runs_stage_attempt_idx ON hub.team_runs (stage_run_id, attempt);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS hub.process_outputs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  stage_run_id uuid NOT NULL,
  stage_idx smallint NOT NULL,
  version smallint NOT NULL,
  attempt smallint NOT NULL,
  content text NOT NULL,
  sections jsonb,
  fields jsonb,
  summaries jsonb,
  template_ok boolean NOT NULL,
  template_missing text[] NOT NULL DEFAULT '{}',
  attachment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT process_outputs_pkey PRIMARY KEY (id),
  CONSTRAINT process_outputs_stage_version_uq UNIQUE (stage_run_id, version),
  CONSTRAINT process_outputs_idx_ck CHECK (stage_idx BETWEEN 0 AND 9 AND version >= 1 AND attempt >= 1),
  CONSTRAINT process_outputs_content_ck CHECK (char_length(content) <= 200000),
  CONSTRAINT process_outputs_stage_fk FOREIGN KEY (stage_run_id) REFERENCES hub.stage_runs (id) ON DELETE CASCADE,
  CONSTRAINT process_outputs_run_fk FOREIGN KEY (process_run_id, tenant_id) REFERENCES hub.process_runs (id, tenant_id)
    ON DELETE CASCADE
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS hub.review_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  stage_run_id uuid NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  output_id uuid,
  question text,
  choices jsonb,
  excerpt text,
  reason text,
  assignee_group_id uuid,
  remind_at timestamptz NOT NULL DEFAULT (now() + interval '1 day'),
  reminded_at timestamptz,
  result text,
  feedback text,
  answer text,
  sections text[],
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_tasks_pkey PRIMARY KEY (id),
  CONSTRAINT review_tasks_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT review_tasks_kind_ck CHECK (kind IN ('review', 'ask', 'decision')),
  CONSTRAINT review_tasks_status_ck CHECK (status IN ('open', 'closed')),
  -- kind ↔ cột: review ⇒ output_id · ask ⇒ question · decision ⇒ reason.
  CONSTRAINT review_tasks_kind_cols_ck CHECK ((kind <> 'review' OR output_id IS NOT NULL)
    AND (kind <> 'ask' OR question IS NOT NULL) AND (kind <> 'decision' OR reason IS NOT NULL)),
  CONSTRAINT review_tasks_result_ck CHECK (result IS NULL OR result IN ('pass', 'fail', 'answer', 'add_attempt',
    'use_current', 'cancel', 'cancelled', 'expired', 'superseded')),
  CONSTRAINT review_tasks_reason_ck CHECK (reason IS NULL OR reason IN ('redo_limit', 'ask_limit', 'template_invalid',
    'team_calls', 'team_tokens', 'team_time', 'team_no_change', 'job_timeout', 'stage_tokens', 'run_tokens',
    'agent_failed', 'permission_lost', 'user_inactive', 'interrupted')),
  CONSTRAINT review_tasks_text_ck CHECK ((question IS NULL OR char_length(question) <= 2000)
    AND (excerpt IS NULL OR char_length(excerpt) <= 1000) AND (feedback IS NULL OR char_length(feedback) <= 4000)
    AND (answer IS NULL OR char_length(answer) <= 4000)),
  CONSTRAINT review_tasks_choices_ck CHECK (choices IS NULL OR jsonb_typeof(choices) = 'array'),
  CONSTRAINT review_tasks_stage_fk FOREIGN KEY (stage_run_id) REFERENCES hub.stage_runs (id) ON DELETE CASCADE,
  CONSTRAINT review_tasks_run_fk FOREIGN KEY (process_run_id, tenant_id) REFERENCES hub.process_runs (id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT review_tasks_output_fk FOREIGN KEY (output_id) REFERENCES hub.process_outputs (id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS review_tasks_open_uq ON hub.review_tasks (stage_run_id, kind) WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_tasks_run_idx ON hub.review_tasks (process_run_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_tasks_remind_idx ON hub.review_tasks (remind_at)
  WHERE status = 'open' AND reminded_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_tasks_group_idx ON hub.review_tasks (assignee_group_id) WHERE status = 'open';
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS hub.review_task_assignees (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  task_id uuid NOT NULL,
  user_id uuid,
  group_id uuid,
  via text NOT NULL DEFAULT 'initial',
  from_user_id uuid,
  note text,
  depth smallint NOT NULL DEFAULT 0,
  first_viewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_task_assignees_pkey PRIMARY KEY (id),
  CONSTRAINT review_task_assignees_who_ck CHECK (num_nonnulls(user_id, group_id) = 1),
  CONSTRAINT review_task_assignees_via_ck CHECK (via IN ('initial', 'forward')),
  CONSTRAINT review_task_assignees_depth_ck CHECK (depth BETWEEN 0 AND 3),
  CONSTRAINT review_task_assignees_note_ck CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT review_task_assignees_task_fk FOREIGN KEY (task_id, tenant_id) REFERENCES hub.review_tasks (id, tenant_id)
    ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS review_task_assignees_user_uq ON hub.review_task_assignees (task_id, user_id)
  WHERE user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_task_assignees_user_idx ON hub.review_task_assignees (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_task_assignees_group_idx ON hub.review_task_assignees (group_id)
  WHERE group_id IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS hub.process_notices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  process_run_id uuid NOT NULL,
  task_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT process_notices_pkey PRIMARY KEY (id),
  CONSTRAINT process_notices_kind_ck CHECK (kind IN ('review_requested', 'ask_requested', 'decision_requested',
    'reminder', 'task_closed', 'run_finished')),
  CONSTRAINT process_notices_payload_ck CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT process_notices_run_fk FOREIGN KEY (process_run_id, tenant_id) REFERENCES hub.process_runs (id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT process_notices_task_fk FOREIGN KEY (task_id) REFERENCES hub.review_tasks (id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_notices_user_idx ON hub.process_notices (user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_notices_unread_idx ON hub.process_notices (user_id) WHERE read_at IS NULL;
--> statement-breakpoint

-- Outbox tin thread (plan-thread T5): tx quy trình INSERT; poster (system) đăng qua `room_post_process_message`.
CREATE TABLE IF NOT EXISTS hub.process_thread_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  room_id uuid NOT NULL,
  kind text NOT NULL,
  placement text NOT NULL,
  meta jsonb NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  outcome text,
  CONSTRAINT process_thread_events_pkey PRIMARY KEY (id),
  CONSTRAINT process_thread_events_kind_ck CHECK (kind IN ('block', 'output', 'ask', 'decision', 'task_result',
    'forward', 'run_end')),
  CONSTRAINT process_thread_events_placement_ck CHECK (placement IN ('main', 'flow')
    AND (kind = 'block') = (placement = 'main')),
  CONSTRAINT process_thread_events_meta_ck CHECK (jsonb_typeof(meta) = 'object'),
  CONSTRAINT process_thread_events_content_ck CHECK (char_length(content) BETWEEN 1 AND 500),
  CONSTRAINT process_thread_events_outcome_ck CHECK ((outcome IS NULL) = (posted_at IS NULL)
    AND (outcome IS NULL OR outcome IN ('posted', 'skipped'))),
  CONSTRAINT process_thread_events_run_fk FOREIGN KEY (process_run_id, tenant_id)
    REFERENCES hub.process_runs (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_thread_events_unposted_idx ON hub.process_thread_events (created_at)
  WHERE posted_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_thread_events_run_idx ON hub.process_thread_events (process_run_id, created_at);
--> statement-breakpoint

-- ── (2) Cột null trên bảng chung (không default ⇒ hàng cũ không đổi) ────────────────────────────────────────────────
ALTER TABLE hub.runs ADD COLUMN IF NOT EXISTS process_run_id uuid;
--> statement-breakpoint
ALTER TABLE hub.runs ADD COLUMN IF NOT EXISTS stage_run_id uuid;
--> statement-breakpoint
ALTER TABLE hub.runs ADD COLUMN IF NOT EXISTS team_run_id uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runs_process_run_idx ON hub.runs (process_run_id) WHERE process_run_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE hub.conversations ADD COLUMN IF NOT EXISTS process_run_id uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS conversations_process_run_uq ON hub.conversations (process_run_id)
  WHERE process_run_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE hub.room_messages ADD COLUMN IF NOT EXISTS process_run_id uuid;
--> statement-breakpoint
ALTER TABLE hub.room_messages ADD COLUMN IF NOT EXISTS process_kind text;
--> statement-breakpoint
ALTER TABLE hub.room_messages ADD COLUMN IF NOT EXISTS process_meta jsonb;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS room_messages_process_run_idx ON hub.room_messages (process_run_id)
  WHERE process_run_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS room_messages_process_block_uq ON hub.room_messages (process_run_id)
  WHERE process_kind = 'block';
--> statement-breakpoint
-- sender `process` (T3): CHECK cũ (user, agent) thay bằng (user, agent, process). CHECK X2b user_ck/agent_ck giữ.
ALTER TABLE hub.room_messages DROP CONSTRAINT IF EXISTS room_messages_sender_type_ck;
--> statement-breakpoint
ALTER TABLE hub.room_messages ADD CONSTRAINT room_messages_sender_type_ck
  CHECK (sender_type IN ('user', 'agent', 'process'));
--> statement-breakpoint
DO $$
DECLARE
  v_ck text[][] := ARRAY[
    ['hub.runs', 'runs_process_ck',
     'CHECK ((process_run_id IS NULL) = (stage_run_id IS NULL) AND (team_run_id IS NULL OR stage_run_id IS NOT NULL))'],
    ['hub.room_messages', 'room_messages_process_ck',
     'CHECK (sender_type <> ''process'' OR (sender_id IS NOT NULL AND process_run_id IS NOT NULL'
       || ' AND process_kind IS NOT NULL AND flow_id IS NOT NULL AND process_meta IS NOT NULL AND run_id IS NULL'
       || ' AND trigger_message_id IS NULL AND run_status IS NULL AND wait_kind IS NULL AND ask IS NULL))'],
    ['hub.room_messages', 'room_messages_process_kind_ck',
     'CHECK (process_kind IS NULL OR (sender_type = ''process'' AND process_kind IN (''block'', ''output'', ''ask'','
       || ' ''decision'', ''task_result'', ''forward'', ''run_end'')))'],
    ['hub.room_messages', 'room_messages_process_meta_ck',
     'CHECK (process_meta IS NULL OR (sender_type = ''process'' AND jsonb_typeof(process_meta) = ''object''))'],
    -- FK sang attachments ngoài CREATE TABLE: test idempotent 0007 (hub-h2c) gỡ attachments CASCADE rồi áp lại.
    ['hub.process_outputs', 'process_outputs_attachment_fk',
     'FOREIGN KEY (attachment_id) REFERENCES hub.attachments (id) ON DELETE SET NULL'],
    ['hub.room_messages', 'room_messages_process_run_fk',
     'FOREIGN KEY (process_run_id) REFERENCES hub.process_runs (id) ON DELETE SET NULL']];
  i int;
BEGIN
  FOR i IN 1 .. array_length(v_ck, 1) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = v_ck[i][2]
                   AND conrelid = v_ck[i][1]::regclass) THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', v_ck[i][1], v_ck[i][2], v_ck[i][3]);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

-- ── (6) audit_log CHECK (hàng cũ thoả CHECK mới) ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_action_check;
  ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_action_check CHECK (
    action IN ('grant', 'revoke', 'view_trace', 'create', 'update', 'delete', 'enable', 'disable',
      'start', 'cancel', 'decide', 'review', 'answer', 'forward', 'view', 'copy', 'authorize_real_action')
  );
  ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_entity_check;
  ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_entity_check CHECK (
    entity IN ('agent_grant', 'run', 'agent', 'orchestrator', 'agent_entitlement', 'agent_default',
      'process_def', 'process_run', 'review_task', 'agent_team')
  );
END $$;
--> statement-breakpoint

-- ── (4) Hàm SECURITY DEFINER (search_path cố định, tên bảng đủ schema; tenant/user chỉ từ GUC) ────────────────────
-- Tin gọi `!key` (T1): run cùng tenant, gốc là phòng này, đúng thread (flow), người gọi = người bắt đầu, chưa có tin gọi.
CREATE OR REPLACE FUNCTION hub.is_process_trigger(p_room uuid, p_run uuid, p_flow uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT current_setting('app.scope', true) = 'user' AND EXISTS (
    SELECT 1 FROM hub.process_runs pr
    WHERE pr.id = p_run AND pr.origin_room_id = p_room AND pr.flow_id = p_flow
      AND pr.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND pr.started_by = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND pr.trigger_message_id IS NULL)
$$;
--> statement-breakpoint
-- Như 0014 + nhánh (iii): flow là thread của process run bắt đầu từ phòng này (cùng tenant) ⇒ tin gọi + tin người↔người
-- vào thread quy trình qua policy hiện có (room_messages_insert, room_flow_reads).
CREATE OR REPLACE FUNCTION hub.is_room_thread(p_room uuid, p_flow uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT current_setting('app.scope', true) = 'user' AND hub.is_room_member(p_room) AND (
    EXISTS (
      SELECT 1 FROM hub.room_messages m
      WHERE m.room_id = p_room AND m.flow_id = p_flow AND m.placement = 'main'
        AND m.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    OR EXISTS (
      SELECT 1 FROM hub.flows f JOIN hub.conversations c ON c.id = f.conversation_id
      WHERE f.id = p_flow AND f.room_flow_id = f.id AND c.room_id = p_room
        AND f.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND c.user_id = f.user_id
        AND f.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        AND c.tenant_id = f.tenant_id)
    OR EXISTS (
      SELECT 1 FROM hub.process_runs pr
      WHERE pr.flow_id = p_flow AND pr.origin_room_id = p_room
        AND pr.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
$$;
--> statement-breakpoint
-- §5 + U5 (khớp `runAccess`): 'full' ⇐ admin (tenant_admin cùng tenant / platform_admin) ∨ thành viên hiện tại của phòng
-- gốc (chưa xoá) ∨ người bắt đầu khi không có phòng / phòng đã xoá; 'task' ⇐ người bắt đầu đã rời phòng ∨ assignee
-- (user trực tiếp, thành viên group, người được chuyển) của bất kỳ task nào của run; còn lại / tenant khác ⇒ NULL (404).
CREATE OR REPLACE FUNCTION hub.process_run_viewer(p_run uuid) RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_uid uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  v_started uuid;
  v_room uuid;
  v_origin text;
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'user' OR v_tid IS NULL OR v_uid IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT pr.started_by, pr.origin_room_id INTO v_started, v_room
    FROM hub.process_runs pr WHERE pr.id = p_run AND pr.tenant_id = v_tid;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM admin.users u WHERE u.id = v_uid AND u.active
               AND (u.role = 'platform_admin' OR (u.role = 'tenant_admin' AND u.tenant_id = v_tid))) THEN
    RETURN 'full';
  END IF;
  IF v_room IS NULL THEN
    v_origin := 'none';
  ELSIF NOT EXISTS (SELECT 1 FROM hub.rooms r WHERE r.id = v_room AND r.tenant_id = v_tid AND r.deleted_at IS NULL) THEN
    v_origin := 'deleted';
  ELSIF EXISTS (SELECT 1 FROM hub.room_members m WHERE m.room_id = v_room AND m.tenant_id = v_tid
                  AND m.user_id = v_uid AND m.left_at IS NULL) THEN
    v_origin := 'member';
  ELSE
    v_origin := 'outside';
  END IF;
  IF v_origin = 'member' OR (v_started = v_uid AND v_origin IN ('none', 'deleted')) THEN
    RETURN 'full';
  END IF;
  IF v_started = v_uid THEN
    RETURN 'task';
  END IF;
  IF EXISTS (
    SELECT 1 FROM hub.review_tasks t JOIN hub.review_task_assignees a ON a.task_id = t.id AND a.tenant_id = t.tenant_id
    WHERE t.process_run_id = p_run AND t.tenant_id = v_tid
      AND (a.user_id = v_uid OR a.group_id IN (
        SELECT gm.group_id FROM admin.group_members gm WHERE gm.user_id = v_uid AND gm.tenant_id = v_tid))) THEN
    RETURN 'task';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
-- T4/T5 (tx system): đăng 1 sự kiện outbox thành tin `process`. Idempotent: `room_messages.id = event.id`, `posted_at`.
-- reason: 'posted' · 'already' (đã đăng) · 'skipped' (phòng xoá / lệch tenant ⇒ outcome=skipped). Không đổi mốc đọc ai.
CREATE OR REPLACE FUNCTION hub.room_post_process_message(p_event uuid)
  RETURNS TABLE (posted boolean, reason text, room_id uuid, seq bigint, created_at timestamptz)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
#variable_conflict use_column
DECLARE
  v_room uuid;
  v_ev record;
  v_rm record;
  v_run record;
  v_seq bigint;
  v_at timestamptz;
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'room_post_process_message: system scope required' USING ERRCODE = '42501';
  END IF;
  SELECT e.room_id INTO v_room FROM hub.process_thread_events e WHERE e.id = p_event;
  IF v_room IS NULL THEN
    RAISE EXCEPTION 'room_post_process_message: event not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT r.id, r.tenant_id, r.kind, r.deleted_at INTO v_rm FROM hub.rooms r WHERE r.id = v_room FOR UPDATE;
  SELECT e.* INTO v_ev FROM hub.process_thread_events e WHERE e.id = p_event FOR UPDATE;
  IF v_ev.posted_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already'::text, v_room, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT pr.process_def_id, pr.flow_id INTO v_run FROM hub.process_runs pr
    WHERE pr.id = v_ev.process_run_id AND pr.tenant_id = v_ev.tenant_id;
  IF v_rm.id IS NULL OR v_rm.deleted_at IS NOT NULL OR v_rm.tenant_id IS DISTINCT FROM v_ev.tenant_id
     OR v_run.flow_id IS NULL THEN
    UPDATE hub.process_thread_events e SET posted_at = now(), outcome = 'skipped' WHERE e.id = p_event;
    RETURN QUERY SELECT false, 'skipped'::text, v_room, NULL::bigint, NULL::timestamptz;
    RETURN;
  END IF;
  UPDATE hub.rooms r SET last_seq = r.last_seq + 1,
      last_activity_at = date_trunc('milliseconds', clock_timestamp())
    WHERE r.id = v_room
    RETURNING r.last_seq, r.last_activity_at INTO v_seq, v_at;
  INSERT INTO hub.room_messages (id, room_id, tenant_id, seq, sender_type, sender_id, content, flow_id, created_at,
      placement, process_run_id, process_kind, process_meta)
    VALUES (v_ev.id, v_room, v_ev.tenant_id, v_seq, 'process', v_run.process_def_id, v_ev.content, v_run.flow_id, v_at,
      v_ev.placement, v_ev.process_run_id, v_ev.kind, v_ev.meta);
  UPDATE hub.process_thread_events e SET posted_at = now(), outcome = 'posted' WHERE e.id = p_event;
  IF v_rm.kind = 'dm' THEN
    UPDATE hub.room_members m SET hidden_at = NULL
      WHERE m.room_id = v_room AND m.left_at IS NULL AND m.hidden_at IS NOT NULL;
  END IF;
  RETURN QUERY SELECT true, 'posted'::text, v_room, v_seq, v_at;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.is_process_trigger(uuid, uuid, uuid), hub.process_run_viewer(uuid),
  hub.room_post_process_message(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.is_process_trigger(uuid, uuid, uuid), hub.process_run_viewer(uuid),
  hub.room_post_process_message(uuid) TO hub_rw;
--> statement-breakpoint

-- ── (5) Policy INSERT tin: giữ sender_type='user' (T4) + tin gọi phải qua is_process_trigger ─────────────────────────
ALTER POLICY room_messages_insert ON hub.room_messages
  WITH CHECK (current_setting('app.scope', true) = 'user'
         AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         AND sender_type = 'user'
         AND sender_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND hub.is_room_member(room_id)
         AND seq = hub.room_last_seq(room_id)
         AND (flow_id IS NULL OR hub.is_room_thread(room_id, flow_id))
         AND (process_run_id IS NULL OR hub.is_process_trigger(room_id, process_run_id, flow_id)));
--> statement-breakpoint

-- ── (3) RLS ─────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
  v_sys constant text := '(current_setting(''app.scope'', true) = ''system'')';
  v_own constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid'
    || ' AND user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid))';
BEGIN
  FOREACH t IN ARRAY ARRAY['process_defs', 'process_runs', 'stage_runs', 'team_runs', 'process_outputs', 'review_tasks',
                           'review_task_assignees', 'process_notices', 'process_thread_events'] LOOP
    EXECUTE format('ALTER TABLE hub.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  -- T (FOR ALL) cho 6 bảng run; DELETE không GRANT ⇒ lỗi quyền.
  FOREACH t IN ARRAY ARRAY['process_runs', 'stage_runs', 'team_runs', 'process_outputs', 'review_tasks',
                           'review_task_assignees'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = t
                   AND policyname = t || '_hub_rw') THEN
      EXECUTE format('CREATE POLICY %I ON hub.%I FOR ALL TO hub_rw USING %s WITH CHECK %s', t || '_hub_rw', t, v_t, v_t);
    END IF;
  END LOOP;
  -- process_defs: đọc của tenant + mẫu (tenant_id NULL); ghi chỉ system (D17, withConfigWrite).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_defs'
                 AND policyname = 'process_defs_select') THEN
    CREATE POLICY process_defs_select ON hub.process_defs FOR SELECT TO hub_rw
      USING (current_setting('app.scope', true) = 'system'
             OR (current_setting('app.scope', true) = 'user'
                 AND (tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_defs'
                 AND policyname = 'process_defs_insert') THEN
    EXECUTE format('CREATE POLICY process_defs_insert ON hub.process_defs FOR INSERT TO hub_rw WITH CHECK %s', v_sys);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_defs'
                 AND policyname = 'process_defs_update') THEN
    EXECUTE format('CREATE POLICY process_defs_update ON hub.process_defs FOR UPDATE TO hub_rw USING %s WITH CHECK %s',
      v_sys, v_sys);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_defs'
                 AND policyname = 'process_defs_delete') THEN
    EXECUTE format('CREATE POLICY process_defs_delete ON hub.process_defs FOR DELETE TO hub_rw USING %s', v_sys);
  END IF;
  -- process_notices (D12): đọc/sửa chỉ của mình; INSERT T (người quyết ghi thông báo cho người khác).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_notices'
                 AND policyname = 'process_notices_select') THEN
    EXECUTE format('CREATE POLICY process_notices_select ON hub.process_notices FOR SELECT TO hub_rw USING %s', v_own);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_notices'
                 AND policyname = 'process_notices_update') THEN
    EXECUTE format('CREATE POLICY process_notices_update ON hub.process_notices FOR UPDATE TO hub_rw USING %s'
      || ' WITH CHECK %s', v_own, v_own);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_notices'
                 AND policyname = 'process_notices_insert') THEN
    EXECUTE format('CREATE POLICY process_notices_insert ON hub.process_notices FOR INSERT TO hub_rw WITH CHECK %s',
      v_t);
  END IF;
  -- process_thread_events (T5): INSERT T; SELECT/UPDATE chỉ system (người dùng không đọc nội dung qua bảng).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_thread_events'
                 AND policyname = 'process_thread_events_insert') THEN
    EXECUTE format('CREATE POLICY process_thread_events_insert ON hub.process_thread_events FOR INSERT TO hub_rw'
      || ' WITH CHECK %s', v_t);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_thread_events'
                 AND policyname = 'process_thread_events_select') THEN
    EXECUTE format('CREATE POLICY process_thread_events_select ON hub.process_thread_events FOR SELECT TO hub_rw'
      || ' USING %s', v_sys);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_thread_events'
                 AND policyname = 'process_thread_events_update') THEN
    EXECUTE format('CREATE POLICY process_thread_events_update ON hub.process_thread_events FOR UPDATE TO hub_rw'
      || ' USING %s WITH CHECK %s', v_sys, v_sys);
  END IF;
END $$;
--> statement-breakpoint

-- ── (6) GRANT hub_rw (hub_api thừa hưởng). agent_runtime: không quyền bảng quy trình ────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.process_defs TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hub.process_runs, hub.stage_runs, hub.team_runs, hub.process_outputs, hub.review_tasks,
  hub.review_task_assignees, hub.process_notices, hub.process_thread_events TO hub_rw;
--> statement-breakpoint
GRANT SELECT ON hub.agent_teams, hub.agent_team_members, hub.agent_team_entitlements TO hub_rw;
--> statement-breakpoint
GRANT INSERT, UPDATE (revoked_at, granted_by, granted_at) ON hub.agent_team_entitlements TO hub_rw;
