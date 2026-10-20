-- ai-sub · AI client chung chạy được trên GÓI Claude (Claude Code CLI đăng nhập gói) ngoài khoá API: dòng usage mang đúng
-- `billing` (`api` | `subscription`). Hàm mới `hub.log_ai_usage_billed` = `hub.log_ai_usage` (0042) + `p_billing`; giữ hàm cũ
-- (gọi cũ vẫn ghi `api`). Không thêm overload cùng tên (tránh mơ hồ chữ ký). `dify` không đi qua AI client ⇒ không nhận ở đây.
-- Trần token (`hub.ai_tokens_since`, `hub.ai_reserve_tokens`) đã cộng mọi billing có `feature` ⇒ dòng gói tính vào trần.
CREATE OR REPLACE FUNCTION hub.log_ai_usage_billed(
  p_tenant_id uuid, p_user_id uuid, p_feature text, p_provider_key text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_cache_read_tokens integer, p_cache_write_tokens integer,
  p_cost_usd numeric, p_latency_ms integer, p_billing text)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_billing IS NULL OR p_billing NOT IN ('api', 'subscription') THEN
    RAISE EXCEPTION 'invalid billing' USING ERRCODE = '22023';
  END IF;
  INSERT INTO hub.usage_logs (tenant_id, user_id, feature, provider_key, model, billing, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, cost_usd, billable_usd, overage, latency_ms)
  VALUES (p_tenant_id, p_user_id, p_feature, p_provider_key, p_model, p_billing, greatest(p_input_tokens, 0),
    greatest(p_output_tokens, 0), greatest(p_cache_read_tokens, 0), greatest(p_cache_write_tokens, 0),
    CASE WHEN p_cost_usd IS NULL THEN NULL ELSE greatest(p_cost_usd, 0) END, NULL, false, greatest(p_latency_ms, 0));
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.log_ai_usage_billed(uuid, uuid, text, text, text, integer, integer, integer, integer,
  numeric, integer, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.log_ai_usage_billed(uuid, uuid, text, text, text, integer, integer, integer, integer,
  numeric, integer, text) TO hub_rw;
