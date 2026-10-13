-- HUB-FR-131 · HUB-FR-132 · HUB-FR-133 · HUB-FR-134 · HUB-BR-40 · CR-073 · KnowledgeHub (spec K1 §4, plan §5).
-- Viết tay, idempotent như 0028 (IF NOT EXISTS / DO $$ kiểm pg_policies). Chỉ THÊM 5 bảng + index + nới audit CHECK —
-- không đụng hub.agents / hub.secrets, không mất dữ liệu. Không lưu giá trị khoá KH (chỉ `secret_id`).
-- (1) kh_connections + agent_kh: cấu hình NỀN TẢNG (không tenant_id, không RLS; route chỉ platform_admin).
-- (2) kh_jobs, kh_stage_usage, kh_writes: dữ liệu run theo tenant ⇒ RLS "T" (`v_t`) TO hub_rw.

-- ── (1) kết nối KH ──────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.kh_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  base_url text NOT NULL,
  secret_id uuid NOT NULL,
  summary_project text,
  check_status text NOT NULL DEFAULT 'unchecked',
  checked_at timestamptz,
  check_result jsonb,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kh_connections_name_ck CHECK (char_length(btrim(name)) BETWEEN 1 AND 80 AND name !~ '/'),
  CONSTRAINT kh_connections_url_ck CHECK (char_length(base_url) BETWEEN 8 AND 512),
  CONSTRAINT kh_connections_summary_ck CHECK (summary_project IS NULL
    OR summary_project ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  CONSTRAINT kh_connections_status_ck CHECK (check_status IN ('unchecked', 'ok', 'error')),
  CONSTRAINT kh_connections_result_ck CHECK (check_result IS NULL OR jsonb_typeof(check_result) = 'object'),
  CONSTRAINT kh_connections_version_ck CHECK (version >= 1),
  CONSTRAINT kh_connections_secret_fk FOREIGN KEY (secret_id) REFERENCES hub.secrets (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS kh_connections_name_uq ON hub.kh_connections (lower(name));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS kh_connections_url_uq ON hub.kh_connections (base_url);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS kh_connections_secret_idx ON hub.kh_connections (secret_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS hub.agent_kh (
  agent_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  position smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_kh_pkey PRIMARY KEY (agent_id, connection_id),
  CONSTRAINT agent_kh_position_uq UNIQUE (agent_id, position),
  CONSTRAINT agent_kh_position_ck CHECK (position BETWEEN 0 AND 4),
  CONSTRAINT agent_kh_agent_fk FOREIGN KEY (agent_id) REFERENCES hub.agents (id) ON DELETE CASCADE,
  CONSTRAINT agent_kh_conn_fk FOREIGN KEY (connection_id) REFERENCES hub.kh_connections (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_kh_conn_idx ON hub.agent_kh (connection_id);
--> statement-breakpoint

-- ── (2) dữ liệu run (tenant) ────────────────────────────────────────────────────────────────────────────────────────
-- KH + nhãn chốt lúc tạo job (plan D6); `items` = [{connection_id, name, summary_project, projects[]}] 1..5.
CREATE TABLE IF NOT EXISTS hub.kh_jobs (
  job_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  items jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kh_jobs_items_ck CHECK (jsonb_typeof(items) = 'array'
    AND jsonb_array_length(items) BETWEEN 1 AND 5),
  CONSTRAINT kh_jobs_job_fk FOREIGN KEY (job_id) REFERENCES hub.jobs (id) ON DELETE CASCADE
);
--> statement-breakpoint

-- Đếm `kh-query` theo (stage_run, attempt, round) — upsert nguyên tử `WHERE queries < 5` (plan D7).
CREATE TABLE IF NOT EXISTS hub.kh_stage_usage (
  stage_run_id uuid NOT NULL,
  attempt smallint NOT NULL,
  round smallint NOT NULL,
  tenant_id uuid NOT NULL,
  queries smallint NOT NULL DEFAULT 0,
  last_warning text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kh_stage_usage_pkey PRIMARY KEY (stage_run_id, attempt, round),
  CONSTRAINT kh_stage_usage_counts_ck CHECK (attempt >= 1 AND round >= 1 AND queries BETWEEN 0 AND 5),
  CONSTRAINT kh_stage_usage_warning_ck CHECK (last_warning IS NULL OR last_warning IN ('unreachable', 'timeout',
    'unauthorized', 'forbidden', 'not_found', 'invalid', 'rate_limited', 'server_error', 'disabled')),
  CONSTRAINT kh_stage_usage_stage_fk FOREIGN KEY (stage_run_id) REFERENCES hub.stage_runs (id) ON DELETE CASCADE
);
--> statement-breakpoint

-- Hàng chờ ghi `## Tóm tắt` (plan D8). `connection_id` KHÔNG FK: bộ gửi đọc lại kết nối, mất ⇒ `skipped`.
CREATE TABLE IF NOT EXISTS hub.kh_writes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  stage_run_id uuid NOT NULL,
  output_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  project_id text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  vector_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts smallint NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL DEFAULT now(),
  last_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kh_writes_output_uq UNIQUE (output_id),
  CONSTRAINT kh_writes_project_ck CHECK (project_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  CONSTRAINT kh_writes_subject_ck CHECK (char_length(subject) BETWEEN 1 AND 128),
  CONSTRAINT kh_writes_body_ck CHECK (char_length(body) BETWEEN 1 AND 4000),
  CONSTRAINT kh_writes_vector_ck CHECK (char_length(vector_id) BETWEEN 1 AND 255),
  CONSTRAINT kh_writes_status_ck CHECK (status IN ('pending', 'done', 'failed', 'skipped')),
  CONSTRAINT kh_writes_attempts_ck CHECK (attempts BETWEEN 0 AND 5),
  CONSTRAINT kh_writes_last_code_ck CHECK (last_code IS NULL OR char_length(last_code) <= 64),
  CONSTRAINT kh_writes_run_fk FOREIGN KEY (process_run_id, tenant_id) REFERENCES hub.process_runs (id, tenant_id)
    ON DELETE CASCADE,
  CONSTRAINT kh_writes_stage_fk FOREIGN KEY (stage_run_id) REFERENCES hub.stage_runs (id) ON DELETE CASCADE,
  CONSTRAINT kh_writes_output_fk FOREIGN KEY (output_id) REFERENCES hub.process_outputs (id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS kh_writes_due_idx ON hub.kh_writes (next_at) WHERE status = 'pending';
--> statement-breakpoint
-- Ngoài plan §5: FK CASCADE từ process_runs + `writesOf` theo run (spec-decisions K1-T4).
CREATE INDEX IF NOT EXISTS kh_writes_run_idx ON hub.kh_writes (process_run_id);
--> statement-breakpoint

-- ── (3) RLS "T" cho 3 bảng run (mẫu 0019/0028) ──────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
BEGIN
  FOREACH t IN ARRAY ARRAY['kh_jobs', 'kh_stage_usage', 'kh_writes'] LOOP
    EXECUTE format('ALTER TABLE hub.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = t
                   AND policyname = t || '_hub_rw') THEN
      EXECUTE format('CREATE POLICY %I ON hub.%I FOR ALL TO hub_rw USING %s WITH CHECK %s', t || '_hub_rw', t, v_t, v_t);
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint

-- ── (4) GRANT: hub_rw theo plan §5; không quyền cho hub_ro / agent_runtime / admin_rw ─────────────────────────────
REVOKE ALL ON hub.kh_connections, hub.agent_kh, hub.kh_jobs, hub.kh_stage_usage, hub.kh_writes FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON hub.kh_connections, hub.agent_kh, hub.kh_jobs, hub.kh_stage_usage, hub.kh_writes
  FROM hub_ro, agent_runtime, admin_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.kh_connections, hub.agent_kh TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT ON hub.kh_jobs TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hub.kh_stage_usage, hub.kh_writes TO hub_rw;
--> statement-breakpoint

-- ── (5) audit_log CHECK: + action check/degrade/write_fail, + entity kh_connection/kh_query/kh_worklog (giữ 0028) ────
DO $$ BEGIN
  ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_action_check;
  ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_action_check CHECK (
    action IN ('grant', 'revoke', 'view_trace', 'create', 'update', 'delete', 'enable', 'disable',
      'start', 'cancel', 'decide', 'review', 'answer', 'forward', 'view', 'copy', 'authorize_real_action', 'rotate',
      'check', 'degrade', 'write_fail')
  );
  ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_entity_check;
  ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_entity_check CHECK (
    entity IN ('agent_grant', 'run', 'agent', 'orchestrator', 'agent_entitlement', 'agent_default',
      'process_def', 'process_run', 'review_task', 'agent_team', 'secret', 'kh_connection', 'kh_query', 'kh_worklog')
  );
END $$;
