-- HUB-FR-95 · plan H2a §1 P1–P2, plan-db §1.3 (D2): hàm SECURITY DEFINER cho Hub (mẫu `hub.tenant_sub_limit`, 0000).
-- Tách khỏi 0002 (đã áp trên DB dev, Drizzle không chạy lại file đã ghi). Viết tay, idempotent (CREATE OR REPLACE).
-- Chủ hàm = role chạy migration (owner, chủ `admin.secrets` và `hub.usage_logs`) → đọc/ghi bỏ qua RLS (không FORCE).

-- ── Q1/P1: secret gắn workflow — chỉ hub_ro EXECUTE; KHÔNG GRANT cột admin.secrets (test khoá M2/M3 giữ 42501) ────────
-- hub_ro cần USAGE schema hub để gọi hàm (không kèm quyền bảng nào: hub.* không có default privileges cho hub_ro).
GRANT USAGE ON SCHEMA hub TO hub_ro;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.workflow_secret(p_workflow_id uuid)
  RETURNS TABLE (secret_id uuid, ciphertext bytea, iv bytea, key_version smallint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT s.id, s.ciphertext, s.iv, s.key_version
  FROM admin.workflows w JOIN admin.secrets s ON s.id = w.secret_id
  WHERE w.id = p_workflow_id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.workflow_secret(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.workflow_secret(uuid) TO hub_ro;
--> statement-breakpoint

-- ── P2: usage billing='dify' của Hub — EXECUTE hub_rw; KHÔNG GRANT INSERT usage_logs (test khoá H1 A51) ──────────────
CREATE OR REPLACE FUNCTION hub.log_dify_usage(
  p_tenant_id uuid, p_run_id uuid, p_step_id uuid, p_user_id uuid, p_feature_id uuid, p_agent_id uuid,
  p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric, p_latency_ms integer)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  INSERT INTO hub.usage_logs (tenant_id, run_id, step_id, user_id, feature_id, agent_id, provider_key, model,
    billing, input_tokens, output_tokens, cost_usd, billable_usd, overage, latency_ms)
  VALUES (p_tenant_id, p_run_id, p_step_id, p_user_id, p_feature_id, p_agent_id, 'dify', NULL,
    'dify', greatest(p_input_tokens, 0), greatest(p_output_tokens, 0), greatest(p_cost_usd, 0), NULL, false,
    p_latency_ms)
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.log_dify_usage(uuid, uuid, uuid, uuid, uuid, uuid, integer, integer, numeric, integer)
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.log_dify_usage(uuid, uuid, uuid, uuid, uuid, uuid, integer, integer, numeric, integer)
  TO hub_rw;
