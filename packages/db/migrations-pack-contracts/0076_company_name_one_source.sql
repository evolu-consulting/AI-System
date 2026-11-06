-- CR-121 c20 (D3, Luật GỐC 1) · tên công ty MỘT nguồn = `admin.tenants.name`. Gỡ bản trùng `contracts.company_settings.company_name`
-- (0034) sau khi backfill/so khớp; mọi chỗ đọc chuyển sang `contracts.tenant_name()` (tên của TENANT PHIÊN). Brand app (`app_name`,
-- `logo`, `accent`) giữ ở gói contracts. Đổi tên ở Admin đã bump `config_version` + NOTIFY kèm tenant_id (admin-api `configWrite`) ⇒ ETag `/pack/me` đổi.
-- Set-based: một UPDATE + một SELECT tổng hợp, không lặp theo hàng. Chạy lại được (không còn cột ⇒ bỏ qua bước so khớp).

-- 1. Đọc tên qua tenant của phiên: SECURITY DEFINER (role gói `contracts_rw` không có quyền trên `admin`), lọc cứng theo `app.tenant_id`
--    ⇒ không đọc chéo tenant (không có tham số tenant). Thiếu `app.tenant_id` ⇒ NULL.
CREATE OR REPLACE FUNCTION contracts.tenant_name() RETURNS text
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RETURN (SELECT t.name FROM admin.tenants t WHERE t.id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.tenant_name() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.tenant_name() TO contracts_rw;
--> statement-breakpoint
-- 2. Backfill + so khớp (chủ migration; bảng FORCE RLS ⇒ tạm NO FORCE trong cùng transaction rồi FORCE lại).
--    Admin trống tên mà gói có tên ⇒ chép sang admin. Cả hai có tên nhưng lệch ⇒ LẤY `admin.tenants.name`, ghi báo cáo (NOTICE: số lượng + 10 mẫu).
DO $$
DECLARE
  filled int;
  differ int;
  sample text[];
BEGIN
  IF to_regclass('admin.tenants') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'contracts.company_settings'::regclass
                    AND a.attname = 'company_name' AND NOT a.attisdropped) THEN
    RETURN;
  END IF;
  ALTER TABLE contracts.company_settings NO FORCE ROW LEVEL SECURITY;
  WITH up AS (
    UPDATE admin.tenants t SET name = btrim(s.company_name)
      FROM contracts.company_settings s
      WHERE s.tenant_id = t.id AND nullif(btrim(t.name), '') IS NULL AND nullif(btrim(s.company_name), '') IS NOT NULL
      RETURNING t.id)
  SELECT count(*) INTO filled FROM up;
  SELECT count(*), (array_agg(t.key || ': "' || btrim(s.company_name) || '" -> "' || t.name || '"' ORDER BY t.key))[1:10]
    INTO differ, sample
    FROM contracts.company_settings s JOIN admin.tenants t ON t.id = s.tenant_id
    WHERE nullif(btrim(s.company_name), '') IS NOT NULL AND btrim(s.company_name) <> t.name;
  ALTER TABLE contracts.company_settings FORCE ROW LEVEL SECURITY;
  RAISE NOTICE 'cr121-c20: % tenant trống tên được chép từ company_settings; % tenant lệch tên (lấy admin.tenants.name): %',
    filled, differ, coalesce(sample::text, '{}');
END $$;
--> statement-breakpoint
-- 3. Trigger chỉ còn theo dõi brand app: `app_name, logo, accent` (giữ cơ chế bump `profile_version` + NOTIFY của 0073).
CREATE OR REPLACE FUNCTION contracts.brand_config_bump() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.app_name, NEW.logo, NEW.accent)
      IS NOT DISTINCT FROM (OLD.app_name, OLD.logo, OLD.accent) THEN
    RETURN NULL;
  END IF;
  INSERT INTO admin.config_meta (id, config_version, profile_version, updated_at) VALUES (1, 0, 1, now())
    ON CONFLICT (id) DO UPDATE SET profile_version = admin.config_meta.profile_version + 1, updated_at = now()
    RETURNING profile_version INTO v;
  PERFORM pg_notify('profile_changed',
    json_build_object('v', v, 'entity', 'tenant', 'tenant_id', NEW.tenant_id::text)::text);
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.brand_config_bump() FROM PUBLIC;
--> statement-breakpoint
-- 4. Gỡ cột: ràng buộc độ dài tên (tham chiếu cột) thay bằng ràng buộc `app_name`.
ALTER TABLE contracts.company_settings DROP CONSTRAINT IF EXISTS company_settings_name_ck;
--> statement-breakpoint
ALTER TABLE contracts.company_settings DROP CONSTRAINT IF EXISTS company_settings_app_name_ck;
--> statement-breakpoint
ALTER TABLE contracts.company_settings ADD CONSTRAINT company_settings_app_name_ck CHECK (char_length(app_name) <= 40);
--> statement-breakpoint
ALTER TABLE contracts.company_settings DROP COLUMN IF EXISTS company_name;
