-- M3-decouple · AI client chung (lib/ai-client): mọi lời gọi model trực tiếp của Hub ghi MỘT dòng `hub.usage_logs` billing `api`
-- (tenant, người, tính năng, model, token, chi phí). Thêm cột `feature` (khoá tính năng dạng `goi.viec`, vd `contracts.extract`);
-- cột chỉ thêm, nullable — dòng cũ (runtime/dify) giữ NULL. Ghi qua hàm SECURITY DEFINER như `hub.log_dify_usage` (0003):
-- `hub_api` không INSERT `usage_logs` (khoá H1 A51). Trần theo tenant đọc tổng token trong ngày qua `hub.ai_tokens_since`.
ALTER TABLE hub.usage_logs
  ADD COLUMN IF NOT EXISTS feature text
    CONSTRAINT usage_logs_feature_check CHECK (feature ~ '^[a-z][a-z0-9_.-]{1,63}$');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS usage_logs_tenant_feature_key_at_idx ON hub.usage_logs (tenant_id, at)
  WHERE feature IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.log_ai_usage(
  p_tenant_id uuid, p_user_id uuid, p_feature text, p_provider_key text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_cache_read_tokens integer, p_cache_write_tokens integer,
  p_cost_usd numeric, p_latency_ms integer)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  INSERT INTO hub.usage_logs (tenant_id, user_id, feature, provider_key, model, billing, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, cost_usd, billable_usd, overage, latency_ms)
  VALUES (p_tenant_id, p_user_id, p_feature, p_provider_key, p_model, 'api', greatest(p_input_tokens, 0),
    greatest(p_output_tokens, 0), greatest(p_cache_read_tokens, 0), greatest(p_cache_write_tokens, 0),
    CASE WHEN p_cost_usd IS NULL THEN NULL ELSE greatest(p_cost_usd, 0) END, NULL, false, greatest(p_latency_ms, 0))
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.log_ai_usage(uuid, uuid, text, text, text, integer, integer, integer, integer, numeric,
  integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.log_ai_usage(uuid, uuid, text, text, text, integer, integer, integer, integer, numeric,
  integer) TO hub_rw;
--> statement-breakpoint
-- Chat (M2): runtime agent đã ghi usage của mỗi job trong CÙNG tx kết thúc job (`finish_sql.py`, billing api/subscription/dify)
-- ⇒ một nguồn duy nhất: Hub chỉ GẮN `feature='chat'` cho các dòng của run (không chèn dòng thứ hai). Trả số dòng của run đã gắn.
CREATE OR REPLACE FUNCTION hub.tag_chat_usage(p_tenant_id uuid, p_run_id uuid)
  RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  WITH u AS (UPDATE hub.usage_logs SET feature = 'chat'
    WHERE tenant_id = p_tenant_id AND run_id = p_run_id AND feature IS NULL RETURNING 1)
  SELECT (SELECT count(*) FROM u)::integer + (SELECT count(*) FROM hub.usage_logs
    WHERE tenant_id = p_tenant_id AND run_id = p_run_id AND feature = 'chat')::integer
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.tag_chat_usage(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.tag_chat_usage(uuid, uuid) TO hub_rw;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.ai_tokens_since(p_tenant_id uuid, p_since timestamptz)
  RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  SELECT coalesce(sum(input_tokens::bigint + output_tokens::bigint), 0)::bigint FROM hub.usage_logs
  WHERE tenant_id = p_tenant_id AND at >= p_since AND feature IS NOT NULL
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.ai_tokens_since(uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.ai_tokens_since(uuid, timestamptz) TO hub_rw;
