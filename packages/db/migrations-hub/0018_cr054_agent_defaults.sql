-- HUB-FR-77 · HUB-FR-78 · HUB-FR-60 · CR-054: agent mặc định theo tenant + Orchestrator đi qua cấp quyền + cấp "cả công ty"
-- + model theo agent + danh mục model thật do Runtime đọc từ CLI.
-- (1) `hub.tenant_agent_defaults`: 1 hàng/tenant (vắng ⇒ hành vi cũ: tin không tag → Orchestrator, không cần grant).
--     `on_no_match`: fallback (giao `fallback_agent_id`) · answer (Orchestrator tự trả lời) · ask (hỏi lại).
--     Không RLS (như agent_grants/entitlements: bảng cấu hình, kiểm quyền ở API — tenant_admin chỉ tenant mình).
-- (2) `agent_grants.subject_type` thêm 'tenant' (subject_id = tenant_id) = "Cả công ty".
-- (3) `agents.model` (NULL = theo model profile): ghi đè model các bước của job `agent.cli`.
-- (4) `hub.provider_models`: danh mục model Runtime đọc từ Claude CLI (`initialize.models`), Studio chỉ đọc.
-- (5) `hub_rw` ghi `agent_entitlements` (bật/tắt agent cho tenant — chỉ platform_admin, kiểm ở API).
CREATE TABLE IF NOT EXISTS hub.tenant_agent_defaults (
  tenant_id uuid NOT NULL,
  default_agent_id uuid NOT NULL,
  fallback_agent_id uuid,
  on_no_match text NOT NULL DEFAULT 'fallback',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_agent_defaults_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT tenant_agent_defaults_default_fk FOREIGN KEY (default_agent_id) REFERENCES hub.agents (id),
  CONSTRAINT tenant_agent_defaults_fallback_fk FOREIGN KEY (fallback_agent_id) REFERENCES hub.agents (id),
  CONSTRAINT tenant_agent_defaults_no_match_ck CHECK (on_no_match IN ('fallback', 'answer', 'ask')),
  CONSTRAINT tenant_agent_defaults_fallback_ck CHECK (on_no_match <> 'fallback' OR fallback_agent_id IS NOT NULL)
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON hub.tenant_agent_defaults TO hub_rw;
--> statement-breakpoint
ALTER TABLE hub.agent_grants DROP CONSTRAINT IF EXISTS agent_grants_subject_type_check;
--> statement-breakpoint
ALTER TABLE hub.agent_grants ADD CONSTRAINT agent_grants_subject_type_check
  CHECK (subject_type IN ('group', 'user', 'tenant'));
--> statement-breakpoint
ALTER TABLE hub.agent_grants DROP CONSTRAINT IF EXISTS agent_grants_tenant_subject_ck;
--> statement-breakpoint
ALTER TABLE hub.agent_grants ADD CONSTRAINT agent_grants_tenant_subject_ck
  CHECK (subject_type <> 'tenant' OR subject_id = tenant_id);
--> statement-breakpoint
ALTER TABLE hub.agents ADD COLUMN IF NOT EXISTS model text;
--> statement-breakpoint
ALTER TABLE hub.agents DROP CONSTRAINT IF EXISTS agents_model_ck;
--> statement-breakpoint
ALTER TABLE hub.agents ADD CONSTRAINT agents_model_ck CHECK (model IS NULL OR char_length(model) BETWEEN 1 AND 100);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS hub.provider_models (
  provider_key text NOT NULL,
  value text NOT NULL,
  resolved_model text,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_models_pkey PRIMARY KEY (provider_key, value),
  CONSTRAINT provider_models_provider_fk FOREIGN KEY (provider_key) REFERENCES hub.providers (key) ON DELETE CASCADE,
  CONSTRAINT provider_models_value_ck CHECK (char_length(value) BETWEEN 1 AND 100),
  CONSTRAINT provider_models_display_ck CHECK (char_length(display_name) BETWEEN 1 AND 100),
  CONSTRAINT provider_models_desc_ck CHECK (char_length(description) <= 300)
);
--> statement-breakpoint
GRANT SELECT ON hub.provider_models TO hub_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.provider_models TO agent_runtime;
--> statement-breakpoint
GRANT SELECT ON hub.providers TO agent_runtime;
--> statement-breakpoint
GRANT INSERT, UPDATE (revoked_at, granted_by, granted_at) ON hub.agent_entitlements TO hub_rw;
--> statement-breakpoint
-- (6) audit: entity mới cho bật/tắt agent theo tenant và agent mặc định (hàng cũ thoả CHECK mới).
DO $$ BEGIN
  ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_entity_check;
  ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_entity_check CHECK (
    entity IN ('agent_grant', 'run', 'agent', 'orchestrator', 'agent_entitlement', 'agent_default')
  );
END $$;
