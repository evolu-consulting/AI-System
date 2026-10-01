-- ADM-NFR-07 · RLS + role đăng nhập admin_api (spec M1 §4, plan §3.1). Migration custom: policy/hàm
-- không khai trong schema Drizzle nên `db:generate` không sinh lệnh xoá chúng.
-- Hàng tenant chỉ thấy khi app.scope = 'tenant' VÀ đúng app.tenant_id; scope lạ/thiếu → không thấy gì.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_api') THEN
    CREATE ROLE admin_api NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;
--> statement-breakpoint
ALTER ROLE admin_api NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
--> statement-breakpoint
GRANT admin_rw TO admin_api;
--> statement-breakpoint
ALTER TABLE admin.tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE admin.users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE admin.refresh_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenants_admin_rw ON admin.tenants FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY users_admin_rw ON admin.users FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY refresh_tokens_admin_rw ON admin.refresh_tokens FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY tenants_hub_ro ON admin.tenants FOR SELECT TO hub_ro USING (true);
--> statement-breakpoint
CREATE POLICY users_hub_ro ON admin.users FOR SELECT TO hub_ro USING (true);
--> statement-breakpoint
REVOKE ALL ON admin.refresh_tokens FROM hub_ro;
--> statement-breakpoint
REVOKE SELECT ON admin.users FROM hub_ro;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, username, display_name, email, role, locale, active,
              locked_by_tenant, created_at, updated_at, version) ON admin.users TO hub_ro;
--> statement-breakpoint
CREATE FUNCTION admin.tenant_id_by_key(p_key text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT t.id FROM admin.tenants t WHERE t.key = p_key $$;
--> statement-breakpoint
CREATE FUNCTION admin.tenant_id_by_refresh_hash(p_hash bytea) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT r.tenant_id FROM admin.refresh_tokens r WHERE r.token_hash = p_hash $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.tenant_id_by_key(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.tenant_id_by_refresh_hash(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin.tenant_id_by_key(text) TO admin_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin.tenant_id_by_refresh_hash(bytea) TO admin_rw;
