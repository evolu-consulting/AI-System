-- ADM-FR-62, ADM-FR-32, ADM-FR-53, ADM-NFR-07 · RLS groups/group_members/feature_grants, quyền config_meta, trigger
-- beta-testers, backfill, hàng config_meta (spec M3 §4, plan §3.1). Migration custom: policy/trigger không khai trong Drizzle.
ALTER TABLE admin.groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE admin.group_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE admin.feature_grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY groups_admin_rw ON admin.groups FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY groups_hub_ro ON admin.groups FOR SELECT TO hub_ro USING (true);
--> statement-breakpoint
CREATE POLICY group_members_admin_rw ON admin.group_members FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY group_members_hub_ro ON admin.group_members FOR SELECT TO hub_ro USING (true);
--> statement-breakpoint
CREATE POLICY feature_grants_admin_rw ON admin.feature_grants FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY feature_grants_hub_ro ON admin.feature_grants FOR SELECT TO hub_ro USING (true);
--> statement-breakpoint
-- config_meta: không RLS (một hàng toàn hệ thống); app không bao giờ xoá.
REVOKE DELETE, TRUNCATE ON admin.config_meta FROM admin_rw;
--> statement-breakpoint
INSERT INTO admin.config_meta (id, config_version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint
-- beta-testers (M3-R02, A10): tạo cùng transaction với mọi INSERT tenant (service, seed, fixture SQL). SECURITY INVOKER:
-- chạy bằng role đang chèn tenant (admin_api scope platform qua RLS; owner bỏ qua RLS).
CREATE FUNCTION admin.create_beta_group() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO admin.groups (tenant_id, key, name, description)
  VALUES (NEW.id, 'beta-testers', '{"vi":"Beta testers","en":"Beta testers"}'::jsonb,
          'Thấy các feature đang Beta')
  ON CONFLICT (tenant_id, key) DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER tenants_beta_group AFTER INSERT ON admin.tenants
  FOR EACH ROW EXECUTE FUNCTION admin.create_beta_group();
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.create_beta_group() FROM PUBLIC;
--> statement-breakpoint
INSERT INTO admin.groups (tenant_id, key, name, description)
  SELECT t.id, 'beta-testers', '{"vi":"Beta testers","en":"Beta testers"}'::jsonb, 'Thấy các feature đang Beta'
  FROM admin.tenants t
  ON CONFLICT (tenant_id, key) DO NOTHING;
