-- niti-import2 · phần còn lại của tài khoản mgmt-app cũ (CKS chỉ đọc, báo giá, giá thị trường CKS, lịch sử chấm điểm, bản ghi
-- quét giá) nhập theo nhãn lô. Sổ đăng ký `import_rows` ghi CHÍNH XÁC hàng mà lô đã chèn (cùng câu chèn, cùng tx) ⇒ hoàn tác
-- `contracts.import_rollback(tenant, nhãn)` chỉ xoá các hàng đó (hàng có sẵn / app tạo không bao giờ bị đụng). DELETE trên bảng
-- CKS + vùng chờ (vốn bị thu hồi) cấp lại cho `contracts_rw` nhưng policy RESTRICTIVE chỉ mở khi tx đặt cờ `contracts.import_rb` =
-- nhãn VÀ hàng có trong sổ của nhãn đó (cùng cách `contracts.v2m_del`). Chỉ cộng thêm; chạy lại vô hại.
CREATE TABLE IF NOT EXISTS contracts.import_rows (
  tenant_id uuid NOT NULL,
  source text NOT NULL,
  tbl text NOT NULL,
  row_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_rows_pkey PRIMARY KEY (tenant_id, source, tbl, row_key),
  CONSTRAINT import_rows_ck CHECK (source ~ '^[a-z0-9][a-z0-9._-]{0,63}$' AND tbl ~ '^[a-z_]{2,40}$'
    AND char_length(row_key) BETWEEN 1 AND 400)
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'import_rows');
--> statement-breakpoint
REVOKE UPDATE ON contracts.import_rows FROM contracts_rw;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.import_rb_has(p_tbl text, p_key text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(current_setting('contracts.import_rb', true), '') <> '' AND EXISTS (
    SELECT 1 FROM contracts.import_rows r
    WHERE r.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
      AND r.source = current_setting('contracts.import_rb', true) AND r.tbl = p_tbl AND r.row_key = p_key)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.import_rb_has(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.import_rb_has(text, text) TO contracts_rw;
--> statement-breakpoint
GRANT DELETE ON contracts.cks_customers, contracts.cks_certificates, contracts.cks_signed_docs, contracts.cks_market_prices,
  contracts.legacy_records TO contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS cks_customers_import_rb ON contracts.cks_customers;
--> statement-breakpoint
CREATE POLICY cks_customers_import_rb ON contracts.cks_customers AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (contracts.import_rb_has('cks_customers', id::text));
--> statement-breakpoint
DROP POLICY IF EXISTS cks_certificates_import_rb ON contracts.cks_certificates;
--> statement-breakpoint
CREATE POLICY cks_certificates_import_rb ON contracts.cks_certificates AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (contracts.import_rb_has('cks_certificates', id::text));
--> statement-breakpoint
DROP POLICY IF EXISTS cks_signed_docs_import_rb ON contracts.cks_signed_docs;
--> statement-breakpoint
CREATE POLICY cks_signed_docs_import_rb ON contracts.cks_signed_docs AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (contracts.import_rb_has('cks_signed_docs', id::text));
--> statement-breakpoint
DROP POLICY IF EXISTS cks_market_prices_import_rb ON contracts.cks_market_prices;
--> statement-breakpoint
CREATE POLICY cks_market_prices_import_rb ON contracts.cks_market_prices AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (contracts.import_rb_has('cks_market_prices', id::text));
--> statement-breakpoint
DROP POLICY IF EXISTS legacy_records_import_rb ON contracts.legacy_records;
--> statement-breakpoint
CREATE POLICY legacy_records_import_rb ON contracts.legacy_records AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (contracts.import_rb_has('legacy_records', kind || '/' || mgmt_id));
--> statement-breakpoint
-- Báo giá: app vốn xoá được (route owner) ⇒ policy chỉ siết KHI đang hoàn tác lô.
DROP POLICY IF EXISTS price_quotes_import_rb ON contracts.price_quotes;
--> statement-breakpoint
CREATE POLICY price_quotes_import_rb ON contracts.price_quotes AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (coalesce(current_setting('contracts.import_rb', true), '') = ''
    OR contracts.import_rb_has('price_quotes', id::text));
--> statement-breakpoint
-- Hoàn tác MỘT lô trong tenant của tx: văn bản ký → chứng thư → giá thị trường → báo giá → vùng chờ → khách CKS (chỉ khách lô tạo
-- mà không còn hàng nào trỏ tới). Trả JSON số hàng xoá mỗi bảng; sổ của lô xoá theo.
CREATE OR REPLACE FUNCTION contracts.import_rollback(p_tenant uuid, p_source text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  out jsonb := '{}'::jsonb;
  n int;
BEGIN
  IF p_tenant IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'import_rollback: tenant khác phạm vi tx' USING ERRCODE = '42501';
  END IF;
  IF p_source IS NULL OR p_source !~ '^[a-z0-9][a-z0-9._-]{0,63}$' THEN
    RAISE EXCEPTION 'import_rollback: nhãn lô không hợp lệ' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('contracts.import_rb', p_source, true);
  DELETE FROM contracts.cks_signed_docs t WHERE t.tenant_id = p_tenant AND contracts.import_rb_has('cks_signed_docs', t.id::text);
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('cks_signed_docs', n);
  DELETE FROM contracts.cks_certificates t WHERE t.tenant_id = p_tenant AND contracts.import_rb_has('cks_certificates', t.id::text);
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('cks_certificates', n);
  DELETE FROM contracts.cks_market_prices t WHERE t.tenant_id = p_tenant AND contracts.import_rb_has('cks_market_prices', t.id::text);
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('cks_market_prices', n);
  DELETE FROM contracts.price_quotes t WHERE t.tenant_id = p_tenant AND contracts.import_rb_has('price_quotes', t.id::text);
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('price_quotes', n);
  DELETE FROM contracts.legacy_records t WHERE t.tenant_id = p_tenant
    AND contracts.import_rb_has('legacy_records', t.kind || '/' || t.mgmt_id);
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('legacy_records', n);
  DELETE FROM contracts.cks_customers t WHERE t.tenant_id = p_tenant AND contracts.import_rb_has('cks_customers', t.id::text)
    AND NOT EXISTS (SELECT 1 FROM contracts.cks_certificates x WHERE x.tenant_id = p_tenant AND x.customer_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM contracts.cks_signed_docs x WHERE x.tenant_id = p_tenant AND x.customer_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM contracts.cks_renewals x WHERE x.tenant_id = p_tenant AND x.customer_id = t.id)
    AND NOT EXISTS (SELECT 1 FROM contracts.cks_followups x WHERE x.tenant_id = p_tenant AND x.customer_id = t.id);
  GET DIAGNOSTICS n = ROW_COUNT; out := out || jsonb_build_object('cks_customers', n);
  DELETE FROM contracts.import_rows r WHERE r.tenant_id = p_tenant AND r.source = p_source;
  PERFORM set_config('contracts.import_rb', '', true);
  RETURN out;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.import_rollback(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.import_rollback(uuid, text) TO contracts_rw;
