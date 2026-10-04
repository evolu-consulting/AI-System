-- HUB-FR-95 · WRK-FR-06 · plan H2a §3, plan-db §1.1–1.2 (D1): cột/CHECK cho lệnh + workflow Dify, token job MCP,
-- hàng đợi async, provider `dify`, bảng tool_confirmations (RLS như 5 bảng hội thoại, H1 §3.4) + workflow_flags, GRANT.
-- Viết tay, idempotent (IF NOT EXISTS; đổi CHECK qua DO $$ … pg_constraint): chạy được trên DB sạch và DB có stub.
-- Chỉ nới tập giá trị / bỏ NOT NULL — không mất dữ liệu. Hàm SECURITY DEFINER (D2) ở cuối file.

-- ── runs: lệnh (kind = 'command') ────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE hub.runs ADD COLUMN IF NOT EXISTS command_id uuid, ADD COLUMN IF NOT EXISTS feature_id uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_kind_check' AND conrelid = 'hub.runs'::regclass) THEN
    ALTER TABLE hub.runs ADD CONSTRAINT runs_kind_check CHECK (kind IN ('orchestrated', 'command'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_command_ck' AND conrelid = 'hub.runs'::regclass) THEN
    ALTER TABLE hub.runs ADD CONSTRAINT runs_command_ck CHECK ((kind = 'command') = (command_id IS NOT NULL));
  END IF;
END
$$;
--> statement-breakpoint

-- ── run_steps: bước workflow / tool ──────────────────────────────────────────────────────────────────────────────────
ALTER TABLE hub.run_steps ADD COLUMN IF NOT EXISTS workflow_id uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'run_steps_type_check'
                 AND conrelid = 'hub.run_steps'::regclass AND pg_get_constraintdef(oid) LIKE '%''tool''%') THEN
    ALTER TABLE hub.run_steps DROP CONSTRAINT IF EXISTS run_steps_type_check;
    ALTER TABLE hub.run_steps ADD CONSTRAINT run_steps_type_check
      CHECK (type IN ('orchestrator', 'delegate', 'workflow', 'tool'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'run_steps_workflow_ck'
                 AND conrelid = 'hub.run_steps'::regclass) THEN
    ALTER TABLE hub.run_steps ADD CONSTRAINT run_steps_workflow_ck
      CHECK ((type IN ('workflow', 'tool')) = (workflow_id IS NOT NULL));
  END IF;
END
$$;
--> statement-breakpoint

-- ── jobs: token MCP (P4/RT1), hàng đợi async (queued_at/dispatched_at), workflow.async không có agent ────────────────
ALTER TABLE hub.jobs
  ADD COLUMN IF NOT EXISTS token_hash bytea,
  ADD COLUMN IF NOT EXISTS queued_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
--> statement-breakpoint
ALTER TABLE hub.jobs ALTER COLUMN agent_id DROP NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_type_check'
                 AND conrelid = 'hub.jobs'::regclass AND pg_get_constraintdef(oid) LIKE '%''workflow.async''%') THEN
    ALTER TABLE hub.jobs DROP CONSTRAINT IF EXISTS jobs_type_check;
    ALTER TABLE hub.jobs ADD CONSTRAINT jobs_type_check CHECK (type IN ('agent.cli', 'agent.run', 'workflow.async'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_agent_ck' AND conrelid = 'hub.jobs'::regclass) THEN
    ALTER TABLE hub.jobs ADD CONSTRAINT jobs_agent_ck CHECK (type = 'workflow.async' OR agent_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_token_hash_ck' AND conrelid = 'hub.jobs'::regclass) THEN
    ALTER TABLE hub.jobs ADD CONSTRAINT jobs_token_hash_ck CHECK (token_hash IS NULL OR octet_length(token_hash) = 32);
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS jobs_token_hash_uq ON hub.jobs (token_hash) WHERE token_hash IS NOT NULL;
--> statement-breakpoint

-- ── providers: vendor dify ───────────────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_vendor_check'
                 AND conrelid = 'hub.providers'::regclass AND pg_get_constraintdef(oid) LIKE '%''dify''%') THEN
    ALTER TABLE hub.providers DROP CONSTRAINT IF EXISTS providers_vendor_check;
    ALTER TABLE hub.providers ADD CONSTRAINT providers_vendor_check
      CHECK (vendor IN ('anthropic', 'openai', 'google', 'fake', 'dify'));
  END IF;
END
$$;
--> statement-breakpoint

-- ── tool_confirmations (R21–R22, plan-db §3) ─────────────────────────────────────────────────────────────────────────
-- `<=` trên boolean = "kéo theo": confirmed/consumed ⇒ có decided_run_id.
CREATE TABLE IF NOT EXISTS hub.tool_confirmations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  flow_id uuid NOT NULL,
  run_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  workflow_id uuid NOT NULL,
  status text NOT NULL,
  decided_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  consumed_at timestamptz,
  CONSTRAINT tool_confirmations_pkey PRIMARY KEY (id),
  CONSTRAINT tool_confirmations_status_check
    CHECK (status IN ('pending', 'confirmed', 'declined', 'consumed', 'expired')),
  CONSTRAINT tool_confirmations_decided_ck
    CHECK ((status IN ('confirmed', 'consumed')) <= (decided_run_id IS NOT NULL)),
  CONSTRAINT tool_confirmations_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES hub.flows (id) ON DELETE CASCADE,
  CONSTRAINT tool_confirmations_run_id_fkey FOREIGN KEY (run_id) REFERENCES hub.runs (id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS tool_confirmations_open_uq
  ON hub.tool_confirmations (flow_id, agent_id, workflow_id) WHERE status IN ('pending', 'confirmed');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS tool_confirmations_run_idx ON hub.tool_confirmations (run_id);
--> statement-breakpoint
ALTER TABLE hub.tool_confirmations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'tool_confirmations'
                 AND policyname = 'tool_confirmations_hub_rw') THEN
    CREATE POLICY tool_confirmations_hub_rw ON hub.tool_confirmations FOR ALL TO hub_rw
      USING (current_setting('app.scope', true) = 'system'
             OR (current_setting('app.scope', true) = 'user'
                 AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
                 AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
      WITH CHECK (current_setting('app.scope', true) = 'system'
             OR (current_setting('app.scope', true) = 'user'
                 AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
                 AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
  END IF;
END
$$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.tool_confirmations TO hub_rw;
--> statement-breakpoint

-- ── workflow_flags (P14: cờ side_effect dự phòng, seed ghi bằng owner) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.workflow_flags (
  workflow_id uuid NOT NULL,
  side_effect boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_flags_pkey PRIMARY KEY (workflow_id)
);
--> statement-breakpoint
GRANT SELECT ON hub.workflow_flags TO hub_rw;
--> statement-breakpoint
-- dify-agent (R14) giữ session hội thoại; mọi câu lọc tenant_id.
GRANT SELECT, INSERT, UPDATE ON hub.cli_sessions TO hub_rw;
