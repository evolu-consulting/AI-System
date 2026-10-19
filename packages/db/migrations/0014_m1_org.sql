-- M1D-FR-02 · M1D-FR-03 · docs/specs/M1-departments: cơ cấu tổ chức dùng chung cho mọi gói. Migration custom (không khai Drizzle):
-- `user_managers` (một quản lý mỗi user, như `manager_email` của mgmt-app), `user_reports` (closure chặt depth ≥ 1, trigger duy trì
-- theo tập), `departments` (Group ⇒ phòng ban + trưởng phòng; thành viên = `group_members`). Không đổi bảng cũ. Chỉ cộng thêm.
CREATE TABLE IF NOT EXISTS admin.user_managers (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  manager_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT user_managers_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_managers_self_ck CHECK (user_id <> manager_id),
  CONSTRAINT user_managers_user_fk FOREIGN KEY (tenant_id, user_id)
    REFERENCES admin.users (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT user_managers_manager_fk FOREIGN KEY (tenant_id, manager_id)
    REFERENCES admin.users (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT user_managers_by_fk FOREIGN KEY (updated_by) REFERENCES admin.users (id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_managers_manager_idx ON admin.user_managers (tenant_id, manager_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS admin.user_reports (
  tenant_id uuid NOT NULL,
  manager_id uuid NOT NULL,
  user_id uuid NOT NULL,
  depth smallint NOT NULL,
  CONSTRAINT user_reports_pkey PRIMARY KEY (tenant_id, manager_id, user_id),
  CONSTRAINT user_reports_depth_ck CHECK (depth >= 1 AND manager_id <> user_id),
  CONSTRAINT user_reports_manager_fk FOREIGN KEY (tenant_id, manager_id)
    REFERENCES admin.users (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT user_reports_user_fk FOREIGN KEY (tenant_id, user_id)
    REFERENCES admin.users (tenant_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_reports_user_idx ON admin.user_reports (tenant_id, user_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS admin.departments (
  tenant_id uuid NOT NULL,
  group_id uuid NOT NULL,
  head_user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT departments_pkey PRIMARY KEY (group_id),
  CONSTRAINT departments_group_fk FOREIGN KEY (tenant_id, group_id)
    REFERENCES admin.groups (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT departments_head_fk FOREIGN KEY (tenant_id, head_user_id)
    REFERENCES admin.users (tenant_id, id) ON DELETE SET NULL (head_user_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS departments_head_idx ON admin.departments (tenant_id, head_user_id)
  WHERE head_user_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE admin.user_managers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE admin.user_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE admin.departments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_managers_admin_rw ON admin.user_managers FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY departments_admin_rw ON admin.departments FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
-- Closure chỉ do trigger ghi (SECURITY DEFINER); app chỉ đọc.
CREATE POLICY user_reports_admin_ro ON admin.user_reports FOR SELECT TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON admin.user_reports FROM admin_rw;
--> statement-breakpoint
CREATE POLICY user_managers_hub_ro ON admin.user_managers FOR SELECT TO hub_ro USING (true);
--> statement-breakpoint
CREATE POLICY user_reports_hub_ro ON admin.user_reports FOR SELECT TO hub_ro USING (true);
--> statement-breakpoint
CREATE POLICY departments_hub_ro ON admin.departments FOR SELECT TO hub_ro USING (true);
--> statement-breakpoint
-- Cấm vòng (orgs._check_manager): quản lý mới không được là chính mình hay cấp dưới (mọi tầng) của user. Khoá advisory theo
-- tenant tuần tự hoá mọi đổi chuỗi quản lý của tenant (hai lệnh đồng thời A→B, B→A không cùng lọt); READ COMMITTED: câu sau khoá
-- thấy closure đã commit của lệnh trước.
CREATE OR REPLACE FUNCTION admin.user_managers_check() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('admin.user_managers:' || NEW.tenant_id::text, 0));
  IF TG_OP = 'UPDATE' AND (NEW.user_id <> OLD.user_id OR NEW.tenant_id <> OLD.tenant_id) THEN
    RAISE EXCEPTION 'user_managers: không đổi user/tenant' USING ERRCODE = '23514',
      CONSTRAINT = 'user_managers_user_fixed_ck';
  END IF;
  IF NEW.manager_id = NEW.user_id OR EXISTS (SELECT 1 FROM admin.user_reports r
      WHERE r.tenant_id = NEW.tenant_id AND r.manager_id = NEW.user_id AND r.user_id = NEW.manager_id) THEN
    RAISE EXCEPTION 'user_managers: vòng quản lý' USING ERRCODE = '23514', CONSTRAINT = 'user_managers_cycle_ck';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Duy trì closure theo tập (2 câu, không đệ quy): bỏ (tổ tiên cũ × cây con ∪ user) rồi thêm (quản lý mới ∪ tổ tiên của họ) ×
-- (user ∪ cây con), depth cộng dồn. Cây (một quản lý mỗi user) ⇒ mỗi cặp một đường duy nhất.
CREATE OR REPLACE FUNCTION admin.user_managers_closure() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('admin.user_managers:' || OLD.tenant_id::text, 0));
    DELETE FROM admin.user_reports r
      WHERE r.tenant_id = OLD.tenant_id
        AND r.manager_id IN (SELECT a.manager_id FROM admin.user_reports a
                             WHERE a.tenant_id = OLD.tenant_id AND a.user_id = OLD.user_id)
        AND (r.user_id = OLD.user_id OR r.user_id IN (SELECT d.user_id FROM admin.user_reports d
                                                      WHERE d.tenant_id = OLD.tenant_id AND d.manager_id = OLD.user_id));
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO admin.user_reports (tenant_id, manager_id, user_id, depth)
    SELECT NEW.tenant_id, a.mid, d.uid, (a.dep + d.dep + 1)::smallint
    FROM (SELECT NEW.manager_id AS mid, 0 AS dep
          UNION ALL SELECT r.manager_id, r.depth FROM admin.user_reports r
          WHERE r.tenant_id = NEW.tenant_id AND r.user_id = NEW.manager_id) a
    CROSS JOIN (SELECT NEW.user_id AS uid, 0 AS dep
          UNION ALL SELECT r.user_id, r.depth FROM admin.user_reports r
          WHERE r.tenant_id = NEW.tenant_id AND r.manager_id = NEW.user_id) d
    ON CONFLICT (tenant_id, manager_id, user_id) DO UPDATE SET depth = excluded.depth;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.user_managers_check(), admin.user_managers_closure() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS user_managers_check ON admin.user_managers;
--> statement-breakpoint
CREATE TRIGGER user_managers_check BEFORE INSERT OR UPDATE ON admin.user_managers
  FOR EACH ROW EXECUTE FUNCTION admin.user_managers_check();
--> statement-breakpoint
DROP TRIGGER IF EXISTS user_managers_closure ON admin.user_managers;
--> statement-breakpoint
CREATE TRIGGER user_managers_closure AFTER INSERT OR UPDATE OR DELETE ON admin.user_managers
  FOR EACH ROW EXECUTE FUNCTION admin.user_managers_closure();
