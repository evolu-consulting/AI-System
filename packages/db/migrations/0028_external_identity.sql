-- CR-102a · ADM-FR-74 · com-c1-ext-identity: user ngoài (đối tác) nằm trong tenant chủ quản, thuộc một công ty đối tác.
-- Chỉ cộng thêm: hàng cũ mặc định `kind='internal'`, `external_org_id` NULL, `deactivated_at` NULL. Không xoá cứng công ty
-- (FK restrict). RLS `external_orgs` như bảng tenant khác của admin (0002/0014); hub_ro đọc (Hub lọc tenant tường minh).
CREATE TABLE IF NOT EXISTS admin.external_orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_orgs_tenant_fk FOREIGN KEY (tenant_id) REFERENCES admin.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT external_orgs_created_by_fk FOREIGN KEY (created_by) REFERENCES admin.users (id) ON DELETE SET NULL,
  CONSTRAINT external_orgs_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 200 AND char_length(name) <= 200),
  -- Đích FK kép (tenant_id, external_org_id) của users: user ngoài chỉ trỏ được công ty cùng tenant.
  CONSTRAINT external_orgs_tenant_id_uq UNIQUE (tenant_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS external_orgs_tenant_name_uq ON admin.external_orgs (tenant_id, lower(name));
--> statement-breakpoint
ALTER TABLE admin.external_orgs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY external_orgs_admin_rw ON admin.external_orgs FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY external_orgs_hub_ro ON admin.external_orgs FOR SELECT TO hub_ro USING (true);
--> statement-breakpoint
-- Không xoá cứng (câu 9 intake): admin_rw không có DELETE.
REVOKE DELETE, TRUNCATE ON admin.external_orgs FROM admin_rw;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON admin.external_orgs FROM hub_ro;
--> statement-breakpoint
ALTER TABLE admin.users ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'internal';
--> statement-breakpoint
ALTER TABLE admin.users ADD COLUMN IF NOT EXISTS external_org_id uuid;
--> statement-breakpoint
ALTER TABLE admin.users ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
--> statement-breakpoint
ALTER TABLE admin.users ADD CONSTRAINT users_kind_check CHECK (kind IN ('internal', 'external'));
--> statement-breakpoint
ALTER TABLE admin.users ADD CONSTRAINT users_kind_org_check CHECK ((kind = 'external') = (external_org_id IS NOT NULL));
--> statement-breakpoint
-- User ngoài không bao giờ là admin (không leo tenant_admin/platform_admin).
ALTER TABLE admin.users ADD CONSTRAINT users_external_member_check CHECK (kind <> 'external' OR role = 'member');
--> statement-breakpoint
ALTER TABLE admin.users ADD CONSTRAINT users_deactivated_check CHECK (deactivated_at IS NULL OR NOT active);
--> statement-breakpoint
ALTER TABLE admin.users ADD CONSTRAINT users_external_org_fk FOREIGN KEY (tenant_id, external_org_id)
  REFERENCES admin.external_orgs (tenant_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS users_external_org_idx ON admin.users (tenant_id, external_org_id)
  WHERE external_org_id IS NOT NULL;
--> statement-breakpoint
-- hub_ro đọc theo cột (0002): thêm 3 cột mới cho cổng ExternalOrgResolver của Hub.
GRANT SELECT (kind, external_org_id, deactivated_at) ON admin.users TO hub_ro;
--> statement-breakpoint
-- kind / external_org_id bất biến sau khi tạo: đổi loại user = tạo tài khoản mới (token cũ không mang claim sai).
CREATE OR REPLACE FUNCTION admin.users_kind_fixed() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.external_org_id IS DISTINCT FROM OLD.external_org_id THEN
    RAISE EXCEPTION 'users: kind/external_org_id bất biến' USING ERRCODE = '23514',
      CONSTRAINT = 'users_kind_fixed_ck';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.users_kind_fixed() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS users_kind_fixed ON admin.users;
--> statement-breakpoint
CREATE TRIGGER users_kind_fixed BEFORE UPDATE OF kind, external_org_id ON admin.users
  FOR EACH ROW EXECUTE FUNCTION admin.users_kind_fixed();
--> statement-breakpoint
-- User ngoài không vào Group (Group mở gói/agent/quyền nội bộ). SECURITY DEFINER: đọc users không phụ thuộc RLS người gọi.
CREATE OR REPLACE FUNCTION admin.group_members_internal_only() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM admin.users u WHERE u.id = NEW.user_id AND u.kind = 'external') THEN
    RAISE EXCEPTION 'group_members: user ngoài không vào group' USING ERRCODE = '23514',
      CONSTRAINT = 'group_members_internal_ck';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.group_members_internal_only() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS group_members_internal_only ON admin.group_members;
--> statement-breakpoint
CREATE TRIGGER group_members_internal_only BEFORE INSERT OR UPDATE OF user_id ON admin.group_members
  FOR EACH ROW EXECUTE FUNCTION admin.group_members_internal_only();
