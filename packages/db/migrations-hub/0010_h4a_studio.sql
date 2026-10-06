-- HUB-FR-60 · HUB-FR-69 · H4a plan §6 (D1–D4): Studio ghi cấu hình agent/orchestrator từ API, audit mở rộng, index HAS_HISTORY.
-- D1: hub_rw ghi agents/agent_workflows/orchestrator_settings (trước chỉ owner qua `hub:seed`). Không RLS mới — cách ly bằng role.
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.agents, hub.agent_workflows TO hub_rw;
GRANT INSERT, UPDATE, DELETE ON hub.orchestrator_settings TO hub_rw;
GRANT USAGE ON SEQUENCE hub.orchestrator_settings_id_seq TO hub_rw;
--> statement-breakpoint
-- D2 (R03, QB4): agent dify-*/python không cần profile; llm/agentic-cli vẫn bắt buộc. Không đổi hàng nào.
ALTER TABLE hub.agents ALTER COLUMN profile_id DROP NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_profile_required_ck'
                 AND conrelid = 'hub.agents'::regclass) THEN
    ALTER TABLE hub.agents ADD CONSTRAINT agents_profile_required_ck
      CHECK (runtime NOT IN ('llm', 'agentic-cli') OR profile_id IS NOT NULL);
  END IF;
END $$;
--> statement-breakpoint
-- D3 (FR-69, QB6): audit cấu hình hệ thống (tenant_id null = phạm vi system); thêm action/entity Studio. Hàng cũ thoả CHECK mới.
ALTER TABLE hub.audit_log ALTER COLUMN tenant_id DROP NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_action_check;
  ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_action_check CHECK (
    action IN ('grant', 'revoke', 'view_trace', 'create', 'update', 'delete', 'enable', 'disable')
  );
  ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_entity_check;
  ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_entity_check CHECK (
    entity IN ('agent_grant', 'run', 'agent', 'orchestrator')
  );
END $$;
--> statement-breakpoint
-- D4: HAS_HISTORY (xoá agent đã có run ⇒ 409). Prod: tạo CONCURRENTLY thủ công trước khi migrate (PRODUCTION-NOTES, như K12 H3b).
CREATE INDEX IF NOT EXISTS runs_agent_idx ON hub.runs (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS run_steps_agent_idx ON hub.run_steps (agent_id) WHERE agent_id IS NOT NULL;
