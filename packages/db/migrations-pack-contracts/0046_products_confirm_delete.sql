-- products-confirm (khách 2026-10-22): xoá HĐ KHÔNG tự xoá SP nữa. Người xoá thấy danh sách SP gắn HĐ (dòng HĐ hoặc sinh từ HĐ)
-- mà không còn HĐ nào khác dùng, tick SP muốn xoá; hàm 3 tham số chỉ xoá SP được tick VÀ vẫn mồ côi (kiểm lại TRƯỚC khi xoá HĐ).
-- SP còn HĐ khác dùng (dòng HĐ / dòng kho của HĐ khác) không bao giờ bị xoá. Chỉ thay hàm + policy xoá SP; chạy lại vô hại.
-- Policy xoá SP: thay "SP sinh từ HĐ đang xoá" bằng "SP nằm trong danh sách đã chọn" (cờ `contracts.v2m_del_products`, hàm đặt rồi
-- xoá cờ trong cùng tx — như cờ `contracts.v2m_del` của 0035).
CREATE OR REPLACE FUNCTION contracts.v2m_product_picked(p_product uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_product IS NOT NULL
    AND p_product::text = ANY (string_to_array(current_setting('contracts.v2m_del_products', true), ','))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.v2m_product_picked(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.v2m_product_picked(uuid) TO contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS products_v2m_del ON contracts.products;
--> statement-breakpoint
CREATE POLICY products_v2m_del ON contracts.products AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (contracts.v2m_product_picked(id));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.delete_contract(p_contract uuid, p_tenant uuid, p_products uuid[]) RETURNS jsonb
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c record;
  ids uuid[];
  picks uuid[];
  n_ms int; n_sc int; n_pe int; n_pr int; n_rev int; n_app int;
  prevs uuid[];
  log_id bigint;
  x uuid;
BEGIN
  IF p_tenant IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'delete_contract: tenant khác phạm vi tx' USING ERRCODE = '42501';
  END IF;
  SELECT k.id, k.number, k.title INTO c FROM contracts.contracts k
    WHERE k.tenant_id = p_tenant AND k.id = p_contract FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  WITH RECURSIVE t AS (
    SELECT k.id FROM contracts.contracts k WHERE k.tenant_id = p_tenant AND k.id = p_contract
    UNION SELECT a.id FROM contracts.contracts a JOIN t ON a.parent_id = t.id WHERE a.tenant_id = p_tenant)
  SELECT array_agg(t.id) INTO ids FROM t;
  n_app := cardinality(ids) - 1;
  SELECT count(*) INTO n_rev FROM contracts.stock_moves m
    WHERE m.tenant_id = p_tenant AND m.contract_id = ANY (ids) AND m.reason = 'delivery'
      AND NOT EXISTS (SELECT 1 FROM contracts.stock_moves r WHERE r.tenant_id = p_tenant AND r.reverses = m.id);
  IF n_rev > 0 THEN
    RAISE EXCEPTION 'delete_contract: kho chưa đảo (% dòng)', n_rev USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO n_rev FROM contracts.stock_moves m
    WHERE m.tenant_id = p_tenant AND m.contract_id = ANY (ids) AND m.reason = 'reversal';
  -- SP được chọn mà vẫn mồ côi: gắn HĐ này (dòng HĐ / sinh từ HĐ), không dòng HĐ khác, không dòng kho của HĐ khác.
  SELECT coalesce(array_agg(p.id), '{}'::uuid[]) INTO picks FROM contracts.products p
    WHERE p.tenant_id = p_tenant AND p.id = ANY (coalesce(p_products, '{}'::uuid[]))
      AND (p.created_from_contract_id = ANY (ids) OR EXISTS (SELECT 1 FROM contracts.contract_items i
        WHERE i.tenant_id = p_tenant AND i.product_id = p.id AND i.contract_id = ANY (ids)))
      AND NOT EXISTS (SELECT 1 FROM contracts.contract_items i
        WHERE i.tenant_id = p_tenant AND i.product_id = p.id AND NOT i.contract_id = ANY (ids))
      AND NOT EXISTS (SELECT 1 FROM contracts.stock_moves m JOIN contracts.product_components pc
        ON pc.id = m.component_id AND pc.tenant_id = m.tenant_id
        WHERE pc.tenant_id = p_tenant AND pc.product_id = p.id AND m.contract_id IS NOT NULL AND NOT m.contract_id = ANY (ids));
  PERFORM set_config('contracts.v2m_del', array_to_string(ids, ','), true);
  INSERT INTO contracts.partner_event_voids (event_id, tenant_id, by_user)
    SELECT e.id, e.tenant_id, NULLIF(current_setting('app.user_id', true), '')::uuid
    FROM contracts.partner_events e
    WHERE e.tenant_id = p_tenant
      AND (e.contract_id = ANY (ids)
           OR e.obligation_id IN (SELECT o.id FROM contracts.obligations o WHERE o.tenant_id = p_tenant AND o.contract_id = ANY (ids)))
      AND NOT EXISTS (SELECT 1 FROM contracts.partner_event_voids v WHERE v.event_id = e.id AND v.tenant_id = e.tenant_id);
  GET DIAGNOSTICS n_pe = ROW_COUNT;
  WITH d AS (DELETE FROM contracts.service_customers s WHERE s.tenant_id = p_tenant AND s.contract_id = ANY (ids)
    RETURNING s.prev_contract_id)
  SELECT count(*), array_agg(DISTINCT d.prev_contract_id) FILTER (WHERE d.prev_contract_id IS NOT NULL AND NOT d.prev_contract_id = ANY (ids))
    INTO n_sc, prevs FROM d;
  DELETE FROM contracts.milestone_items WHERE tenant_id = p_tenant AND contract_id = ANY (ids);
  WITH d AS (DELETE FROM contracts.obligations WHERE tenant_id = p_tenant AND contract_id = ANY (ids) RETURNING 1)
    SELECT count(*) INTO n_ms FROM d;
  DELETE FROM contracts.approvals WHERE tenant_id = p_tenant AND contract_id = ANY (ids);
  DELETE FROM contracts.followups WHERE tenant_id = p_tenant AND contract_id = ANY (ids);
  DELETE FROM contracts.sourcing_choices
    WHERE tenant_id = p_tenant AND (sale_contract_id = ANY (ids) OR source_contract_id = ANY (ids));
  UPDATE contracts.cks_lots SET purchase_contract_id = NULL WHERE tenant_id = p_tenant AND purchase_contract_id = ANY (ids);
  UPDATE contracts.cks_certificates SET sale_contract_id = NULL WHERE tenant_id = p_tenant AND sale_contract_id = ANY (ids);
  UPDATE contracts.cks_renewals SET sale_contract_id = NULL WHERE tenant_id = p_tenant AND sale_contract_id = ANY (ids);
  UPDATE contracts.cks_renewals SET new_contract_id = NULL WHERE tenant_id = p_tenant AND new_contract_id = ANY (ids);
  FOR x IN WITH RECURSIVE t AS (SELECT k.id, 0 AS depth FROM contracts.contracts k WHERE k.tenant_id = p_tenant AND k.id = p_contract
      UNION SELECT a.id, t.depth + 1 FROM contracts.contracts a JOIN t ON a.parent_id = t.id WHERE a.tenant_id = p_tenant)
    SELECT t.id FROM t ORDER BY t.depth DESC LOOP
    DELETE FROM contracts.contracts WHERE tenant_id = p_tenant AND id = x;
  END LOOP;
  -- Chỉ SP người xoá đã chọn (thành phần, lô, sổ đi theo FK CASCADE).
  PERFORM set_config('contracts.v2m_del_products', array_to_string(picks, ','), true);
  WITH d AS (DELETE FROM contracts.products p WHERE p.tenant_id = p_tenant AND p.id = ANY (picks) RETURNING 1)
  SELECT count(*) INTO n_pr FROM d;
  PERFORM set_config('contracts.v2m_del_products', '', true);
  PERFORM set_config('contracts.v2m_del', '', true);
  IF prevs IS NOT NULL THEN
    PERFORM contracts.v2d_sync_service_customers(y.id, p_tenant)
      FROM contracts.contracts y WHERE y.tenant_id = p_tenant AND y.id = ANY (prevs);
  END IF;
  INSERT INTO contracts.contract_delete_log (tenant_id, contract_id, number, title, impact)
    VALUES (p_tenant, p_contract, c.number, c.title, jsonb_build_object('milestones', n_ms, 'stock_reversed', n_rev,
      'service_customers', n_sc, 'products', n_pr, 'partner_events_voided', n_pe, 'appendices', n_app))
    RETURNING id INTO log_id;
  RETURN jsonb_build_object('audit_id', log_id::text, 'milestones', n_ms, 'stock_reversed', n_rev, 'service_customers', n_sc,
    'products', n_pr, 'partner_events_voided', n_pe, 'appendices', n_app);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.delete_contract(uuid, uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.delete_contract(uuid, uuid, uuid[]) TO contracts_rw;
--> statement-breakpoint
-- Bản 2 tham số (0035) giữ chữ ký cho người gọi cũ nhưng KHÔNG xoá SP nào (không có lựa chọn của người xoá).
CREATE OR REPLACE FUNCTION contracts.delete_contract(p_contract uuid, p_tenant uuid) RETURNS jsonb
  LANGUAGE sql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT contracts.delete_contract(p_contract, p_tenant, '{}'::uuid[])
$$;
