-- ADM-NFR-06 · spec M0 §4.2: stub 3 bảng hub.* chỉ cho Admin dev/test đọc (APP_ENV development|test).
-- Hub thật sở hữu các bảng này bằng migration của Hub; không chạy ở production.
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
GRANT SELECT ON hub.agent_workflows, hub.agent_grants, hub.usage_logs TO admin_rw;
