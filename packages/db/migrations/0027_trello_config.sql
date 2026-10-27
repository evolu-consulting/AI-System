-- trello-config-ui · cấu hình Trello cho "Góp ý" do platform_admin nhập trong admin-web (thay/đè env `TRELLO_*`).
-- Một hàng (`id = 1`). API key + token mã hoá AES-256-GCM ở admin-api (`sealBytes`, khoá SECRET_MASTER_KEY, AAD
-- `admin.trello_config:<field>:<key_version>`); chỉ lưu thêm 4 ký tự cuối để hiển thị. Không có hàng ⇒ dùng env như cũ.
-- RLS: chỉ scope platform. Hub không cần đọc ⇒ REVOKE hub_ro. Chỉ cộng thêm, không đổi dữ liệu cũ.
CREATE TABLE IF NOT EXISTS admin.trello_config (
  id smallint PRIMARY KEY DEFAULT 1,
  api_key_ct bytea NOT NULL,
  api_key_iv bytea NOT NULL,
  api_key_last4 text NOT NULL,
  token_ct bytea NOT NULL,
  token_iv bytea NOT NULL,
  token_last4 text NOT NULL,
  key_version integer NOT NULL,
  list_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT trello_config_singleton_ck CHECK (id = 1),
  CONSTRAINT trello_config_iv_ck CHECK (octet_length(api_key_iv) = 12 AND octet_length(token_iv) = 12),
  CONSTRAINT trello_config_last4_ck CHECK (char_length(api_key_last4) <= 4 AND char_length(token_last4) <= 4),
  CONSTRAINT trello_config_list_ck CHECK (list_id ~ '^[A-Za-z0-9]{1,64}$')
);
--> statement-breakpoint
ALTER TABLE admin.trello_config ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY trello_config_platform_rw ON admin.trello_config FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform')
  WITH CHECK (current_setting('app.scope', true) = 'platform');
--> statement-breakpoint
REVOKE ALL ON admin.trello_config FROM hub_ro;
--> statement-breakpoint
REVOKE ALL ON admin.trello_config FROM PUBLIC;
