-- M3c · review B #13: trần token tenant/ngày của AI client chung là kiểm-rồi-gọi ⇒ N lời gọi đồng thời đều qua cửa và vượt trần.
-- Nay GIỮ CHỖ nguyên tử trước khi gọi: `hub.ai_reserve_tokens` khoá theo tenant (advisory xact lock, một câu), cộng usage trong
-- ngày + chỗ đang giữ, cấp `min(max_output, phần còn lại − input ước tính)` (dưới `p_min_output` ⇒ không cấp) và ghi một hàng
-- giữ chỗ có hạn; xong lời gọi ⇒ ghi usage thật (`hub.log_ai_usage`) rồi `hub.ai_release_tokens` xoá chỗ giữ (quyết toán).
-- Tiến trình chết giữa chừng ⇒ chỗ giữ hết hạn sau `p_ttl_s` (tính dư trong lúc đó — an toàn về chi phí). `hub_api` không đọc/ghi
-- bảng trực tiếp (chỉ qua hàm SECURITY DEFINER, như `usage_logs`).
CREATE TABLE IF NOT EXISTS hub.ai_token_holds (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  tokens bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT ai_token_holds_pkey PRIMARY KEY (id),
  CONSTRAINT ai_token_holds_tokens_ck CHECK (tokens > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ai_token_holds_tenant_idx ON hub.ai_token_holds (tenant_id, expires_at);
--> statement-breakpoint
REVOKE ALL ON hub.ai_token_holds FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.ai_reserve_tokens(
  p_tenant_id uuid, p_since timestamptz, p_cap bigint, p_input integer, p_max_output integer, p_min_output integer,
  p_ttl_s integer)
  RETURNS TABLE (hold_id uuid, max_output integer)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
DECLARE
  v_used bigint;
  v_held bigint;
  v_left bigint;
  v_grant integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('hub.ai_tokens:' || p_tenant_id::text, 0));
  DELETE FROM hub.ai_token_holds WHERE tenant_id = p_tenant_id AND expires_at <= now();
  SELECT coalesce(sum(input_tokens::bigint + output_tokens::bigint), 0) INTO v_used FROM hub.usage_logs
    WHERE tenant_id = p_tenant_id AND at >= p_since AND feature IS NOT NULL;
  SELECT coalesce(sum(tokens), 0) INTO v_held FROM hub.ai_token_holds WHERE tenant_id = p_tenant_id;
  v_left := p_cap - v_used - v_held - greatest(p_input, 0);
  IF v_left < greatest(least(p_min_output, p_max_output), 1) THEN
    RETURN;
  END IF;
  v_grant := least(p_max_output::bigint, v_left)::integer;
  INSERT INTO hub.ai_token_holds (tenant_id, tokens, expires_at)
    VALUES (p_tenant_id, greatest(p_input, 0) + v_grant, now() + make_interval(secs => greatest(p_ttl_s, 1)))
    RETURNING id INTO hold_id;
  max_output := v_grant;
  RETURN NEXT;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.ai_reserve_tokens(uuid, timestamptz, bigint, integer, integer, integer, integer)
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.ai_reserve_tokens(uuid, timestamptz, bigint, integer, integer, integer, integer)
  TO hub_rw;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.ai_release_tokens(p_hold_id uuid)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$
  DELETE FROM hub.ai_token_holds WHERE id = p_hold_id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION hub.ai_release_tokens(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.ai_release_tokens(uuid) TO hub_rw;
