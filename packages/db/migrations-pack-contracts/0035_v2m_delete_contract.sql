-- V2-M · BA v2 HD-07 · 5.5e · 6a · intake C7 (CR-096b): xoá HĐ hẳn, MỘT tx, chỉ qua `contracts.delete_contract(id, tenant)`.
-- Chỉ cộng thêm / nới có kiểm soát; chạy lại vô hại. RLS vẫn FORCE: `contracts_rw` lấy lại DELETE trên các bảng liên quan nhưng
-- MỌI DELETE bị chặn bởi policy RESTRICTIVE chỉ mở khi tx đã đặt cờ `contracts.v2m_del = <id HĐ>` (hàm đặt cờ, cuối hàm xoá cờ).
-- Quyền "chỉ contracts-owner" kiểm ở route (`admin`). Sổ chỉ thêm giữ nguyên: kho = ghi dòng `reversal` (TS, trước khi gọi hàm);
-- sổ đối tác = thêm `partner_event_voids`; `score_locks` không đụng. Một dòng audit giữ lại ở `contract_delete_log`.
CREATE OR REPLACE FUNCTION contracts.v2m_deleting(p_contract uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_contract IS NOT NULL AND p_contract::text = ANY (string_to_array(current_setting('contracts.v2m_del', true), ','))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.v2m_deleting(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.v2m_deleting(uuid) TO contracts_rw;
--> statement-breakpoint
-- Nhật ký xoá (chỉ thêm): id, tên, số, người, lúc + tác động.
CREATE TABLE IF NOT EXISTS contracts.contract_delete_log (
  id bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  number text,
  title text NOT NULL,
  deleted_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  impact jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT contract_delete_log_pkey PRIMARY KEY (id),
  CONSTRAINT contract_delete_log_impact_ck CHECK (jsonb_typeof(impact) = 'object' AND octet_length(impact::text) <= 8192)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contract_delete_log_tenant_idx ON contracts.contract_delete_log (tenant_id, id DESC);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'contract_delete_log');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON contracts.contract_delete_log FROM contracts_rw;
--> statement-breakpoint
-- Lấy lại DELETE (có cờ) trên các bảng của HĐ. Dòng kho đã giao (`milestone_items.delivered`) chỉ xoá được khi có cờ.
GRANT DELETE ON contracts.contracts, contracts.obligations, contracts.approvals, contracts.followups,
  contracts.service_customers, contracts.products TO contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS contracts_v2m_del ON contracts.contracts;
--> statement-breakpoint
CREATE POLICY contracts_v2m_del ON contracts.contracts AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (contracts.v2m_deleting(id));
--> statement-breakpoint
DROP POLICY IF EXISTS obligations_v2m_del ON contracts.obligations;
--> statement-breakpoint
CREATE POLICY obligations_v2m_del ON contracts.obligations AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (contracts.v2m_deleting(contract_id));
--> statement-breakpoint
DROP POLICY IF EXISTS approvals_v2m_del ON contracts.approvals;
--> statement-breakpoint
CREATE POLICY approvals_v2m_del ON contracts.approvals AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (contracts.v2m_deleting(contract_id));
--> statement-breakpoint
DROP POLICY IF EXISTS followups_v2m_del ON contracts.followups;
--> statement-breakpoint
CREATE POLICY followups_v2m_del ON contracts.followups AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (contracts.v2m_deleting(contract_id));
--> statement-breakpoint
DROP POLICY IF EXISTS service_customers_v2m_del ON contracts.service_customers;
--> statement-breakpoint
CREATE POLICY service_customers_v2m_del ON contracts.service_customers AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (contracts.v2m_deleting(contract_id));
--> statement-breakpoint
DROP POLICY IF EXISTS products_v2m_del ON contracts.products;
--> statement-breakpoint
CREATE POLICY products_v2m_del ON contracts.products AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (contracts.v2m_deleting(created_from_contract_id));
--> statement-breakpoint
DROP POLICY IF EXISTS milestone_items_open_del ON contracts.milestone_items;
--> statement-breakpoint
CREATE POLICY milestone_items_open_del ON contracts.milestone_items AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (delivered IS NULL OR contracts.v2m_deleting(contract_id));
--> statement-breakpoint
-- Việc hẹn của MỌI người gắn HĐ bị xoá cùng HĐ (policy `followups_mine` chỉ cho thấy việc của mình ⇒ mở thêm khi có cờ xoá).
DROP POLICY IF EXISTS followups_mine ON contracts.followups;
--> statement-breakpoint
CREATE POLICY followups_mine ON contracts.followups AS RESTRICTIVE FOR ALL TO contracts_rw
  USING (contracts.v2m_deleting(contract_id)
    OR ((NULLIF(current_setting('app.user_id', true), '') IS NULL
      OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    AND (contract_id IS NULL OR EXISTS (SELECT 1 FROM contracts.contracts c
      WHERE c.id = followups.contract_id AND c.tenant_id = followups.tenant_id))));
--> statement-breakpoint
-- Liên kết CKS: gỡ (đặt null) thay vì chặn; lô CKS chỉ thêm ⇒ chỉ cột liên kết được sửa, chỉ khi có cờ xoá HĐ đó.
ALTER TABLE contracts.cks_lots ALTER COLUMN purchase_contract_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE contracts.cks_renewals ALTER COLUMN sale_contract_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE contracts.cks_renewals ALTER COLUMN new_contract_id DROP NOT NULL;
--> statement-breakpoint
GRANT UPDATE (purchase_contract_id) ON contracts.cks_lots TO contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS cks_lots_v2m_unlink ON contracts.cks_lots;
--> statement-breakpoint
CREATE POLICY cks_lots_v2m_unlink ON contracts.cks_lots AS RESTRICTIVE FOR UPDATE TO contracts_rw
  USING (contracts.v2m_deleting(purchase_contract_id)) WITH CHECK (purchase_contract_id IS NULL);
--> statement-breakpoint-- Hàm xoá (SECURITY INVOKER: RLS tenant + M1 áp nguyên). Xoá HĐ + phụ lục (cascade) cùng lúc. Kho PHẢI đã được đảo (TS ghi dòng
-- `reversal`) — kiểm lại ở đây (P0001). Trả JSON tác động; HĐ không thấy ⇒ null.
CREATE OR REPLACE FUNCTION contracts.delete_contract(p_contract uuid, p_tenant uuid) RETURNS jsonb
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  c record;
  ids uuid[];
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
  PERFORM set_config('contracts.v2m_del', array_to_string(ids, ','), true);
  -- Sổ đối tác: huỷ (thêm hàng) mọi sự kiện của HĐ chưa huỷ; điểm hiện tại tự đổi, điểm kỳ đã chốt giữ.
  INSERT INTO contracts.partner_event_voids (event_id, tenant_id, by_user)
    SELECT e.id, e.tenant_id, NULLIF(current_setting('app.user_id', true), '')::uuid
    FROM contracts.partner_events e
    WHERE e.tenant_id = p_tenant
      AND (e.contract_id = ANY (ids)
           OR e.obligation_id IN (SELECT o.id FROM contracts.obligations o WHERE o.tenant_id = p_tenant AND o.contract_id = ANY (ids)))
      AND NOT EXISTS (SELECT 1 FROM contracts.partner_event_voids v WHERE v.event_id = e.id AND v.tenant_id = e.tenant_id);
  GET DIAGNOSTICS n_pe = ROW_COUNT;
  -- Khách đang dùng sinh từ HĐ: gỡ; HĐ trước trong chuỗi gia hạn (còn tồn tại) đồng bộ lại.
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
  -- CKS: gỡ liên kết (lô/chứng thư/gia hạn CKS giữ nguyên, chỉ không còn trỏ HĐ).
  UPDATE contracts.cks_lots SET purchase_contract_id = NULL WHERE tenant_id = p_tenant AND purchase_contract_id = ANY (ids);
  UPDATE contracts.cks_certificates SET sale_contract_id = NULL WHERE tenant_id = p_tenant AND sale_contract_id = ANY (ids);
  UPDATE contracts.cks_renewals SET sale_contract_id = NULL WHERE tenant_id = p_tenant AND sale_contract_id = ANY (ids);
  UPDATE contracts.cks_renewals SET new_contract_id = NULL WHERE tenant_id = p_tenant AND new_contract_id = ANY (ids);
  -- Phụ lục (con trước, FK RESTRICT) rồi HĐ; dòng HĐ, nhắc hạn, nhật ký HĐ đi theo (FK CASCADE); lịch nhắc dọn bằng trigger.
  FOR x IN WITH RECURSIVE t AS (SELECT k.id, 0 AS depth FROM contracts.contracts k WHERE k.tenant_id = p_tenant AND k.id = p_contract
      UNION SELECT a.id, t.depth + 1 FROM contracts.contracts a JOIN t ON a.parent_id = t.id WHERE a.tenant_id = p_tenant)
    SELECT t.id FROM t ORDER BY t.depth DESC LOOP
    DELETE FROM contracts.contracts WHERE tenant_id = p_tenant AND id = x;
  END LOOP;
  -- 5.5e: SP sinh từ HĐ mà không còn dòng HĐ / dòng sổ nào khác ⇒ xoá theo (thành phần, lô, sổ đi theo FK CASCADE).
  WITH d AS (DELETE FROM contracts.products p
    WHERE p.tenant_id = p_tenant AND p.created_from_contract_id = ANY (ids)
      AND NOT EXISTS (SELECT 1 FROM contracts.contract_items i WHERE i.tenant_id = p_tenant AND i.product_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM contracts.stock_moves m JOIN contracts.product_components pc
        ON pc.id = m.component_id AND pc.tenant_id = m.tenant_id
        WHERE pc.tenant_id = p_tenant AND pc.product_id = p.id AND m.contract_id IS NOT NULL AND NOT m.contract_id = ANY (ids))
    RETURNING 1)
  SELECT count(*) INTO n_pr FROM d;
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
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.delete_contract(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.delete_contract(uuid, uuid) TO contracts_rw;
--> statement-breakpoint
-- Dòng sổ kho `reversal` trỏ dòng bị đảo (cột `reverses` có từ 0023); tìm nhanh "đã đảo chưa".
CREATE INDEX IF NOT EXISTS stock_moves_reverses_idx ON contracts.stock_moves (tenant_id, reverses) WHERE reverses IS NOT NULL;
