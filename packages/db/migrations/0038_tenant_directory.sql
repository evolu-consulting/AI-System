-- CR-124 · q2 · FLOW4-FR-03/04/05 · NFR-03/04 · Danh bạ công ty (spec §4): CÔNG KHAI, TỰ NGUYỆN, đọc thẳng `admin.tenants`
-- (một nguồn — không bảng sao). 3 cột mới trên chính hồ sơ công ty; tìm kiếm là HÀM chỉ đọc trả đúng cột công khai.
-- hub_ro: cột mới KHÔNG cấp (GRANT cột tường minh từ 0036) ⇒ Hub không đọc được cờ này trực tiếp (chỉ qua hàm hub DEFINER).
ALTER TABLE admin.tenants
  ADD COLUMN IF NOT EXISTS directory_listed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS directory_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS directory_verified_by uuid;
--> statement-breakpoint
ALTER TABLE admin.tenants
  ADD CONSTRAINT tenants_directory_verified_ck CHECK ((directory_verified_at IS NULL) = (directory_verified_by IS NULL));
--> statement-breakpoint
-- MST khớp đúng: btree một phần chỉ trên công ty đã bật (nhỏ). Tên: trigram nếu có pg_trgm (extension "trusted"; thiếu quyền ⇒
-- bỏ qua, hàm vẫn đúng — chỉ chậm hơn khi nhiều công ty).
CREATE INDEX IF NOT EXISTS tenants_directory_tax_idx ON admin.tenants (tax_code)
  WHERE directory_listed AND tax_code IS NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm không bật được (%): bỏ index trigram của danh bạ', SQLERRM;
  END;
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS tenants_directory_name_trgm_idx ON admin.tenants USING gin (legal_name %I.gin_trgm_ops)
                    WHERE directory_listed AND legal_name IS NOT NULL',
                   (SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm'));
  END IF;
END $$;
--> statement-breakpoint
-- Tìm danh bạ: MST (10 số, chi nhánh -xxx) khớp ĐÚNG, hoặc tên pháp lý chứa ≥ 3 ký tự (không phân biệt hoa thường). Tối đa 20.
-- Chỉ công ty đã bật + đang hoạt động + có tên pháp lý; KHÔNG trả công ty của người gọi. Trả đúng 5 cột công khai:
--   tenant_id (cần để gửi — là uuid không bí mật, đổi sang mã khác phải có bảng ánh xạ = nguồn thứ hai), legal_name, tax_code,
--   address, verified. Không người dùng / liên hệ / số liệu (FLOW4-FR-04). Chưa đặt phạm vi ⇒ 42501 (fail-closed).
CREATE OR REPLACE FUNCTION admin.directory_search(p_query text)
RETURNS TABLE (tenant_id uuid, legal_name text, tax_code text, address text, verified boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_scope text := NULLIF(current_setting('app.scope', true), '');
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_q text := btrim(COALESCE(p_query, ''));
BEGIN
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'directory_search: chưa đặt phạm vi' USING ERRCODE = '42501';
  END IF;
  IF v_q ~ '^[0-9]{10}(-[0-9]{3})?$' THEN
    RETURN QUERY
    SELECT t.id, t.legal_name, t.tax_code, t.address, t.directory_verified_at IS NOT NULL
      FROM admin.tenants t
     WHERE t.directory_listed AND t.active AND t.legal_name IS NOT NULL AND t.tax_code = v_q
       AND t.id IS DISTINCT FROM v_tid
     ORDER BY t.legal_name LIMIT 20;
  ELSIF char_length(v_q) >= 3 THEN
    RETURN QUERY
    SELECT t.id, t.legal_name, t.tax_code, t.address, t.directory_verified_at IS NOT NULL
      FROM admin.tenants t
     WHERE t.directory_listed AND t.active AND t.legal_name IS NOT NULL
       AND t.legal_name ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
       AND t.id IS DISTINCT FROM v_tid
     ORDER BY (t.directory_verified_at IS NOT NULL) DESC, t.legal_name LIMIT 20;
  END IF;
END $$;
--> statement-breakpoint
-- Dấu "Đã xác minh": CHỈ phạm vi nền tảng (`app.scope = 'platform'`) đặt/xoá được. Lưu ý: `app.scope` là biến phiên mà admin-api tự đặt
-- (ai có role admin_rw đặt được) ⇒ kiểm ở DB chỉ là lớp phụ chặn nhầm; cổng thật là route `requireRole(platform_admin)` + service. Trả TRUE khi đổi.
CREATE OR REPLACE FUNCTION admin.directory_set_verified(p_tenant uuid, p_verified boolean, p_by uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF current_setting('app.scope', true) IS DISTINCT FROM 'platform' THEN
    RAISE EXCEPTION 'directory_set_verified: chỉ quản trị nền tảng' USING ERRCODE = '42501';
  END IF;
  IF p_verified AND p_by IS NULL THEN
    RAISE EXCEPTION 'directory_set_verified: thiếu người xác minh' USING ERRCODE = '22023';
  END IF;
  UPDATE admin.tenants t
     SET directory_verified_at = CASE WHEN p_verified THEN now() END,
         directory_verified_by = CASE WHEN p_verified THEN p_by END,
         version = t.version + 1, updated_at = now(), updated_by = p_by
   WHERE t.id = p_tenant AND (t.directory_verified_at IS NOT NULL) IS DISTINCT FROM p_verified;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.directory_search(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.directory_set_verified(uuid, boolean, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin.directory_search(text) TO admin_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin.directory_set_verified(uuid, boolean, uuid) TO admin_rw;
