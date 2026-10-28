-- CR-102 · com-c3 review Thấp3: "người xem là quản trị gói" cho RLS gói (như route: `tenant_admin` hoặc thành viên Group được
-- cấp `<k'>-admin`; grant user lẻ không tính — D-11). Chỉ user nội bộ còn hoạt động. Không tham số user ⇒ role gói chỉ hỏi được
-- về CHÍNH người của tx (`app.user_id`/`app.tenant_id`). Việc nền (không user) ⇒ false (policy tự cho việc nền riêng).
CREATE OR REPLACE FUNCTION packs.viewer_is_admin(p_key text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH me AS (SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid AS t,
                     NULLIF(current_setting('app.user_id', true), '')::uuid AS u)
  SELECT EXISTS (SELECT 1 FROM me JOIN admin.users u ON u.id = me.u AND u.tenant_id = me.t
    WHERE u.kind = 'internal' AND u.active AND (u.role = 'tenant_admin' OR EXISTS (
      SELECT 1 FROM admin.group_members gm
      JOIN admin.feature_grants fg ON fg.tenant_id = gm.tenant_id AND fg.group_id = gm.group_id
      JOIN admin.features f ON f.id = fg.feature_id AND f.key = replace(p_key, '_', '-') || '-admin'
      WHERE gm.tenant_id = me.t AND gm.user_id = me.u)))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION packs.viewer_is_admin(text) FROM PUBLIC;
