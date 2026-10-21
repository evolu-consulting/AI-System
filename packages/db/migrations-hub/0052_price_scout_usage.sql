-- price-scout · mỗi lời gọi agent qua cổng AI client (`lib/ai-client/agent-call.ts`) ghi đủ chiều để quản lý usage: `agent_id`
-- (agent Hub đã có cột), `app` (0049), `trigger_kind` (manual | schedule) và `subject_id` (bản ghi nghiệp vụ, vd id sản phẩm
-- của gói contracts — chỉ là id, không nội dung). Cột chỉ thêm, nullable (writer cũ không đổi; ALTER không viết lại bảng).
-- `hub.log_ai_usage_v4` = v3 + 4 tham số; giữ v3 (gọi cũ vẫn chạy). Trigger tổng hợp `usage_daily` (0049) đọc cột theo tên nên
-- dòng có `agent_id` vào bảng tổng hợp ⇒ màn Usage analytics lọc được theo agent/feature mà không đổi gì.
ALTER TABLE hub.usage_logs
  ADD COLUMN IF NOT EXISTS trigger_kind text
    CONSTRAINT usage_logs_trigger_kind_check CHECK (trigger_kind IN ('manual', 'schedule')),
  ADD COLUMN IF NOT EXISTS subject_id uuid;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.log_ai_usage_v4(
  p_tenant_id uuid, p_user_id uuid, p_feature text, p_provider_key text, p_model text,
  p_input_tokens integer, p_output_tokens integer, p_cache_read_tokens integer, p_cache_write_tokens integer,
  p_cost_usd numeric, p_latency_ms integer, p_billing text, p_outcome text,
  p_app text, p_agent_id uuid, p_trigger text, p_subject_id uuid)
  RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF p_billing IS NULL OR p_billing NOT IN ('api', 'subscription') THEN
    RAISE EXCEPTION 'invalid billing' USING ERRCODE = '22023';
  END IF;
  INSERT INTO hub.usage_logs (tenant_id, user_id, feature, provider_key, model, billing, input_tokens, output_tokens,
    cache_read_tokens, cache_write_tokens, cost_usd, billable_usd, overage, latency_ms, outcome, app, agent_id,
    trigger_kind, subject_id)
  VALUES (p_tenant_id, p_user_id, p_feature, p_provider_key, p_model, p_billing, greatest(p_input_tokens, 0),
    greatest(p_output_tokens, 0), greatest(p_cache_read_tokens, 0), greatest(p_cache_write_tokens, 0),
    CASE WHEN p_cost_usd IS NULL THEN NULL ELSE greatest(p_cost_usd, 0) END, NULL, false, greatest(p_latency_ms, 0),
    p_outcome, p_app, p_agent_id, p_trigger, p_subject_id);
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.log_ai_usage_v4(uuid, uuid, text, text, text, integer, integer, integer, integer,
  numeric, integer, text, text, text, uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.log_ai_usage_v4(uuid, uuid, text, text, text, integer, integer, integer, integer,
  numeric, integer, text, text, text, uuid, text, uuid) TO hub_rw;
