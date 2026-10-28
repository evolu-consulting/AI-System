-- CR-102a · com-fix-pool-scope: `app.user_kind` của `withPackScope` đọc qua hàm DEFINER (như `packs.scope_ext_org`, 0006) thay vì
-- đọc thẳng `admin.users` bằng quyền role đăng nhập — pool riêng của gói (R1 `knowledge_api`, không USAGE trên `admin`) chạy
-- được câu mở tx mà không cấp gì trên `admin`. Ngữ nghĩa giữ nguyên: kind của user theo id; vắng user / user lạ ⇒ ''.
CREATE OR REPLACE FUNCTION packs.scope_user_kind(p_user text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce((SELECT u.kind::text FROM admin.users u WHERE u.id = NULLIF(p_user, '')::uuid), '')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION packs.scope_user_kind(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION packs.scope_user_kind(text) TO hub_api;
