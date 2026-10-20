-- V2-H · BA v2 §3.3 SP-03 (tab Khách đang dùng) · §5.8 (một nguồn nhắc: "Nhắc trước khi hết hạn", mặc định 60 ngày từ Cài đặt) ·
-- §5.9 (Liên hệ mời gia hạn ⇒ Cần xử lý) · intake C6/Q4. Chỉ cộng thêm / siết quyền; chạy lại vô hại. 0028 = V2-E.
--
-- 1) Cài đặt kinh doanh MỘT hàng mỗi tenant (intake C5 đặt tên; V2-J1/V2-L thêm cột điểm KD, mục tiêu bán). Vắng hàng = mặc định.
CREATE TABLE IF NOT EXISTS contracts.business_settings (
  tenant_id uuid NOT NULL,
  renewal_notice_days smallint NOT NULL DEFAULT 60,
  -- Q4 (CKS ⇒ khách đang dùng chung): null = mặc định theo tenant (`cks_writable()`); V2-O gỡ hẳn route ghi CKS.
  cks_writable boolean,
  updated_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_settings_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT business_settings_notice_ck CHECK (renewal_notice_days BETWEEN 0 AND 3650)
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'business_settings');
--> statement-breakpoint
REVOKE DELETE ON contracts.business_settings FROM contracts_rw;
--> statement-breakpoint
-- Ghi CKS (HD9) còn mở? Mặc định: chỉ tenant cũ (≠ nitigroup/demo — cùng tập với `approval_default()` của V2-A) còn ghi; tenant v2
-- chỉ đọc. Dữ liệu CKS có sẵn giữ nguyên.
CREATE OR REPLACE FUNCTION contracts.cks_writable() RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT b.cks_writable FROM contracts.business_settings b
                   WHERE b.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid),
                  contracts.approval_default())
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.cks_writable() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.cks_writable() TO contracts_rw;
--> statement-breakpoint
-- 2) Xem lại V2-D D11: `service_customers` (tên khách + hạn + HĐ) là dữ liệu SINH TỪ HĐ ⇒ ĐỌC theo luật thấy M1 (dòng thấy khi thấy HĐ
--    hiện tại của dòng), như `contract_items`/`milestone_items`. Ghi chỉ qua trigger lưu HĐ: hàm đồng bộ chạy SECURITY DEFINER dưới
--    role riêng `contracts_sc` (NOLOGIN, NOINHERIT, NOBYPASSRLS; không ai SET ROLE được) để gia hạn bởi người KHÔNG thấy HĐ cũ vẫn cập
--    nhật dòng cũ (ON CONFLICT DO UPDATE cần thấy dòng cũ — lọc M1 khi đọc làm lỗi 42501). Cách ly tenant trong hàm: tenant = tham số
--    và PHẢI trùng `app.tenant_id` của tx (vắng ⇒ chỉ phiên superuser/BYPASSRLS: migration, seed, test); mọi câu lọc `tenant_id`;
--    dữ liệu ghi tính lại từ HĐ thật (gọi thẳng hàm cũng chỉ đồng bộ đúng sự thật, không ghi được giá trị tuỳ ý). `contracts_rw`
--    mất INSERT/UPDATE trực tiếp (DELETE đã thu ở 0026).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_sc') THEN
    CREATE ROLE contracts_sc NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER ROLE contracts_sc NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
--> statement-breakpoint
GRANT USAGE ON SCHEMA contracts TO contracts_sc;
--> statement-breakpoint
GRANT SELECT ON contracts.contracts, contracts.contract_items, contracts.products TO contracts_sc;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON contracts.service_customers TO contracts_sc;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.party_key(text, text), contracts.fold(text) TO contracts_sc;
--> statement-breakpoint
DROP POLICY IF EXISTS contracts_sc_read ON contracts.contracts;
--> statement-breakpoint
CREATE POLICY contracts_sc_read ON contracts.contracts FOR SELECT TO contracts_sc USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS contract_items_sc_read ON contracts.contract_items;
--> statement-breakpoint
CREATE POLICY contract_items_sc_read ON contracts.contract_items FOR SELECT TO contracts_sc USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS products_sc_read ON contracts.products;
--> statement-breakpoint
CREATE POLICY products_sc_read ON contracts.products FOR SELECT TO contracts_sc USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS service_customers_sc ON contracts.service_customers;
--> statement-breakpoint
CREATE POLICY service_customers_sc ON contracts.service_customers FOR ALL TO contracts_sc USING (true) WITH CHECK (true);
--> statement-breakpoint
DROP POLICY IF EXISTS service_customers_visible_ins ON contracts.service_customers;
--> statement-breakpoint
DROP POLICY IF EXISTS service_customers_visible_upd ON contracts.service_customers;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON contracts.service_customers FROM contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS service_customers_visible ON contracts.service_customers;
--> statement-breakpoint
CREATE POLICY service_customers_visible ON contracts.service_customers AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all()) OR EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = service_customers.contract_id AND c.tenant_id = service_customers.tenant_id));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS service_customers_product_idx ON contracts.service_customers (tenant_id, product_id, expires_on);
--> statement-breakpoint
-- Cùng luật đồng bộ như 0026 (một dòng mỗi SP × khách; HĐ mới hạn ≥ ⇒ gia hạn), chạy dưới `contracts_sc`.
CREATE OR REPLACE FUNCTION contracts.v2d_sync_service_customers(p_contract uuid, p_tenant uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  scope text := NULLIF(current_setting('app.tenant_id', true), '');
  done text := coalesce(current_setting('contracts.v2d_sc', true), '');
BEGIN
  IF p_tenant IS NULL OR p_contract IS NULL THEN
    RETURN;
  END IF;
  IF scope IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = session_user AND (r.rolsuper OR r.rolbypassrls)) THEN
      RAISE EXCEPTION 'v2d_sync_service_customers: tx chưa đặt app.tenant_id' USING ERRCODE = '42501';
    END IF;
  ELSIF scope <> p_tenant::text THEN
    RAISE EXCEPTION 'v2d_sync_service_customers: tenant khác phạm vi tx' USING ERRCODE = '42501';
  END IF;
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
REVOKE ALL ON FUNCTION contracts.v2d_sync_service_customers(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.v2d_sync_service_customers(uuid, uuid) TO contracts_rw;
--> statement-breakpoint
ALTER FUNCTION contracts.v2d_sync_service_customers(uuid, uuid) OWNER TO contracts_sc;
