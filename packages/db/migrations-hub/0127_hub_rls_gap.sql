-- CR-125 B1 · S1a — RLS cho 9 bảng hub có `tenant_id` mà trước đây chỉ cách ly bằng `WHERE` viết tay (sa-review B1).
-- Bảng: audit_log, agent_grants, agent_entitlements, tenant_agent_defaults, agent_team_entitlements, orchestrator_settings,
-- jobs, usage_logs, cli_sessions. Vị từ giống 0019: T = scope 'system' ∨ (scope 'user' ∧ tenant_id = app.tenant_id).
-- • hub_rw: T cho FOR ALL (quyền thao tác vẫn do GRANT hiện có giới hạn). orchestrator_settings: đọc T ∨ hàng mặc định
--   (tenant_id NULL); ghi chỉ system (Studio chạy scope system), như process_defs. Màn tenant cần biết "agent nào là điều
--   phối" của mọi tenant ⇒ hàm DEFINER `hub.orchestrator_agent_ids()` (chỉ trả agent_id).
-- • agent_runtime (worker, tiến trình hệ thống tin cậy — claim/heartbeat/ghi usage xuyên tenant, như 0022): USING (true)
--   trên jobs, cli_sessions, usage_logs ⇒ kế hoạch claim không đổi.
-- • admin_rw: SELECT usage_logs, agent_grants theo vị từ usage_daily (0049): scope 'platform' ∨ (scope 'tenant' ∧ tenant khớp).
-- • hub_ro không có GRANT trên các bảng này ⇒ không cần policy.
-- KHÔNG FORCE (owner + hàm SECURITY DEFINER do owner sở hữu vẫn thấy hết; FORCE để 0128). ai_token_holds, dify_runs giữ
-- không RLS (chỉ qua hàm DEFINER) — allowlist trong packages/db/src/hub-rls-coverage.int.test.ts.
CREATE OR REPLACE FUNCTION hub.orchestrator_agent_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, hub AS $$
  SELECT DISTINCT agent_id FROM hub.orchestrator_settings WHERE agent_id IS NOT NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.orchestrator_agent_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.orchestrator_agent_ids() TO hub_rw;
--> statement-breakpoint
DO $$
DECLARE
  t text;
  v_t constant text := '(current_setting(''app.scope'', true) = ''system'' OR (current_setting(''app.scope'', true) = '
    || '''user'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
  v_sys constant text := '(current_setting(''app.scope'', true) = ''system'')';
  v_adm constant text := '(current_setting(''app.scope'', true) = ''platform'' OR (current_setting(''app.scope'', true) = '
    || '''tenant'' AND tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid))';
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_log', 'agent_grants', 'agent_entitlements', 'tenant_agent_defaults',
                           'agent_team_entitlements', 'orchestrator_settings', 'jobs', 'usage_logs', 'cli_sessions'] LOOP
    EXECUTE format('ALTER TABLE hub.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  -- hub_rw: T (FOR ALL) cho 8 bảng.
  FOREACH t IN ARRAY ARRAY['audit_log', 'agent_grants', 'agent_entitlements', 'tenant_agent_defaults',
                           'agent_team_entitlements', 'jobs', 'usage_logs', 'cli_sessions'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = t
                   AND policyname = t || '_hub_rw') THEN
      EXECUTE format('CREATE POLICY %I ON hub.%I FOR ALL TO hub_rw USING %s WITH CHECK %s', t || '_hub_rw', t, v_t, v_t);
    END IF;
  END LOOP;
  -- orchestrator_settings: đọc T ∨ mặc định; ghi chỉ system.
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'orchestrator_settings'
                 AND policyname = 'orchestrator_settings_select') THEN
    EXECUTE format('CREATE POLICY orchestrator_settings_select ON hub.orchestrator_settings FOR SELECT TO hub_rw '
      || 'USING (%s OR tenant_id IS NULL)', v_t);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'orchestrator_settings'
                 AND policyname = 'orchestrator_settings_insert') THEN
    EXECUTE format('CREATE POLICY orchestrator_settings_insert ON hub.orchestrator_settings FOR INSERT TO hub_rw '
      || 'WITH CHECK %s', v_sys);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'orchestrator_settings'
                 AND policyname = 'orchestrator_settings_update') THEN
    EXECUTE format('CREATE POLICY orchestrator_settings_update ON hub.orchestrator_settings FOR UPDATE TO hub_rw '
      || 'USING %s WITH CHECK %s', v_sys, v_sys);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'orchestrator_settings'
                 AND policyname = 'orchestrator_settings_delete') THEN
    EXECUTE format('CREATE POLICY orchestrator_settings_delete ON hub.orchestrator_settings FOR DELETE TO hub_rw '
      || 'USING %s', v_sys);
  END IF;
  -- agent_runtime: worker tin cậy, xuyên tenant.
  FOREACH t IN ARRAY ARRAY['jobs', 'usage_logs', 'cli_sessions'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = t
                   AND policyname = t || '_agent_runtime') THEN
      EXECUTE format('CREATE POLICY %I ON hub.%I FOR ALL TO agent_runtime USING (true) WITH CHECK (true)',
        t || '_agent_runtime', t);
    END IF;
  END LOOP;
  -- admin_rw: chỉ đọc, theo scope admin.
  FOREACH t IN ARRAY ARRAY['usage_logs', 'agent_grants'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = t
                   AND policyname = t || '_admin_rw') THEN
      EXECUTE format('CREATE POLICY %I ON hub.%I FOR SELECT TO admin_rw USING %s', t || '_admin_rw', t, v_adm);
    END IF;
  END LOOP;
END $$;
