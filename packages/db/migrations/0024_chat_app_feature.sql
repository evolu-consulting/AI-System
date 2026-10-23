-- app-perm · docs/specs/app-perm/tasks.md: Chat AI gắn feature `chat-app` theo CÔNG TY (entitlement), không theo group/user.
-- Luật (app-catalog.rules `TENANT_APP_FEATURES`): tenant có entitlement `chat-app` còn hiệu lực ⇒ mọi user của tenant mở được
-- Chat AI; platform_admin thu hồi entitlement cho một công ty (demo) ⇒ switcher/trang chủ ẩn Chat AI. Feature chưa tồn tại ⇒
-- coi như mở (DB trống/test). Không ai mất Chat: mọi tenant hiện có được entitlement; tenant mới tự có qua trigger.
-- Chỉ tạo feature khi đã có tenant (DB thật); DB trống (template test, cài mới) giữ nguyên ⇒ không đổi hành vi test cũ.
INSERT INTO admin.features (key, name, description, icon, status)
SELECT 'chat-app', '{"vi": "Chat AI", "en": "AI Chat"}'::jsonb,
       '{"vi": "Mở ứng dụng Chat AI (theo công ty)", "en": "Open the AI Chat app (per company)"}'::jsonb,
       'sparkles', 'on'
WHERE EXISTS (SELECT 1 FROM admin.tenants)
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
INSERT INTO admin.feature_entitlements (feature_id, tenant_id)
SELECT f.id, t.id FROM admin.features f CROSS JOIN admin.tenants t
WHERE f.key = 'chat-app'
ON CONFLICT (feature_id, tenant_id) DO NOTHING;
--> statement-breakpoint
UPDATE admin.app_catalog SET required_feature = 'chat-app', version = version + 1, updated_at = now()
WHERE key = 'chat' AND required_feature IS NULL;
--> statement-breakpoint
-- Tenant mới (service, onboard, import, fixture SQL) có sẵn Chat AI như hôm nay. SECURITY INVOKER như `create_beta_group`.
CREATE OR REPLACE FUNCTION admin.entitle_chat_app_tenant() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO admin.feature_entitlements (feature_id, tenant_id)
  SELECT f.id, NEW.id FROM admin.features f WHERE f.key = 'chat-app'
  ON CONFLICT (feature_id, tenant_id) DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER tenants_chat_app AFTER INSERT ON admin.tenants
  FOR EACH ROW EXECUTE FUNCTION admin.entitle_chat_app_tenant();
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.entitle_chat_app_tenant() FROM PUBLIC;
--> statement-breakpoint
-- Feature `chat-app` tạo sau (môi trường cài mới, platform_admin tạo ở Quản trị › Features) ⇒ cấp cho mọi tenant đang có,
-- tránh cắt Chat AI của tất cả cùng lúc.
CREATE OR REPLACE FUNCTION admin.entitle_chat_app_feature() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.key = 'chat-app' THEN
    INSERT INTO admin.feature_entitlements (feature_id, tenant_id)
    SELECT NEW.id, t.id FROM admin.tenants t
    ON CONFLICT (feature_id, tenant_id) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER features_chat_app AFTER INSERT ON admin.features
  FOR EACH ROW EXECUTE FUNCTION admin.entitle_chat_app_feature();
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.entitle_chat_app_feature() FROM PUBLIC;
