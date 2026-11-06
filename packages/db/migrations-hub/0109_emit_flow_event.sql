-- CR-122 · E1b · ADR-0038 · FLOW2-FR-19 · app (role gói `<k>_rw`, tx `withPackScope`) ghi sự kiện vào `hub.flow_events` CÙNG tx bản
-- ghi mà không có quyền trên bảng: hàm SECURITY DEFINER `hub.emit_flow_event`. Hàm CHỈ ghi cho tenant hiện tại của tx
-- (`app.tenant_id`, do `withPackScope`/`withHubScope` user đặt) — khác/không có ⇒ lỗi 42501; trùng `(tenant_id, event_id)` ⇒ không ghi
-- (idempotent), trả NULL. `search_path` cố định (chống chiếm tên). Quyền gọi: hub_rw + role gói contracts_rw / community_rw (nếu đã có;
-- gói cài sau ⇒ chạy lại khối GRANT ở bước cài gói). Chạy lại vô hại.
CREATE OR REPLACE FUNCTION hub.emit_flow_event(
  p_tenant_id uuid,
  p_event_id text,
  p_event text,
  p_ref text,
  p_facts jsonb,
  p_actor_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_id uuid;
BEGIN
  IF v_tid IS NULL OR p_tenant_id IS DISTINCT FROM v_tid THEN
    RAISE EXCEPTION 'emit_flow_event: tenant % không phải tenant hiện tại', p_tenant_id USING ERRCODE = '42501';
  END IF;
  INSERT INTO hub.flow_events (tenant_id, event_id, event, ref, facts, actor_id)
  VALUES (p_tenant_id, p_event_id, p_event, p_ref, COALESCE(p_facts, '{}'::jsonb), p_actor_id)
  ON CONFLICT (tenant_id, event_id) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.emit_flow_event(uuid, text, text, text, jsonb, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.emit_flow_event(uuid, text, text, text, jsonb, uuid) TO hub_rw;
--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['contracts_rw', 'community_rw'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA hub TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION hub.emit_flow_event(uuid, text, text, text, jsonb, uuid) TO %I', r);
    END IF;
  END LOOP;
END $$;
