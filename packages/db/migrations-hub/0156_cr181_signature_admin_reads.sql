-- CR-181 · lát s2 · Hai hàm ĐỌC bổ sung cho API chữ ký (chỉ THÊM; chạy lại được: CREATE OR REPLACE, GRANT lặp vô hại).
--   hub.sig_change_list(p_limit)  — danh sách xin/cho phép đổi đang mở của CÔNG TY (màn quản trị). Đòi `app.sig_admin = '1'` như hàm ghi của quản trị (42501).
--   hub.sig_settings_of(p_tenant) — thiết lập của MỘT công ty cho máy chủ in / gói khác (không cần người dùng): chỉ khi `app.scope = 'system'` hoặc
--                                   `app.tenant_id` = p_tenant (khác ⇒ 42501). Không có hàng ⇒ 0 dòng (ứng dụng dùng mặc định).
CREATE OR REPLACE FUNCTION hub.sig_change_list(p_limit integer)
RETURNS TABLE (user_id uuid, name text, requested_at timestamptz, granted_at timestamptz, granted_by uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  c record;
BEGIN
  SELECT * INTO c FROM hub.sig_ctx();
  IF COALESCE(current_setting('app.sig_admin', true), '') <> '1' THEN
    RAISE EXCEPTION 'sig_change_list: cần quyền quản trị công ty' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT g.user_id, COALESCE(NULLIF(u.display_name, ''), u.username)::text, g.requested_at, g.granted_at, g.granted_by
    FROM hub.signature_change_grants g
    JOIN admin.users u ON u.id = g.user_id AND u.tenant_id = g.tenant_id
   WHERE g.tenant_id = c.tid AND g.used_at IS NULL
   ORDER BY g.requested_at DESC, g.id
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 200));
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.sig_settings_of(p_tenant uuid)
RETURNS TABLE (methods text[], required boolean, caption text[], ink text, initials text, change_policy text, on_doc_enabled boolean,
               digital_enabled boolean, digital_provider text, updated_by uuid, updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF COALESCE(current_setting('app.scope', true), '') <> 'system'
     AND p_tenant IS DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')::uuid THEN
    RAISE EXCEPTION 'sig_settings_of: tenant không khớp ngữ cảnh' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT g.methods, g.required, g.caption, g.ink, g.initials, g.change_policy, g.on_doc_enabled, g.digital_enabled, g.digital_provider,
         g.updated_by, g.updated_at
    FROM hub.signature_settings g WHERE g.tenant_id = p_tenant;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.sig_change_list(integer), hub.sig_settings_of(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.sig_change_list(integer), hub.sig_settings_of(uuid) TO hub_rw;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_rw') THEN
    GRANT EXECUTE ON FUNCTION hub.sig_settings_of(uuid) TO contracts_rw;
  END IF;
END $$;
