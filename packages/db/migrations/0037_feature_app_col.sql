-- CR-121 c18 (D1 + D5) · `admin.features.app`: NGUỒN DUY NHẤT feature → ứng dụng (thay suy theo tiền tố khoá ở tenants.repo / feature-meta),
-- và gỡ feature `contracts-approval-engine` (duyệt HĐ bằng engine bật khi công ty được GÁN quy trình — D-4; không còn công tắc riêng).
-- Dữ liệu khách: set-based (một câu mỗi bảng), chạy lại vô hại. Thứ tự: hàm map → cột (nullable) → backfill → NOT NULL + CHECK → trigger
-- điền-khi-thiếu cho INSERT SQL thẳng (cài gói `packs.install`, seed) → gỡ engine (entitlement → grant → quota → feature) kèm audit.
-- Tập giá trị `app` = core | chat | community | contracts | knowledge | other (`other` = chưa phân vào ứng dụng nào; hiện nhóm "Khác").
CREATE OR REPLACE FUNCTION admin.feature_app_of(p_key text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_key = 'core' THEN 'core'
    WHEN p_key = 'chat-app' THEN 'chat'
    WHEN p_key = 'han-muc-duyet' THEN 'contracts'
    WHEN split_part(p_key, '-', 1) IN ('community', 'contracts', 'knowledge') AND p_key LIKE '%-%'
      THEN split_part(p_key, '-', 1)
    ELSE 'other'
  END
$$;
--> statement-breakpoint
ALTER TABLE admin.features ADD COLUMN IF NOT EXISTS app text;
--> statement-breakpoint
UPDATE admin.features SET app = admin.feature_app_of(key) WHERE app IS NULL;
--> statement-breakpoint
ALTER TABLE admin.features ALTER COLUMN app SET NOT NULL;
--> statement-breakpoint
ALTER TABLE admin.features DROP CONSTRAINT IF EXISTS features_app_check;
--> statement-breakpoint
ALTER TABLE admin.features
  ADD CONSTRAINT features_app_check CHECK (app IN ('core', 'chat', 'community', 'contracts', 'knowledge', 'other'));
--> statement-breakpoint
-- Feature tạo bằng INSERT SQL thẳng (gói cài `<gói>-read/write/admin`, seed) không nêu `app` ⇒ điền theo cùng hàm map (một chỗ định nghĩa);
-- mọi chỗ ĐỌC dùng cột. Đường API/import truyền `app` tường minh.
CREATE OR REPLACE FUNCTION admin.features_app_fill() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.app IS NULL THEN NEW.app := admin.feature_app_of(NEW.key); END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS features_app_fill ON admin.features;
--> statement-breakpoint
CREATE TRIGGER features_app_fill BEFORE INSERT ON admin.features
  FOR EACH ROW EXECUTE FUNCTION admin.features_app_fill();
--> statement-breakpoint
-- Gỡ `contracts-approval-engine`: MỌI dữ liệu phụ thuộc xoá TƯỜNG MINH (không để FK cascade lặng lẽ), mỗi loại một câu set-based kèm audit theo công ty:
-- entitlement → grant → quota (tenant_quotas + quota_alerts của feature) → hàng feature (cascade chỉ còn feature_commands; id lệnh nằm trong `before`).
-- Audit hàng feature có `before` (key, name, mô tả, icon, status, command_ids) để khôi phục từ audit chèn lại được.
WITH gone AS (
  DELETE FROM admin.feature_entitlements e USING admin.features f
  WHERE f.id = e.feature_id AND f.key = 'contracts-approval-engine'
  RETURNING e.tenant_id, e.feature_id)
INSERT INTO admin.audit_log (tenant_id, action, entity, entity_id, entity_name, summary)
SELECT tenant_id, 'delete', 'entitlement', feature_id, 'contracts-approval-engine',
       '{"reason": "CR-121 c18: gỡ feature engine (gán quy trình là đủ)"}'::jsonb
FROM gone;
--> statement-breakpoint
WITH gone AS (
  DELETE FROM admin.feature_grants g USING admin.features f
  WHERE f.id = g.feature_id AND f.key = 'contracts-approval-engine'
  RETURNING g.tenant_id, g.feature_id)
INSERT INTO admin.audit_log (tenant_id, action, entity, entity_id, entity_name, summary)
SELECT tenant_id, 'delete', 'grant', feature_id, 'contracts-approval-engine',
       jsonb_build_object('reason', 'CR-121 c18: gỡ feature engine (gán quy trình là đủ)', 'rows', count(*))
FROM gone GROUP BY tenant_id, feature_id;
--> statement-breakpoint
WITH q AS (
  DELETE FROM admin.tenant_quotas x USING admin.features f
  WHERE f.id = x.feature_id AND f.key = 'contracts-approval-engine'
  RETURNING x.tenant_id, x.feature_id),
a AS (
  DELETE FROM admin.quota_alerts x USING admin.features f
  WHERE f.id = x.feature_id AND f.key = 'contracts-approval-engine'
  RETURNING x.tenant_id, x.feature_id),
qn AS (SELECT tenant_id, feature_id, count(*) AS n FROM q GROUP BY tenant_id, feature_id),
an AS (SELECT tenant_id, feature_id, count(*) AS n FROM a GROUP BY tenant_id, feature_id)
INSERT INTO admin.audit_log (tenant_id, action, entity, entity_id, entity_name, summary)
SELECT coalesce(qn.tenant_id, an.tenant_id), 'delete', 'quota', coalesce(qn.feature_id, an.feature_id), 'contracts-approval-engine',
       jsonb_build_object('reason', 'CR-121 c18: gỡ feature engine (gán quy trình là đủ)',
                          'quotas', coalesce(qn.n, 0), 'alerts', coalesce(an.n, 0))
FROM qn FULL JOIN an ON an.tenant_id = qn.tenant_id AND an.feature_id = qn.feature_id;
--> statement-breakpoint
WITH snap AS (
  SELECT f.id, jsonb_build_object('key', f.key, 'name', f.name, 'description', f.description,
           'icon', coalesce(f.icon, 'package'), 'status', f.status,
           'command_ids', coalesce((SELECT jsonb_agg(fc.command_id) FROM admin.feature_commands fc WHERE fc.feature_id = f.id), '[]'::jsonb)) AS b
  FROM admin.features f WHERE f.key = 'contracts-approval-engine'),
gone AS (
  DELETE FROM admin.features WHERE key = 'contracts-approval-engine' RETURNING id, key, version)
INSERT INTO admin.audit_log (tenant_id, action, entity, entity_id, entity_name, entity_version, before, summary)
SELECT NULL, 'delete', 'feature', g.id, g.key, g.version, s.b,
       '{"reason": "CR-121 c18: gỡ feature engine (gán quy trình là đủ)"}'::jsonb
FROM gone g JOIN snap s ON s.id = g.id;
