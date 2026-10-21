-- feedback · "Góp ý về app" cấp nền tảng (khôi phục tính năng mgmt-app, dùng chung 4 web). `feedback` = một góp ý của user (loại, nội dung,
-- trang/app/phiên bản tự gắn, trạng thái + phản hồi của admin); `feedback_files` = ảnh/tệp đính kèm nhỏ (≤ 2 MB, lưu bytea — admin-api không có FileBox).
-- RLS (admin_rw): platform_admin thấy hết; tenant: chỉ tenant mình, và chỉ góp ý CỦA MÌNH trừ khi app đặt `app.fb_all = '1'` (tenant_admin).
-- `app.user_id` + `app.fb_all` do admin-api đặt trong cùng tx (set_config local) — xem modules/feedback. Chỉ cộng thêm. Không gửi email.
CREATE TABLE IF NOT EXISTS admin.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  app text NOT NULL,
  kind text NOT NULL,
  message text NOT NULL,
  page_url text NOT NULL DEFAULT '',
  app_version text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new',
  reply text,
  replied_at timestamptz,
  replied_by uuid REFERENCES admin.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_user_fk FOREIGN KEY (tenant_id, user_id)
    REFERENCES admin.users (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT feedback_app_ck CHECK (app ~ '^[a-z0-9-]{2,32}$'),
  CONSTRAINT feedback_kind_ck CHECK (kind IN ('bug', 'idea', 'other')),
  CONSTRAINT feedback_status_ck CHECK (status IN ('new', 'in_progress', 'done')),
  CONSTRAINT feedback_message_ck CHECK (char_length(message) BETWEEN 1 AND 4000),
  CONSTRAINT feedback_page_ck CHECK (char_length(page_url) <= 500 AND char_length(app_version) <= 64),
  CONSTRAINT feedback_reply_ck CHECK (reply IS NULL OR char_length(reply) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_user_idx ON admin.feedback (tenant_id, user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_status_idx ON admin.feedback (status, created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS admin.feedback_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id uuid NOT NULL REFERENCES admin.feedback (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  mime text NOT NULL,
  size_bytes integer NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feedback_files_name_ck CHECK (char_length(name) BETWEEN 1 AND 255),
  CONSTRAINT feedback_files_size_ck CHECK (size_bytes BETWEEN 0 AND 2097152)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feedback_files_fb_idx ON admin.feedback_files (feedback_id);
--> statement-breakpoint
ALTER TABLE admin.feedback ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE admin.feedback_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY feedback_admin_rw ON admin.feedback FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND (current_setting('app.fb_all', true) = '1'
                  OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
             AND (current_setting('app.fb_all', true) = '1'
                  OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)));
--> statement-breakpoint
-- Tệp đính kèm đi theo góp ý cha: thấy được khi (qua RLS của `feedback`) thấy cha.
CREATE POLICY feedback_files_admin_rw ON admin.feedback_files FOR ALL TO admin_rw
  USING (EXISTS (SELECT 1 FROM admin.feedback f WHERE f.id = feedback_id))
  WITH CHECK (EXISTS (SELECT 1 FROM admin.feedback f WHERE f.id = feedback_id));
