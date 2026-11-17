-- CR-181 · fix-cr181-be · Đọc ảnh chữ ký theo id cho máy chủ in (PDF Hồ sơ duyệt / bản lưu tự động / route stamps).
-- `hub_rw` KHÔNG có quyền SELECT bảng `hub.user_signatures` (0155) ⇒ SELECT thẳng ở `stampPngOf` trả 42501. Thêm hàm DEFINER (chỉ THÊM; chạy lại được:
-- CREATE OR REPLACE, REVOKE/GRANT lặp vô hại): chỉ khi `app.scope = 'system'` hoặc `app.tenant_id` = p_tenant (khác ⇒ 42501); chỉ trả hàng của đúng p_tenant.
CREATE OR REPLACE FUNCTION hub.signature_png_by_ids(p_tenant uuid, p_ids uuid[])
RETURNS TABLE (id uuid, png bytea)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('app.scope', true), '') <> 'system'
     AND p_tenant IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'signature_png_by_ids: tenant không khớp ngữ cảnh' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s.id, s.png FROM hub.user_signatures s WHERE s.tenant_id = p_tenant AND s.id = ANY(p_ids);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.signature_png_by_ids(uuid, uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.signature_png_by_ids(uuid, uuid[]) TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT EXECUTE ON FUNCTION hub.signature_png_by_ids(uuid, uuid[]) TO contracts_rw;
  END IF;
END $$;
