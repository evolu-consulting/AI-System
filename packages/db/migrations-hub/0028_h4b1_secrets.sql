-- HUB-FR-68 · HUB-FR-69 · HUB-FR-04 · HUB-BR-15 · HUB-BR-30 · secrets của Hub (spec H4b-1 §4, plan D6–D9).
-- Viết tay, idempotent như 0021 (IF NOT EXISTS / DO $$ kiểm pg_constraint·pg_policies). Chỉ THÊM bảng/index/hàm/FK +
-- nới audit CHECK — không mất dữ liệu. Bản mã AES-256-GCM do app ghi (AAD `hub.secrets:<id>:<kind>:<tenant|->:<kv>`).

-- ── (1) hub.secrets (RLS "T" + hàng nền tảng chỉ ở scope system) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  tenant_id uuid,
  name text NOT NULL,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  key_version smallint NOT NULL DEFAULT 1,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT secrets_kind_ck CHECK (kind IN ('provider_api_key', 'kh_api_key', 'source_credential')),
  CONSTRAINT secrets_scope_ck CHECK ((kind = 'provider_api_key' AND tenant_id IS NULL)
    OR (kind = 'source_credential' AND tenant_id IS NOT NULL) OR kind = 'kh_api_key'),
  CONSTRAINT secrets_name_ck CHECK (name ~ '^[A-Za-z0-9_-]{2,64}$'),
  -- bản mã ‖ tag 16 byte; 2048 đơn vị UTF-16 × ≤ 4 byte + 16
  CONSTRAINT secrets_ciphertext_ck CHECK (octet_length(ciphertext) BETWEEN 16 AND 8208),
  CONSTRAINT secrets_iv_ck CHECK (octet_length(iv) = 12),
  CONSTRAINT secrets_key_version_ck CHECK (key_version >= 1),
  CONSTRAINT secrets_version_ck CHECK (version >= 1)
);
--> statement-breakpoint
-- Duy nhất không phân biệt hoa-thường theo (kind, tenant) — nền tảng gộp về uuid 0 (Q4).
CREATE UNIQUE INDEX IF NOT EXISTS secrets_name_uq ON hub.secrets
  (kind, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS secrets_list_idx ON hub.secrets (tenant_id, kind, lower(name), id);
--> statement-breakpoint

-- ── (2) RLS: system thấy hết; user chỉ hàng tenant mình (không thấy nền tảng) ──────────────────────────────────────
ALTER TABLE hub.secrets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id IS NOT NULL AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'secrets'
                 AND policyname = 'secrets_hub_rw') THEN
    EXECUTE format('CREATE POLICY secrets_hub_rw ON hub.secrets FOR ALL TO hub_rw USING %s WITH CHECK %s', v_t, v_t);
  END IF;
END
$$;
--> statement-breakpoint

-- ── (3) GRANT theo cột: hub_rw KHÔNG SELECT ciphertext/iv (plan D6); không quyền cho hub_ro/agent_runtime/admin_rw ──
REVOKE ALL ON hub.secrets FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON hub.secrets FROM hub_ro, agent_runtime, admin_rw;
--> statement-breakpoint
REVOKE ALL ON hub.secrets FROM hub_rw;
--> statement-breakpoint
GRANT SELECT (id, kind, tenant_id, name, key_version, version, created_by, updated_by, created_at, updated_at)
  ON hub.secrets TO hub_rw;
--> statement-breakpoint
GRANT INSERT, UPDATE, DELETE ON hub.secrets TO hub_rw;
--> statement-breakpoint

-- ── (4) Đọc bản mã CHỈ qua hàm: đúng bộ (id, kind, tenant) + scope (user không mở secret tenant khác) ──────────────
-- Chặt hơn chữ spec §4 một chút: scope phải là 'system' hoặc 'user' (không đặt scope ⇒ 0 hàng, như RLS).
CREATE OR REPLACE FUNCTION hub.secret_material(p_id uuid, p_kind text, p_tenant uuid)
  RETURNS TABLE (ciphertext bytea, iv bytea, key_version smallint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, hub
  AS $$
  SELECT s.ciphertext, s.iv, s.key_version
  FROM hub.secrets s
  WHERE s.id = p_id AND s.kind = p_kind AND s.tenant_id IS NOT DISTINCT FROM p_tenant
    AND (current_setting('app.scope', true) = 'system'
      OR (current_setting('app.scope', true) = 'user'
        AND (p_tenant IS NULL OR p_tenant = NULLIF(current_setting('app.tenant_id', true), '')::uuid)))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.secret_material(uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.secret_material(uuid, text, uuid) TO hub_rw;
--> statement-breakpoint

-- ── (5) FK providers.secret_id RESTRICT (Q5): NOT VALID rồi VALIDATE khi không mồ côi; mồ côi ⇒ giữ NOT VALID ──────
CREATE INDEX IF NOT EXISTS providers_secret_idx ON hub.providers (secret_id) WHERE secret_id IS NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_secret_fk'
                 AND conrelid = 'hub.providers'::regclass) THEN
    ALTER TABLE hub.providers ADD CONSTRAINT providers_secret_fk FOREIGN KEY (secret_id)
      REFERENCES hub.secrets (id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_secret_fk'
             AND conrelid = 'hub.providers'::regclass AND NOT convalidated) THEN
    IF EXISTS (SELECT 1 FROM hub.providers p WHERE p.secret_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM hub.secrets s WHERE s.id = p.secret_id)) THEN
      RAISE NOTICE 'providers_secret_fk giữ NOT VALID: có hub.providers.secret_id mồ côi (không sửa dữ liệu)';
    ELSE
      ALTER TABLE hub.providers VALIDATE CONSTRAINT providers_secret_fk;
    END IF;
  END IF;
END
$$;
--> statement-breakpoint

-- ── (6) audit_log CHECK: + action 'rotate', + entity 'secret' (giữ toàn bộ giá trị 0019) ────────────────────────────
DO $$ BEGIN
  ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_action_check;
  ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_action_check CHECK (
    action IN ('grant', 'revoke', 'view_trace', 'create', 'update', 'delete', 'enable', 'disable',
      'start', 'cancel', 'decide', 'review', 'answer', 'forward', 'view', 'copy', 'authorize_real_action', 'rotate')
  );
  ALTER TABLE hub.audit_log DROP CONSTRAINT IF EXISTS hub_audit_log_entity_check;
  ALTER TABLE hub.audit_log ADD CONSTRAINT hub_audit_log_entity_check CHECK (
    entity IN ('agent_grant', 'run', 'agent', 'orchestrator', 'agent_entitlement', 'agent_default',
      'process_def', 'process_run', 'review_task', 'agent_team', 'secret')
  );
END $$;
