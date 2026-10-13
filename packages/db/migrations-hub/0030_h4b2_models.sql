-- HUB-FR-66 · HUB-FR-67 · HUB-FR-78 · H4b-2 Models (spec H4b2 §4 #1–#5, plan D1/D6/D9).
-- Viết tay, idempotent như 0028/0029 (IF NOT EXISTS / DO $$ kiểm pg_constraint). Chỉ THÊM cột/GRANT/CHECK — không bảng
-- mới, không mất dữ liệu. Không RLS mới: providers/model_profiles/provider_state là cấu hình nền tảng (HUB-BR-15),
-- cách ly bằng role + requirePlatformAdmin; ghi chạy scope `system` trong withConfigWrite.

-- ── (1) Khoá lạc quan: cột version (hàng cũ = 1) ────────────────────────────────────────────────────────────────────
ALTER TABLE hub.providers ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE hub.model_profiles ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_version_check'
                 AND conrelid = 'hub.providers'::regclass) THEN
    ALTER TABLE hub.providers ADD CONSTRAINT providers_version_check CHECK (version >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'model_profiles_version_check'
                 AND conrelid = 'hub.model_profiles'::regclass) THEN
    ALTER TABLE hub.model_profiles ADD CONSTRAINT model_profiles_version_check CHECK (version >= 1);
  END IF;
END $$;
--> statement-breakpoint

-- ── (2)(3) GRANT theo cột cho hub_rw: key/kind/vendor/dev_only provider và key profile bất biến (Q8) ─────────────────
GRANT INSERT, DELETE ON hub.providers, hub.model_profiles TO hub_rw;
--> statement-breakpoint
GRANT UPDATE (base_url, secret_id, max_concurrency, enabled, version, updated_at) ON hub.providers TO hub_rw;
--> statement-breakpoint
GRANT UPDATE (steps, version, updated_at) ON hub.model_profiles TO hub_rw;
--> statement-breakpoint

-- ── (4) "Kiểm tra lại" subscription: chỉ xoá mốc probe (plan D9); status/updated_at vẫn do Runtime sở hữu ───────────
GRANT UPDATE (last_probe_at, last_ok_at) ON hub.provider_state TO hub_rw;
--> statement-breakpoint

-- ── (5) audit_log CHECK entity: + provider, model_profile (giữ toàn bộ giá trị 0029; action không đổi) ─────────────
DO $$ BEGIN
  ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_entity_check;
  ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_entity_check CHECK (
    entity IN ('agent_grant', 'run', 'agent', 'orchestrator', 'agent_entitlement', 'agent_default',
      'process_def', 'process_run', 'review_task', 'agent_team', 'secret', 'kh_connection', 'kh_query', 'kh_worklog',
      'provider', 'model_profile')
  );
END $$;
