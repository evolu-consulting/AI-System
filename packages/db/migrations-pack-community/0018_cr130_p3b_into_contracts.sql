-- CR-130 pha 3 · lát 2 (ADR-0044): Bảng tin thôi là gói quyền riêng — quyền = gói `contracts`, bật/tắt = add-on `contracts-community`
-- (admin nền tảng bật; khoá dùng dấu gạch vì admin.features.key chỉ cho [a-z0-9-]). Chưa có khách thật ⇒ KHÔNG backfill dữ liệu
-- nghiệp vụ: chỉ (1) thêm add-on vào catalog, (2) giữ entitlement của công ty đang có Bảng tin (tenant dev/demo còn dùng được),
-- (3) gỡ feature `community-read|write|admin` + Group vai `community-owner|editor|viewer` (app_roles pack='community') cùng mọi
-- dữ liệu phụ thuộc (grant → thành viên → app_roles → Group → entitlement/quota → feature), set-based, kèm audit feature,
-- (4) danh mục app `community` đòi add-on thay vì `community-read`. `partner_companies` đã drop ở 0011 (không còn policy
-- `viewer_is_admin('community')`). Chạy lại vô hại.
INSERT INTO admin.features (key, name, status)
VALUES ('contracts-community', '{"vi": "Bảng tin", "en": "Community feed"}', 'on')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
INSERT INTO admin.feature_entitlements (feature_id, tenant_id)
SELECT a.id, e.tenant_id
FROM admin.feature_entitlements e
JOIN admin.features f ON f.id = e.feature_id AND f.key = 'community-read' AND e.revoked_at IS NULL
CROSS JOIN admin.features a
WHERE a.key = 'contracts-community'
  AND EXISTS (SELECT 1 FROM admin.feature_entitlements ce  -- chỉ khi công ty đã có gói contracts (tránh add-on nửa vời)
    JOIN admin.features cf ON cf.id = ce.feature_id AND cf.key = 'contracts-read'
    WHERE ce.tenant_id = e.tenant_id AND ce.revoked_at IS NULL)
ON CONFLICT (feature_id, tenant_id) DO UPDATE SET revoked_at = NULL;
--> statement-breakpoint
-- Group vai Bảng tin = theo app_roles (pack='community') ∪ mã `community-owner|editor|viewer` (mỗi câu tự tính tập, không bảng tạm).
DELETE FROM admin.feature_grants g
USING admin.features f
WHERE f.id = g.feature_id AND f.key IN ('community-read', 'community-write', 'community-admin');
--> statement-breakpoint
DELETE FROM admin.feature_grants g USING (SELECT tenant_id, group_id AS id FROM admin.app_roles WHERE pack = 'community'
   UNION SELECT tenant_id, id FROM admin.groups WHERE key IN ('community-owner', 'community-editor', 'community-viewer')) x WHERE g.tenant_id = x.tenant_id AND g.group_id = x.id;
--> statement-breakpoint
DELETE FROM admin.group_members m USING (SELECT tenant_id, group_id AS id FROM admin.app_roles WHERE pack = 'community'
   UNION SELECT tenant_id, id FROM admin.groups WHERE key IN ('community-owner', 'community-editor', 'community-viewer')) x WHERE m.tenant_id = x.tenant_id AND m.group_id = x.id;
--> statement-breakpoint
WITH gone AS (
  DELETE FROM admin.groups g USING (SELECT tenant_id, group_id AS id FROM admin.app_roles WHERE pack = 'community'
   UNION SELECT tenant_id, id FROM admin.groups WHERE key IN ('community-owner', 'community-editor', 'community-viewer')) x WHERE g.tenant_id = x.tenant_id AND g.id = x.id
  RETURNING g.tenant_id, g.id, g.key)
INSERT INTO admin.audit_log (tenant_id, action, entity, entity_id, entity_name, summary)
SELECT tenant_id, 'delete', 'group', id, key,
       '{"reason": "CR-130 ADR-0044: gỡ Group vai Bảng tin (gộp vào gói contracts)"}'::jsonb
FROM gone;
--> statement-breakpoint
DELETE FROM admin.app_roles WHERE pack = 'community';
--> statement-breakpoint
DELETE FROM admin.feature_entitlements e USING admin.features f
WHERE f.id = e.feature_id AND f.key IN ('community-read', 'community-write', 'community-admin');
--> statement-breakpoint
DELETE FROM admin.tenant_quotas x USING admin.features f
WHERE f.id = x.feature_id AND f.key IN ('community-read', 'community-write', 'community-admin');
--> statement-breakpoint
DELETE FROM admin.quota_alerts x USING admin.features f
WHERE f.id = x.feature_id AND f.key IN ('community-read', 'community-write', 'community-admin');
--> statement-breakpoint
WITH snap AS (
  SELECT f.id, jsonb_build_object('key', f.key, 'name', f.name, 'description', f.description,
           'icon', coalesce(f.icon, 'package'), 'status', f.status) AS b
  FROM admin.features f WHERE f.key IN ('community-read', 'community-write', 'community-admin')),
gone AS (
  DELETE FROM admin.features WHERE key IN ('community-read', 'community-write', 'community-admin') RETURNING id, key, version)
INSERT INTO admin.audit_log (tenant_id, action, entity, entity_id, entity_name, entity_version, before, summary)
SELECT NULL, 'delete', 'feature', g.id, g.key, g.version, s.b,
       '{"reason": "CR-130 ADR-0044: Bảng tin gộp vào gói contracts (add-on contracts-community)"}'::jsonb
FROM gone g JOIN snap s ON s.id = g.id;
--> statement-breakpoint
UPDATE admin.app_catalog SET required_feature = 'contracts-community' WHERE key = 'community';
