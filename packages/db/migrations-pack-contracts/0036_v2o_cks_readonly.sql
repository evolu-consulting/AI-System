-- V2-O · intake Q4/C6 (CR-096): CKS (HD9) chỉ đọc TOÀN CỤC — V2-H mới khoá cho nitigroup/demo. Mặc định (hàng cài đặt vắng hoặc
-- cks_writable null) = chỉ đọc cho MỌI tenant; hàng `business_settings.cks_writable = true` còn mở ghi (test HD9 / tenant cũ cần dữ liệu).
-- Chỉ thay thân hàm; chạy lại vô hại.
CREATE OR REPLACE FUNCTION contracts.cks_writable() RETURNS boolean
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT b.cks_writable FROM contracts.business_settings b
                   WHERE b.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid), false)
$$;