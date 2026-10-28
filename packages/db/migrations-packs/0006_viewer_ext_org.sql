-- CR-102 · CR-102a · com-c3-community-base: danh tính người xem cho RLS gói. Đối tác = user `kind='external'` trong tenant
-- chủ quản (admin 0028). `withPackScope` đặt `app.ext_org_id` trong CÙNG câu với `app.user_id`/`app.user_kind` (C2) bằng
-- `packs.scope_ext_org` (đọc DB, không tin người gọi). Giá trị GUC: '' = việc nền · 'internal' · uuid công ty · 'denied'.
-- `packs.viewer_ext_org()` (policy gói gọi, một lần mỗi câu) đọc GUC; vắng GUC mà có user (đường không qua withPackScope,
-- vd test-kit) ⇒ tra DB y như trên (fail-closed: user lạ / vô hiệu / công ty rời ⇒ nil). Kết quả:
--   NULL ⇒ việc nền hoặc user nội bộ (chủ quản) · uuid ⇒ công ty đối tác · nil '00000000-…' ⇒ không khớp gì.
CREATE OR REPLACE FUNCTION packs.scope_ext_org(p_tenant text, p_user text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE
    WHEN NULLIF(p_user, '') IS NULL THEN ''
    WHEN u.id IS NULL THEN 'denied'
    WHEN u.kind = 'internal' THEN 'internal'
    WHEN u.active AND u.deactivated_at IS NULL AND o.active THEN u.external_org_id::text
    ELSE 'denied'
  END
  FROM (SELECT 1) one
  LEFT JOIN admin.users u ON u.id = NULLIF(p_user, '')::uuid AND u.tenant_id = NULLIF(p_tenant, '')::uuid
  LEFT JOIN admin.external_orgs o ON o.tenant_id = u.tenant_id AND o.id = u.external_org_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION packs.scope_ext_org(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA packs TO hub_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION packs.scope_ext_org(text, text) TO hub_api;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION packs.viewer_ext_org() RETURNS uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  u text := coalesce(current_setting('app.user_id', true), '');
  g text := coalesce(current_setting('app.ext_org_id', true), '');
BEGIN
  IF u = '' THEN RETURN NULL; END IF;
  IF g = '' THEN g := packs.scope_ext_org(current_setting('app.tenant_id', true), u); END IF;
  IF g = 'internal' THEN RETURN NULL; END IF;
  IF g ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN g::uuid; END IF;
  RETURN '00000000-0000-0000-0000-000000000000'::uuid;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION packs.viewer_ext_org() FROM PUBLIC;
--> statement-breakpoint
-- CR-102 · com-c3: app web `community` trong danh mục (switcher + đích SSO; đối tác chỉ được cấp mã cho app này — C2
-- `EXTERNAL_APPS`). URL rỗng: admin-api điền từ `APP_URL_COMMUNITY` lúc khởi động (như app-catalog 0016). Đã có ⇒ giữ nguyên.
INSERT INTO admin.app_catalog (key, name, icon, audience, required_feature, sso, sort_order) VALUES
  ('community', '{"vi": "Cộng đồng", "en": "Community"}', 'users', 'all', 'community-read', true, 25)
ON CONFLICT (key) DO NOTHING;
