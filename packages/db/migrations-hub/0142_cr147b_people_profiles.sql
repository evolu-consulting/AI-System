-- CR-147b · ý 7–9: hồ sơ người — ảnh đại diện (người dùng tự đổi), ảnh bìa cá nhân (tự đổi), chức vụ (quản trị công ty nhập ở Cơ cấu).
-- MỘT bảng cho cả ba (một người một hàng). Ảnh = data URL PNG/JPG/WebP (cùng khuôn ảnh bìa công ty CR-138): avatar ≤ 2 MB ảnh gốc
-- (≤ 2,8 triệu ký tự; client luôn cắt vuông ~256 px nên thực tế vài chục KB), ảnh bìa ≤ 3 MB (≤ 4,3 triệu ký tự).
-- Không FK sang admin.users (khác schema); tenant/người luôn lấy từ token ở service, DB vẫn chặn bằng RLS bên dưới.
-- RLS: hub_rw ĐỌC mọi hàng cùng tenant (thẻ người, theo lô), GHI chỉ hàng CỦA CHÍNH MÌNH (user_id = app.user_id) — người khác cùng công ty
-- không đổi được avatar/ảnh bìa của mình; scope system (việc nền) ghi mọi hàng. admin_rw (admin-api, scope platform/tenant): chỉ
-- cột `job_title` (GRANT theo cột) — quản trị không đổi được ảnh của người dùng.
CREATE TABLE IF NOT EXISTS hub.people_profiles (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  avatar text,
  cover text,
  job_title text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT people_profiles_pkey PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT people_profiles_avatar_ck CHECK (avatar IS NULL OR (char_length(avatar) <= 2800000 AND avatar ~ '^data:image/(png|jpeg|webp);base64,')),
  CONSTRAINT people_profiles_cover_ck CHECK (cover IS NULL OR (char_length(cover) <= 4300000 AND cover ~ '^data:image/(png|jpeg|webp);base64,')),
  CONSTRAINT people_profiles_title_ck CHECK (job_title IS NULL OR char_length(job_title) BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE hub.people_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT ON hub.people_profiles TO hub_rw;
--> statement-breakpoint
GRANT INSERT (tenant_id, user_id, avatar, cover, updated_at), UPDATE (avatar, cover, updated_at) ON hub.people_profiles TO hub_rw;
--> statement-breakpoint
GRANT SELECT (tenant_id, user_id, job_title), INSERT (tenant_id, user_id, job_title, updated_at),
  UPDATE (job_title, updated_at) ON hub.people_profiles TO admin_rw;
--> statement-breakpoint
CREATE POLICY people_profiles_hub_sel ON hub.people_profiles FOR SELECT TO hub_rw
  USING (current_setting('app.scope', true) = 'system'
    OR (current_setting('app.scope', true) = 'user' AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY people_profiles_hub_ins ON hub.people_profiles FOR INSERT TO hub_rw
  WITH CHECK (current_setting('app.scope', true) = 'system'
    OR (current_setting('app.scope', true) = 'user' AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY people_profiles_hub_upd ON hub.people_profiles FOR UPDATE TO hub_rw
  USING (current_setting('app.scope', true) = 'system'
    OR (current_setting('app.scope', true) = 'user' AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'system'
    OR (current_setting('app.scope', true) = 'user' AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid));
--> statement-breakpoint
CREATE POLICY people_profiles_admin ON hub.people_profiles FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
    OR (current_setting('app.scope', true) = 'tenant' AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
    OR (current_setting('app.scope', true) = 'tenant' AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
