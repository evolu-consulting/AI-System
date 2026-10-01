-- ADM-FR-50, ADM-FR-31, ADM-NFR-07 · RLS secrets (chỉ platform) + feature_entitlements (theo tenant); quyền hub_ro/admin_rw
-- (spec M2 §4, plan §3.1). Migration custom: policy/GRANT cột không khai trong schema Drizzle.
ALTER TABLE admin.secrets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY secrets_admin_rw ON admin.secrets FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform')
  WITH CHECK (current_setting('app.scope', true) = 'platform');
--> statement-breakpoint
REVOKE ALL ON admin.secrets FROM hub_ro;
--> statement-breakpoint
REVOKE ALL ON admin.secrets FROM PUBLIC;
--> statement-breakpoint
-- admin-api không giải mã ở M2: không cho đọc bản mã kể cả khi có bug/SQL injection.
REVOKE SELECT ON admin.secrets FROM admin_rw;
--> statement-breakpoint
GRANT SELECT (id, name, key_version, last4, note, created_at, updated_at, updated_by) ON admin.secrets TO admin_rw;
--> statement-breakpoint
ALTER TABLE admin.feature_entitlements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY feature_entitlements_admin_rw ON admin.feature_entitlements FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY feature_entitlements_hub_ro ON admin.feature_entitlements FOR SELECT TO hub_ro USING (true);
