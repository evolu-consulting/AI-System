-- HUB-FR-75, WRK-FR-24 · plan H1 §1 P1–P3, §3.1–3.4, plan-db §3.3, plan-errors §Ghi: schema hub (cấu hình, hội thoại, runtime),
-- hàm hub.tenant_sub_limit, role hub_rw/hub_api/agent_runtime + GRANT. Viết tay, idempotent; chạy sau migrations/ (main) và
-- sau hoặc trước migrations-dev/0000_hub_stub (3 bảng stub giữ nguyên cột/CHECK/index). RLS bảng hội thoại: 0001 (D2).
-- Không FK hub.* → admin.* (P3). usage_logs không FK, không RLS.

-- ── Role (của cluster, idempotent) ─────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_rw') THEN
    CREATE ROLE hub_rw NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_api') THEN
    CREATE ROLE hub_api LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_runtime') THEN
    CREATE ROLE agent_runtime LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;
--> statement-breakpoint
ALTER ROLE hub_api NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
--> statement-breakpoint
ALTER ROLE agent_runtime NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
--> statement-breakpoint

-- ── §3.1 Cấu hình ────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.config_meta (
  id smallint NOT NULL,
  hub_config_version integer NOT NULL DEFAULT 0,
  CONSTRAINT config_meta_pkey PRIMARY KEY (id),
  CONSTRAINT config_meta_id_check CHECK (id = 1),
  CONSTRAINT config_meta_version_check CHECK (hub_config_version >= 0)
);
--> statement-breakpoint
INSERT INTO hub.config_meta (id, hub_config_version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.providers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  kind text NOT NULL,
  vendor text NOT NULL,
  base_url text,
  secret_id uuid,
  max_concurrency integer NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  dev_only boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT providers_pkey PRIMARY KEY (id),
  CONSTRAINT providers_key_uq UNIQUE (key),
  CONSTRAINT providers_key_check CHECK (key ~ '^[a-z][a-z0-9-]{1,47}$'),
  CONSTRAINT providers_kind_check CHECK (kind IN ('subscription', 'api')),
  CONSTRAINT providers_vendor_check CHECK (vendor IN ('anthropic', 'openai', 'google', 'fake')),
  CONSTRAINT providers_max_concurrency_check CHECK (max_concurrency BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.model_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  steps jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT model_profiles_key_uq UNIQUE (key),
  CONSTRAINT model_profiles_key_check CHECK (key ~ '^[a-z][a-z0-9-]{1,47}$'),
  CONSTRAINT model_profiles_steps_check CHECK (
    jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 5
  )
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.agents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL,
  name jsonb NOT NULL,
  description text NOT NULL,
  runtime text NOT NULL,
  agent_type_key text,
  profile_id uuid NOT NULL,
  system_prompt text NOT NULL DEFAULT '',
  runtime_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_s integer NOT NULL DEFAULT 600,
  token_budget integer,
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agents_pkey PRIMARY KEY (id),
  CONSTRAINT agents_key_uq UNIQUE (key),
  CONSTRAINT agents_key_check CHECK (key ~ '^[a-z][a-z0-9-]{1,47}$'),
  CONSTRAINT agents_description_check CHECK (char_length(description) BETWEEN 20 AND 400),
  CONSTRAINT agents_runtime_check CHECK (
    runtime IN ('agentic-cli', 'llm', 'python', 'dify-workflow', 'dify-agent')
  ),
  CONSTRAINT agents_timeout_s_check CHECK (timeout_s BETWEEN 10 AND 3600),
  CONSTRAINT agents_version_check CHECK (version >= 1),
  CONSTRAINT agents_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES hub.model_profiles (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.orchestrator_settings (
  id smallint NOT NULL,
  agent_id uuid NOT NULL,
  max_steps integer NOT NULL DEFAULT 5,
  token_budget integer NOT NULL DEFAULT 200000,
  history_n integer NOT NULL DEFAULT 10,
  on_no_match text NOT NULL DEFAULT 'answer',
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orchestrator_settings_pkey PRIMARY KEY (id),
  CONSTRAINT orchestrator_settings_id_check CHECK (id = 1),
  CONSTRAINT orchestrator_settings_max_steps_check CHECK (max_steps BETWEEN 1 AND 20),
  CONSTRAINT orchestrator_settings_history_n_check CHECK (history_n BETWEEN 1 AND 50),
  CONSTRAINT orchestrator_settings_on_no_match_check CHECK (on_no_match IN ('answer', 'ask')),
  CONSTRAINT orchestrator_settings_version_check CHECK (version >= 1),
  CONSTRAINT orchestrator_settings_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES hub.agents (id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.agent_entitlements (
  agent_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT agent_entitlements_pkey PRIMARY KEY (agent_id, tenant_id),
  CONSTRAINT agent_entitlements_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES hub.agents (id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_entitlements_tenant_active_idx ON hub.agent_entitlements (tenant_id)
  WHERE revoked_at IS NULL;
--> statement-breakpoint

-- ── 3 bảng stub (y hệt migrations-dev/0000_hub_stub + 0002; DB production chưa có) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.agent_workflows (
  agent_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_workflows_pkey PRIMARY KEY (agent_id, workflow_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_workflows_workflow_id_idx ON hub.agent_workflows (workflow_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.agent_grants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_grants_pkey PRIMARY KEY (id),
  CONSTRAINT agent_grants_uq UNIQUE (agent_id, tenant_id, subject_type, subject_id),
  CONSTRAINT agent_grants_subject_type_check CHECK (subject_type IN ('group', 'user'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_grants_subject_idx ON hub.agent_grants (tenant_id, subject_type, subject_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.usage_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  run_id uuid,
  step_id uuid,
  user_id uuid,
  feature_id uuid,
  agent_id uuid,
  provider_key text,
  model text,
  billing text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(14, 6),
  billable_usd numeric(14, 6),
  overage boolean NOT NULL DEFAULT false,
  latency_ms integer,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_logs_pkey PRIMARY KEY (id),
  CONSTRAINT usage_logs_billing_check CHECK (billing IN ('api', 'subscription', 'dify')),
  CONSTRAINT usage_logs_input_tokens_check CHECK (input_tokens >= 0),
  CONSTRAINT usage_logs_output_tokens_check CHECK (output_tokens >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS usage_logs_tenant_at_idx ON hub.usage_logs (tenant_id, at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS usage_logs_tenant_feature_at_idx ON hub.usage_logs (tenant_id, feature_id, at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS usage_logs_at_idx ON hub.usage_logs (at);
--> statement-breakpoint
-- FK NOT VALID: dòng cũ (fixture dev/test) không bị kiểm, dòng mới phải trỏ agent có thật.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_grants_agent_id_fkey'
                 AND conrelid = 'hub.agent_grants'::regclass) THEN
    ALTER TABLE hub.agent_grants ADD CONSTRAINT agent_grants_agent_id_fkey
      FOREIGN KEY (agent_id) REFERENCES hub.agents (id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_workflows_agent_id_fkey'
                 AND conrelid = 'hub.agent_workflows'::regclass) THEN
    ALTER TABLE hub.agent_workflows ADD CONSTRAINT agent_workflows_agent_id_fkey
      FOREIGN KEY (agent_id) REFERENCES hub.agents (id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$$;
--> statement-breakpoint
-- plan-db §3.3: thêm cột nullable, không default (INSERT của Admin M4 và test khoá không đổi).
ALTER TABLE hub.usage_logs
  ADD COLUMN IF NOT EXISTS job_id uuid,
  ADD COLUMN IF NOT EXISTS cache_read_tokens integer
    CONSTRAINT usage_logs_cache_read_tokens_check CHECK (cache_read_tokens >= 0),
  ADD COLUMN IF NOT EXISTS cache_write_tokens integer
    CONSTRAINT usage_logs_cache_write_tokens_check CHECK (cache_write_tokens >= 0);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS usage_logs_job_uq ON hub.usage_logs (job_id) WHERE job_id IS NOT NULL;
--> statement-breakpoint

-- ── §3.2 Hội thoại (RLS ở 0001) ─────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.conversations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  title text NOT NULL,
  title_norm text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT conversations_pkey PRIMARY KEY (id),
  CONSTRAINT conversations_title_check CHECK (char_length(title) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS conversations_user_list_idx
  ON hub.conversations (tenant_id, user_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.flows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  title text NOT NULL,
  agent_id uuid,
  pending_ask boolean NOT NULL DEFAULT false,
  message_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT flows_pkey PRIMARY KEY (id),
  CONSTRAINT flows_message_count_check CHECK (message_count >= 0),
  CONSTRAINT flows_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES hub.conversations (id) ON DELETE CASCADE,
  CONSTRAINT flows_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES hub.agents (id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS flows_conversation_idx ON hub.flows (conversation_id, created_at, id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  flow_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  run_id uuid,
  ask jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_role_check CHECK (role IN ('user', 'assistant')),
  CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES hub.conversations (id) ON DELETE CASCADE,
  CONSTRAINT messages_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES hub.flows (id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS messages_flow_idx ON hub.messages (flow_id, created_at, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON hub.messages (conversation_id, created_at, id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  flow_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'orchestrated',
  status text NOT NULL,
  config_version integer NOT NULL,
  user_message_id uuid NOT NULL,
  answer_message_id uuid NOT NULL,
  owner text,
  lease_until timestamptz,
  last_seq integer NOT NULL DEFAULT 0,
  tokens_used integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  error_hint text,
  locale text NOT NULL DEFAULT 'vi',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT runs_pkey PRIMARY KEY (id),
  CONSTRAINT runs_status_check CHECK (status IN ('running', 'finished', 'failed', 'cancelled')),
  CONSTRAINT runs_locale_check CHECK (locale IN ('vi', 'en')),
  CONSTRAINT runs_last_seq_check CHECK (last_seq >= 0),
  CONSTRAINT runs_tokens_used_check CHECK (tokens_used >= 0),
  CONSTRAINT runs_finished_ck CHECK ((status <> 'running') = (finished_at IS NOT NULL)),
  CONSTRAINT runs_error_code_ck CHECK (
    (error_code IS NOT NULL) = (status IN ('failed', 'cancelled'))
    AND (error_code IS NULL OR error_code IN ('ALL_PROVIDERS_EXHAUSTED', 'TIMEOUT', 'UPSTREAM_ERROR', 'CANCELLED',
                                              'BUDGET_EXCEEDED', 'NOT_CONFIGURED', 'INTERNAL_ERROR'))
  ),
  CONSTRAINT runs_error_cols_ck CHECK (
    (error_code IS NULL) = (error_message IS NULL) AND (error_code IS NULL) = (error_hint IS NULL)
  ),
  CONSTRAINT runs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES hub.conversations (id) ON DELETE CASCADE,
  CONSTRAINT runs_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES hub.flows (id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS runs_flow_running_uq ON hub.runs (flow_id) WHERE status = 'running';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runs_lease_idx ON hub.runs (lease_until) WHERE status = 'running';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runs_conversation_idx ON hub.runs (conversation_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.run_steps (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  run_id uuid NOT NULL,
  seq integer NOT NULL,
  type text NOT NULL,
  agent_id uuid,
  provider_key text,
  job_id uuid,
  label_key text NOT NULL,
  status text NOT NULL,
  detail jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT run_steps_pkey PRIMARY KEY (id),
  CONSTRAINT run_steps_run_seq_uq UNIQUE (run_id, seq),
  CONSTRAINT run_steps_type_check CHECK (type IN ('orchestrator', 'delegate')),
  CONSTRAINT run_steps_status_check CHECK (status IN ('running', 'ok', 'failed', 'skipped')),
  CONSTRAINT run_steps_run_id_fkey FOREIGN KEY (run_id) REFERENCES hub.runs (id) ON DELETE CASCADE
);
--> statement-breakpoint

-- ── plan-db §3.3 Runtime (Python ghi; không RLS — claim xuyên tenant) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  run_id uuid NOT NULL,
  step_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  type text NOT NULL,
  provider_key text NOT NULL,
  priority smallint NOT NULL DEFAULT 100,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  worker_id text,
  pgid integer,
  heartbeat_at timestamptz,
  cancel_requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb,
  error_code text,
  error_reason text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_pkey PRIMARY KEY (id),
  CONSTRAINT jobs_type_check CHECK (type IN ('agent.cli', 'agent.run')),
  CONSTRAINT jobs_status_check CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out')
  ),
  CONSTRAINT jobs_attempts_check CHECK (attempts >= 0),
  CONSTRAINT jobs_error_code_check CHECK (
    error_code IS NULL
    OR error_code IN ('ALL_PROVIDERS_EXHAUSTED', 'TIMEOUT', 'CANCELLED', 'UPSTREAM_ERROR', 'INTERNAL_ERROR')
  ),
  CONSTRAINT jobs_error_reason_check CHECK (
    error_reason IS NULL
    OR error_reason IN ('quota', 'tenant_slots', 'provider_busy', 'provider_unavailable', 'orphaned', 'crash',
                        'cancelled', 'timeout', 'invalid_payload', 'invalid_output', 'sandbox')
  ),
  CONSTRAINT jobs_error_message_check CHECK (error_message IS NULL OR char_length(error_message) <= 500),
  CONSTRAINT jobs_run_id_fkey FOREIGN KEY (run_id) REFERENCES hub.runs (id) ON DELETE CASCADE,
  CONSTRAINT jobs_provider_key_fkey FOREIGN KEY (provider_key) REFERENCES hub.providers (key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON hub.jobs (priority, created_at, id) WHERE status = 'queued';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_provider_key_idx ON hub.jobs (provider_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_tenant_running_idx ON hub.jobs (tenant_id) WHERE status = 'running';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_conversation_agent_active_idx ON hub.jobs (conversation_id, agent_id)
  WHERE status IN ('queued', 'running');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_run_idx ON hub.jobs (run_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_heartbeat_running_idx ON hub.jobs (heartbeat_at) WHERE status = 'running';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS jobs_worker_running_idx ON hub.jobs (worker_id) WHERE status = 'running';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.cli_sessions (
  conversation_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  provider_key text NOT NULL,
  tenant_id uuid NOT NULL,
  session_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cli_sessions_pkey PRIMARY KEY (conversation_id, agent_id, provider_key),
  CONSTRAINT cli_sessions_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES hub.conversations (id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.provider_state (
  provider_key text NOT NULL,
  status text NOT NULL DEFAULT 'ok',
  cooldown_until timestamptz,
  last_error text,
  consecutive_errors integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_state_pkey PRIMARY KEY (provider_key),
  CONSTRAINT provider_state_status_check CHECK (status IN ('ok', 'busy', 'cooldown', 'error', 'logged_out')),
  CONSTRAINT provider_state_last_error_check CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  CONSTRAINT provider_state_consecutive_errors_check CHECK (consecutive_errors >= 0),
  CONSTRAINT provider_state_provider_key_fkey FOREIGN KEY (provider_key) REFERENCES hub.providers (key) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.agent_types (
  key text NOT NULL,
  runtime text NOT NULL,
  description jsonb NOT NULL,
  config_schema jsonb NOT NULL,
  version integer NOT NULL,
  worker_id text NOT NULL,
  available boolean NOT NULL DEFAULT true,
  registered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_types_pkey PRIMARY KEY (key),
  CONSTRAINT agent_types_key_check CHECK (key ~ '^[a-z][a-z0-9-]{1,47}$'),
  CONSTRAINT agent_types_runtime_check CHECK (runtime IN ('agentic-cli', 'llm', 'python')),
  CONSTRAINT agent_types_version_check CHECK (version >= 1)
);
--> statement-breakpoint

-- ── Hàm slot tenant (Runtime không có quyền admin.*) ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION hub.tenant_sub_limit(p_tenant_id uuid) RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT t.max_concurrent_sub FROM admin.tenants t WHERE t.id = p_tenant_id $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.tenant_sub_limit(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.tenant_sub_limit(uuid) TO agent_runtime;
--> statement-breakpoint

-- ── GRANT (§3.4) ─────────────────────────────────────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA hub TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.conversations, hub.flows, hub.messages, hub.runs, hub.run_steps TO hub_rw;
--> statement-breakpoint
GRANT SELECT ON hub.config_meta, hub.providers, hub.model_profiles, hub.agents, hub.orchestrator_settings,
  hub.agent_entitlements, hub.agent_grants, hub.agent_workflows, hub.provider_state, hub.agent_types TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hub.jobs TO hub_rw;
--> statement-breakpoint
GRANT SELECT ON hub.usage_logs TO hub_rw;
--> statement-breakpoint
GRANT hub_rw, hub_ro TO hub_api;
--> statement-breakpoint
GRANT USAGE ON SCHEMA hub TO agent_runtime;
--> statement-breakpoint
GRANT SELECT, UPDATE ON hub.jobs TO agent_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON hub.usage_logs TO agent_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.cli_sessions TO agent_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hub.provider_state, hub.agent_types TO agent_runtime;
--> statement-breakpoint
GRANT SELECT ON hub.providers TO agent_runtime;
--> statement-breakpoint
GRANT SELECT ON hub.agent_workflows, hub.agent_grants, hub.usage_logs TO admin_rw;
