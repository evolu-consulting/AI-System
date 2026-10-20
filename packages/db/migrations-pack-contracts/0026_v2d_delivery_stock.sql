-- V2-D · BA v2 §5.7a (mốc giao mang SL từng dòng: Trên HĐ · Đã giao · Giao lần này) · §5.8a/b (khách đang dùng + gia hạn) · HD-05.
-- Chỉ cộng thêm; chạy lại vô hại. 0024 = V2-C, 0025 dành cho V2-E. Ghi kho khi xác nhận đi qua `applyDelivery` (V2-B, 0023).
--
-- 1) `milestone_items`: SL từng dòng HĐ của MỘT mốc giao. `qty` = "Giao lần này" người dùng nhập (null = giao hết phần còn lại);
--    `delivered` = SL thực giao, ghi CÙNG câu xác nhận mốc (null = chưa xác nhận). "Đã giao" của dòng = Σ delivered. Mốc không có hàng
--    nào ⇒ giao hết phần còn lại của mọi dòng (BA: "mốc không ghi số lượng thì giao hết phần còn lại"). Không FK tới obligations/
--    contracts (bộ test cũ TRUNCATE sổ không CASCADE, như `cks_lots`/`stock_moves` — D7 của V2-B); HĐ phải thấy được khi ghi.
CREATE TABLE IF NOT EXISTS contracts.milestone_items (
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  milestone_id uuid NOT NULL,
  contract_item_id uuid NOT NULL,
  qty numeric(18, 4),
  delivered numeric(18, 4),
  created_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT milestone_items_pkey PRIMARY KEY (tenant_id, milestone_id, contract_item_id),
  CONSTRAINT milestone_items_qty_ck CHECK (qty BETWEEN 0 AND 99999999999999 AND delivered BETWEEN 0 AND 99999999999999)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS milestone_items_contract_idx ON contracts.milestone_items (tenant_id, contract_id);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'milestone_items');
--> statement-breakpoint
DROP POLICY IF EXISTS milestone_items_visible ON contracts.milestone_items;
--> statement-breakpoint
-- Thấy như `contract_items` (M1): theo HĐ thấy được.
CREATE POLICY milestone_items_visible ON contracts.milestone_items AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING (EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = milestone_items.contract_id AND c.tenant_id = milestone_items.tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS milestone_items_visible_ins ON contracts.milestone_items;
--> statement-breakpoint
CREATE POLICY milestone_items_visible_ins ON contracts.milestone_items AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK (EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = milestone_items.contract_id AND c.tenant_id = milestone_items.tenant_id));
--> statement-breakpoint
-- Dòng đã giao (đã ghi kho) giữ nguyên: chỉ sửa/xoá dòng kế hoạch chưa xác nhận. Đảo khi xoá HĐ ⇒ V2-M.
DROP POLICY IF EXISTS milestone_items_open_upd ON contracts.milestone_items;
--> statement-breakpoint
CREATE POLICY milestone_items_open_upd ON contracts.milestone_items AS RESTRICTIVE FOR UPDATE TO contracts_rw
  USING (delivered IS NULL) WITH CHECK (true);
--> statement-breakpoint
DROP POLICY IF EXISTS milestone_items_open_del ON contracts.milestone_items;
--> statement-breakpoint
CREATE POLICY milestone_items_open_del ON contracts.milestone_items AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (delivered IS NULL);
--> statement-breakpoint
-- 1b) Luật 4c (đo V2-D: guard theo HÀNG của 0023 tốn ~0,7 ms/thành phần — mỗi lần một câu dưới RLS `stock_moves` ⇒ 20 dòng ≈ 14 ms):
--    đối chiếu tồn/BQ với dòng sổ vừa ghi chuyển sang MỘT câu mỗi lệnh UPDATE (trigger mức câu lệnh, bảng chuyển tiếp) và bỏ trigger
--    theo hàng (`updated_at` do câu ghi của `applyDelivery` đặt). Luật giữ nguyên: tồn/giá trị/BQ/`last_move_id` chỉ đổi khi
--    `last_move_id` trỏ dòng sổ MỚI (cùng tx, `created_at = now()`) của đúng thành phần có số "sau" khớp; sai ⇒ 23514, cả lệnh huỷ.
DROP TRIGGER IF EXISTS product_components_guard ON contracts.product_components;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.product_components_guard_stmt() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM nw JOIN od ON od.id = nw.id
      WHERE (nw.on_hand, nw.stock_value, nw.avg_cost, nw.last_move_id)
              IS DISTINCT FROM (od.on_hand, od.stock_value, od.avg_cost, od.last_move_id)
        AND (nw.last_move_id IS NULL OR NOT EXISTS (SELECT 1 FROM contracts.stock_moves m
          WHERE m.id = nw.last_move_id AND m.tenant_id = nw.tenant_id AND m.component_id = nw.id
            AND m.created_at = now() AND m.on_hand_after = nw.on_hand AND m.value_after = nw.stock_value
            AND m.avg_after = nw.avg_cost))) THEN
    RAISE EXCEPTION 'stock: tồn/giá vốn chỉ đổi kèm dòng sổ khớp' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.product_components_guard_stmt() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.product_components_guard_stmt() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS product_components_guard_stmt ON contracts.product_components;
--> statement-breakpoint
CREATE TRIGGER product_components_guard_stmt AFTER UPDATE ON contracts.product_components
  REFERENCING OLD TABLE AS od NEW TABLE AS nw FOR EACH STATEMENT
  EXECUTE FUNCTION contracts.product_components_guard_stmt();
--> statement-breakpoint
-- 2) `service_customers` (tối thiểu, V2-H mở rộng): MỘT dòng mỗi (SP dịch vụ có hạn, khách). Sinh khi HĐ Bán được LƯU (trạng thái
--    đã xác nhận) có dòng gắn SP nhóm `service`; hạn = ngày kết thúc HĐ. HĐ bán mới cùng khách + SP = gia hạn: thay HĐ/hạn,
--    `renewals` + 1 ("Gia hạn qua mình"), nhớ `prev_contract_id`. HĐ cũ hơn (hạn sớm hơn) không giành lại dòng.
CREATE TABLE IF NOT EXISTS contracts.service_customers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  party_key text NOT NULL,
  customer_name text,
  contract_id uuid NOT NULL,
  started_on date,
  expires_on date,
  renewals int NOT NULL DEFAULT 0,
  prev_contract_id uuid,
  created_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_customers_pkey PRIMARY KEY (id),
  CONSTRAINT service_customers_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT service_customers_key_uq UNIQUE (tenant_id, product_id, party_key),
  CONSTRAINT service_customers_text_ck CHECK (char_length(party_key) BETWEEN 1 AND 300 AND char_length(customer_name) <= 300
    AND renewals >= 0),
  CONSTRAINT service_customers_product_fk FOREIGN KEY (product_id, tenant_id)
    REFERENCES contracts.products (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS service_customers_contract_idx ON contracts.service_customers (tenant_id, contract_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS service_customers_expiry_idx ON contracts.service_customers (tenant_id, expires_on);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'service_customers');
--> statement-breakpoint
-- Thấy cả tenant như danh mục/tồn (V2-B D2; tab Khách của SP). Ghi chỉ cho HĐ mình thấy (HĐ đang lưu luôn thấy) ⇒ gia hạn bởi người
-- khác vẫn cập nhật được dòng cũ (ON CONFLICT DO UPDATE cần thấy dòng cũ — không lọc M1 khi đọc). Không xoá (V2-M gỡ khi xoá HĐ).
DROP POLICY IF EXISTS service_customers_visible_ins ON contracts.service_customers;
--> statement-breakpoint
CREATE POLICY service_customers_visible_ins ON contracts.service_customers AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK (EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = service_customers.contract_id AND c.tenant_id = service_customers.tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS service_customers_visible_upd ON contracts.service_customers;
--> statement-breakpoint
CREATE POLICY service_customers_visible_upd ON contracts.service_customers AS RESTRICTIVE FOR UPDATE TO contracts_rw
  USING (true)
  WITH CHECK (EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = service_customers.contract_id AND c.tenant_id = service_customers.tenant_id));
--> statement-breakpoint
REVOKE DELETE ON contracts.service_customers FROM contracts_rw;
--> statement-breakpoint
-- Đồng bộ khách đang dùng của MỘT HĐ (idempotent; một lần mỗi HĐ mỗi tx qua cờ `contracts.v2d_sc`). INVOKER: RLS tenant + ghi.
CREATE OR REPLACE FUNCTION contracts.v2d_sync_service_customers(p_contract uuid, p_tenant uuid) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  done text := coalesce(current_setting('contracts.v2d_sc', true), '');
BEGIN
  IF strpos(done, p_contract::text) > 0 THEN
    RETURN;
  END IF;
  PERFORM set_config('contracts.v2d_sc', done || p_contract::text || ',', true);
  INSERT INTO contracts.service_customers AS s (tenant_id, product_id, party_key, customer_name, contract_id, started_on,
    expires_on)
  SELECT DISTINCT ON (i.product_id) c.tenant_id, i.product_id, k.key, left(c.buyer, 300), c.id, c.start_date, c.end_date
  FROM contracts.contracts c
  CROSS JOIN LATERAL (SELECT contracts.party_key(c.fields -> 'buyer_name' ->> 'value',
    c.fields -> 'buyer_tax_id' ->> 'value') AS key) k
  JOIN contracts.contract_items i ON i.tenant_id = c.tenant_id AND i.contract_id = c.id AND i.product_id IS NOT NULL
  JOIN contracts.products p ON p.tenant_id = c.tenant_id AND p.id = i.product_id AND p.grp = 'service'
  WHERE c.tenant_id = p_tenant AND c.id = p_contract AND c.kind = 'contract' AND c.deal = 'sell'
    AND c.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated') AND k.key IS NOT NULL
    AND char_length(k.key) <= 300
  ORDER BY i.product_id
  ON CONFLICT (tenant_id, product_id, party_key) DO UPDATE SET
    renewals = s.renewals + CASE WHEN s.contract_id <> EXCLUDED.contract_id THEN 1 ELSE 0 END,
    prev_contract_id = CASE WHEN s.contract_id <> EXCLUDED.contract_id THEN s.contract_id ELSE s.prev_contract_id END,
    contract_id = EXCLUDED.contract_id, customer_name = EXCLUDED.customer_name, started_on = EXCLUDED.started_on,
    expires_on = EXCLUDED.expires_on, updated_at = now()
  WHERE s.contract_id = EXCLUDED.contract_id OR s.expires_on IS NULL
    OR coalesce(EXCLUDED.expires_on, 'infinity'::date) >= s.expires_on;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.v2d_sc_contract() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM contracts.v2d_sync_service_customers(NEW.id, NEW.tenant_id);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.v2d_sc_item() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM contracts.v2d_sync_service_customers(NEW.contract_id, NEW.tenant_id);
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.v2d_sync_service_customers(uuid, uuid), contracts.v2d_sc_contract(), contracts.v2d_sc_item()
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.v2d_sync_service_customers(uuid, uuid), contracts.v2d_sc_contract(), contracts.v2d_sc_item()
  TO contracts_rw;
--> statement-breakpoint
-- Trì hoãn tới cuối tx: HĐ + dòng thường ghi trong cùng tx (HĐ trước, dòng sau) ⇒ đồng bộ một lần trên trạng thái cuối.
DROP TRIGGER IF EXISTS contracts_v2d_sc_ins ON contracts.contracts;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER contracts_v2d_sc_ins AFTER INSERT ON contracts.contracts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.deal = 'sell' AND NEW.kind = 'contract'
    AND NEW.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated'))
  EXECUTE FUNCTION contracts.v2d_sc_contract();
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_v2d_sc_upd ON contracts.contracts;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER contracts_v2d_sc_upd AFTER UPDATE ON contracts.contracts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.deal = 'sell' AND NEW.kind = 'contract'
    AND NEW.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated')
    AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.deal IS DISTINCT FROM NEW.deal
      OR OLD.end_date IS DISTINCT FROM NEW.end_date OR OLD.start_date IS DISTINCT FROM NEW.start_date
      OR OLD.buyer IS DISTINCT FROM NEW.buyer
      OR (OLD.fields -> 'buyer_tax_id') IS DISTINCT FROM (NEW.fields -> 'buyer_tax_id')))
  EXECUTE FUNCTION contracts.v2d_sc_contract();
--> statement-breakpoint
DROP TRIGGER IF EXISTS contract_items_v2d_sc ON contracts.contract_items;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER contract_items_v2d_sc AFTER INSERT OR UPDATE OF product_id ON contracts.contract_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.product_id IS NOT NULL)
  EXECUTE FUNCTION contracts.v2d_sc_item();
