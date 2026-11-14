-- CR-146b · ngưỡng «Quan trọng»/«Rất quan trọng» (triệu đồng) + người phụ trách HĐ nhận nằm ở `trigger.params` của quy trình «Nhận HĐ từ
-- đối tác» (`contract.received`). Gói Hợp đồng (role contracts_rw) không đọc `hub.*` ⇒ hàm DEFINER trả MỘT jsonb `params` của quy trình
-- đang bật ĐẦU TIÊN (cùng luật `eventFlowOf`: position, id; def công ty hoặc Thư viện đã xuất bản). Chỉ đọc tenant đang đặt (`app.tenant_id`).
CREATE OR REPLACE FUNCTION hub.contract_received_params(p_tid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tid IS NOT NULL AND v_tid IS DISTINCT FROM p_tid THEN RETURN NULL; END IF;
  RETURN (SELECT COALESCE(d.trigger -> 'params', '{}'::jsonb)
    FROM hub.company_flows cf
    JOIN hub.process_defs d ON d.id = cf.flow_id AND d.deleted_at IS NULL AND (d.tenant_id = cf.tenant_id OR d.tenant_id IS NULL)
    WHERE cf.tenant_id = p_tid AND cf.enabled AND d.trigger_event = 'contract.received'
      AND (d.tenant_id IS NOT NULL OR d.published_version IS NOT NULL)
    ORDER BY cf.position, cf.id LIMIT 1);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.contract_received_params(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT EXECUTE ON FUNCTION hub.contract_received_params(uuid) TO contracts_rw;
  END IF;
  GRANT EXECUTE ON FUNCTION hub.contract_received_params(uuid) TO hub_rw;
END $$;
