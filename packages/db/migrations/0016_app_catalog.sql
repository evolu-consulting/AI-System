-- app-catalog · docs/specs/app-catalog: danh mục app web do Admin quản lý (switcher + đích SSO). Catalog toàn hệ thống như
-- `features`/`commands` (không RLS tenant; GRANT mặc định 0000: admin_rw ghi — chỉ route platform_admin; hub_ro đọc).
-- Seed 4 app, `url` rỗng: admin-api điền từ env khi khởi động (chỉ hàng còn rỗng) ⇒ deploy không đổi hành vi.
CREATE TABLE IF NOT EXISTS admin.app_catalog (
  key text PRIMARY KEY,
  name jsonb NOT NULL,
  icon text DEFAULT 'app' NOT NULL,
  url text DEFAULT '' NOT NULL,
  audience text DEFAULT 'all' NOT NULL,
  required_feature text,
  sso boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 100 NOT NULL,
  enabled boolean DEFAULT true NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid REFERENCES admin.users(id) ON DELETE SET NULL,
  CONSTRAINT app_catalog_key_check CHECK (key ~ '^[a-z0-9-]{2,32}$'),
  CONSTRAINT app_catalog_name_check CHECK (jsonb_typeof(name) = 'object' AND name ? 'vi'),
  CONSTRAINT app_catalog_icon_check CHECK (icon ~ '^[a-z0-9-]{1,32}$'),
  CONSTRAINT app_catalog_url_check CHECK (url = '' OR url ~ '^https?://[^\s]+$'),
  CONSTRAINT app_catalog_audience_check CHECK (audience IN ('all', 'admin', 'platform')),
  CONSTRAINT app_catalog_feature_check CHECK (required_feature IS NULL OR required_feature ~ '^[a-z0-9-]{2,32}$'),
  CONSTRAINT app_catalog_sort_check CHECK (sort_order BETWEEN 0 AND 10000),
  CONSTRAINT app_catalog_version_check CHECK (version >= 1)
);
--> statement-breakpoint
INSERT INTO admin.app_catalog (key, name, icon, audience, required_feature, sso, sort_order) VALUES
  ('chat', '{"vi": "AI System", "en": "AI System"}', 'sparkles', 'all', NULL, true, 10),
  ('contracts', '{"vi": "Sổ Hợp Tác", "en": "Cooperation Ledger"}', 'file-text', 'all', 'contracts-read', true, 20),
  ('studio', '{"vi": "Studio", "en": "Studio"}', 'wand', 'platform', NULL, false, 30),
  ('admin', '{"vi": "Quản trị", "en": "Admin"}', 'settings', 'admin', NULL, true, 40)
ON CONFLICT (key) DO NOTHING;
