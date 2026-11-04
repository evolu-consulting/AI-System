-- CR-118 · cr118-r1-fixes #3: đổi brand công ty (4 cột của `/pack/me`) chỉ chạm MỘT tenant ⇒ bump
-- `admin.config_meta.profile_version` (admin 0034) + `pg_notify('profile_changed', {v, entity:'tenant', tenant_id})` CÙNG
-- transaction ghi, thay cho bump `config_version` toàn cục của 0072 (mọi hub nạp lại cả ảnh Admin). Thay thân hàm, giữ trigger.
-- SECURITY DEFINER như 0072; khoá `config_meta` là câu cuối của trigger AFTER ⇒ không vòng chờ.
CREATE OR REPLACE FUNCTION contracts.brand_config_bump() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.company_name, NEW.app_name, NEW.logo, NEW.accent)
      IS NOT DISTINCT FROM (OLD.company_name, OLD.app_name, OLD.logo, OLD.accent) THEN
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
