-- CR-102a · com-c2-ext-deny (TB-1): lớp chặn cuối ở DB — user ngoài (đối tác) không làm quản lý / được quản lý
-- (`user_managers`, cả `user_id` lẫn `manager_id`) và không làm trưởng phòng (`departments.head_user_id`). API trả 422
-- `EXTERNAL_USER_NOT_ALLOWED` trước; trigger chỉ là lưới an toàn (import, SQL tay). SECURITY DEFINER: đọc users không
-- phụ thuộc RLS người gọi (như `group_members_internal_only` của 0028).
CREATE OR REPLACE FUNCTION admin.user_managers_internal_only() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM admin.users u
             WHERE u.id IN (NEW.user_id, NEW.manager_id) AND u.kind = 'external') THEN
    RAISE EXCEPTION 'user_managers: user ngoài không vào cây quản lý' USING ERRCODE = '23514',
      CONSTRAINT = 'user_managers_internal_ck';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.user_managers_internal_only() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS user_managers_internal_only ON admin.user_managers;
--> statement-breakpoint
CREATE TRIGGER user_managers_internal_only BEFORE INSERT OR UPDATE OF user_id, manager_id ON admin.user_managers
  FOR EACH ROW EXECUTE FUNCTION admin.user_managers_internal_only();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION admin.departments_head_internal_only() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.head_user_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM admin.users u WHERE u.id = NEW.head_user_id AND u.kind = 'external') THEN
    RAISE EXCEPTION 'departments: user ngoài không làm trưởng phòng' USING ERRCODE = '23514',
      CONSTRAINT = 'departments_head_internal_ck';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin.departments_head_internal_only() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS departments_head_internal_only ON admin.departments;
--> statement-breakpoint
CREATE TRIGGER departments_head_internal_only BEFORE INSERT OR UPDATE OF head_user_id ON admin.departments
  FOR EACH ROW EXECUTE FUNCTION admin.departments_head_internal_only();
