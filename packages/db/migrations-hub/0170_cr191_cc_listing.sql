-- CR-191 · BR-187-5 (đổi nghĩa «quản trị» theo người dùng chốt 19/11): công tắc «Cho công ty khác tìm thấy công ty mình» do NGƯỜI QUẢN TRỊ SỔ HỢP TÁC
-- (Toàn quyền, việc `admin` gói contracts) của chính công ty đó bật/tắt, đi qua route gói contracts thay cho API admin (`tenant_admin`). CHỈ THÊM, chạy lại được.
-- Role gói không ghi được `admin.tenants` ⇒ hàm DEFINER: kiểm tenant (GUC) + người gọi ∈ người Toàn quyền + điều kiện cũ (tên pháp lý + MST khi BẬT).
-- Tăng `version`/`updated_at`/`updated_by` như đường admin cũ (cùng bộ đếm `version` của hồ sơ). Audit do route ghi (khuôn `auditDisconnect`).
-- Lỗi nghiệp vụ: CC422 · DIRECTORY_NEEDS_PROFILE (map CONNECT_NEEDS_PROFILE ở route).
CREATE OR REPLACE FUNCTION hub.cc_listing()
RETURNS TABLE (listed boolean, has_profile boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_listing: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.directory_listed,
         COALESCE(btrim(t.legal_name), '') <> '' AND COALESCE(btrim(t.tax_code), '') <> ''
    FROM admin.tenants t WHERE t.id = v_tid;
END $$;
--> statement-breakpoint
-- Trả true khi có đổi. Người gọi (`p_user`) phải là người Toàn quyền của công ty đang thao tác, không thì 42501.
CREATE OR REPLACE FUNCTION hub.cc_set_listed(p_listed boolean, p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tid uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_cur boolean;
  v_ok boolean;
BEGIN
  IF v_tid IS NULL THEN
    RAISE EXCEPTION 'cc_set_listed: chưa đặt tenant' USING ERRCODE = '42501';
  END IF;
  IF p_listed IS NULL THEN
    RAISE EXCEPTION 'cc_set_listed: thiếu giá trị' USING ERRCODE = '22023';
  END IF;
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM hub.cc_owners_raw(ARRAY[v_tid]) w WHERE w.user_id = p_user) THEN
    RAISE EXCEPTION 'cc_set_listed: chỉ người quản trị Sổ Hợp Tác' USING ERRCODE = '42501';
  END IF;
  SELECT t.directory_listed, COALESCE(btrim(t.legal_name), '') <> '' AND COALESCE(btrim(t.tax_code), '') <> ''
    INTO v_cur, v_ok FROM admin.tenants t WHERE t.id = v_tid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cc_set_listed: công ty không tồn tại' USING ERRCODE = '42501';
  END IF;
  IF v_cur = p_listed THEN
    RETURN false;
  END IF;
  IF p_listed AND NOT v_ok THEN
    RAISE EXCEPTION 'CONNECT_NEEDS_PROFILE' USING ERRCODE = 'CC422';
  END IF;
  UPDATE admin.tenants SET directory_listed = p_listed, version = version + 1, updated_at = now(), updated_by = p_user
   WHERE id = v_tid;
  RETURN true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_listing() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.cc_set_listed(boolean, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.cc_listing(), hub.cc_set_listed(boolean, uuid) TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT USAGE ON SCHEMA hub TO contracts_rw;
    GRANT EXECUTE ON FUNCTION hub.cc_listing(), hub.cc_set_listed(boolean, uuid) TO contracts_rw;
  END IF;
END $$;
