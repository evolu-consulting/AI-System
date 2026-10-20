-- niti-onboard · docs/specs/niti-onboard: hồ sơ công ty của tenant (tên pháp lý, địa chỉ, MST, liên hệ) + cây phòng ban (M1 phẳng ⇒
-- thêm cha + thứ tự). Chỉ cộng thêm, không đổi hành vi cũ: `profile` mặc định `{}`; `parent_group_id`/`sort_order` null.
ALTER TABLE admin.tenants ADD COLUMN IF NOT EXISTS profile jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE admin.tenants ADD CONSTRAINT tenants_profile_check
  CHECK (jsonb_typeof(profile) = 'object' AND pg_column_size(profile) <= 8192);
--> statement-breakpoint
ALTER TABLE admin.departments ADD COLUMN IF NOT EXISTS parent_group_id uuid;
--> statement-breakpoint
ALTER TABLE admin.departments ADD COLUMN IF NOT EXISTS sort_order integer;
--> statement-breakpoint
-- Cha cùng tenant (FK kép như departments_group_fk); xoá Group cha ⇒ con lên gốc.
ALTER TABLE admin.departments ADD CONSTRAINT departments_parent_fk FOREIGN KEY (tenant_id, parent_group_id)
  REFERENCES admin.groups (tenant_id, id) ON DELETE SET NULL (parent_group_id);
--> statement-breakpoint
ALTER TABLE admin.departments ADD CONSTRAINT departments_parent_ck CHECK (parent_group_id <> group_id);
--> statement-breakpoint
ALTER TABLE admin.departments ADD CONSTRAINT departments_sort_ck CHECK (sort_order BETWEEN 0 AND 10000);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS departments_parent_idx ON admin.departments (tenant_id, parent_group_id)
  WHERE parent_group_id IS NOT NULL;
