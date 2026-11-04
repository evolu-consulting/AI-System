-- CR-118 · cr118-config-consistency: đổi nhận diện công ty (tên, tên ứng dụng, logo, màu — 4 cột brand của `/pack/me`) bump
-- `admin.config_meta.config_version` + `pg_notify('config_changed', {v, entity:'tenant', tenant_id})` TRONG CÙNG transaction ghi
-- (trigger ⇒ mọi đường ghi: API cài đặt công ty, seed, tay). Hub LISTEN ⇒ nạp lại phần Admin ⇒ ETag `/pack/me` đổi + `config.changed`
-- tới đúng phiên của tenant đó; bỏ TTL 60 s của brand. Không đổi brand (UPDATE cột khác: MST, theme…) ⇒ không bump.
-- SECURITY DEFINER (chủ migration): role gói `contracts_rw` không có quyền gì trên `admin`. Khoá `config_meta` là câu cuối của
-- trigger AFTER (cùng thứ hạng với `bumpConfigVersion` của admin-api — sau mọi ghi, giữ tới commit) ⇒ không vòng chờ.
CREATE OR REPLACE FUNCTION contracts.brand_config_bump() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v int;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.company_name, NEW.app_name, NEW.logo, NEW.accent)
      IS NOT DISTINCT FROM (OLD.company_name, OLD.app_name, OLD.logo, OLD.accent) THEN
    RETURN NULL;
  END IF;
  INSERT INTO admin.config_meta (id, config_version, updated_at) VALUES (1, 1, now())
    ON CONFLICT (id) DO UPDATE SET config_version = admin.config_meta.config_version + 1, updated_at = now()
    RETURNING config_version INTO v;
  PERFORM pg_notify('config_changed',
    json_build_object('v', v, 'entity', 'tenant', 'tenant_id', NEW.tenant_id::text)::text);
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.brand_config_bump() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS company_settings_brand_bump ON contracts.company_settings;
--> statement-breakpoint
CREATE TRIGGER company_settings_brand_bump AFTER INSERT OR UPDATE ON contracts.company_settings
  FOR EACH ROW EXECUTE FUNCTION contracts.brand_config_bump();
