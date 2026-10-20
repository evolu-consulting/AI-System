-- V2-L · CD-01 · BA v2 §4.5: nhận diện công ty (tên, tên ứng dụng, logo ≤ 1 MB, màu chủ đạo, giao diện) + tên/MST của chính công ty
-- (V2-G cần biết bên nào là mình để đoán Mua/Bán). Một hàng mỗi tenant; vắng hàng ⇒ mặc định trong code. Bảng mới, chỉ cộng thêm,
-- RLS qua `packs.secure_table`; ghi chỉ quản lý (route). Cờ duyệt (V2-A) dùng cột `approval_settings.approval_enabled` sẵn có.
CREATE TABLE IF NOT EXISTS contracts.company_settings (
  tenant_id uuid NOT NULL,
  company_name text,
  app_name text,
  logo text,
  accent text NOT NULL DEFAULT 'indigo',
  theme text NOT NULL DEFAULT 'auto',
  own_names text[] NOT NULL DEFAULT '{}',
  own_tax_ids text[] NOT NULL DEFAULT '{}',
  version int NOT NULL DEFAULT 1,
  updated_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_settings_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT company_settings_name_ck CHECK (char_length(company_name) <= 60 AND char_length(app_name) <= 40),
  CONSTRAINT company_settings_logo_ck CHECK (char_length(logo) <= 1500000 AND (logo IS NULL OR logo LIKE 'data:image/%')),
  CONSTRAINT company_settings_accent_ck CHECK (accent IN ('indigo', 'blue', 'teal', 'green', 'orange', 'rose')),
  CONSTRAINT company_settings_theme_ck CHECK (theme IN ('auto', 'light', 'dark')),
  CONSTRAINT company_settings_own_ck CHECK (cardinality(own_names) <= 10 AND cardinality(own_tax_ids) <= 10)
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'company_settings');
--> statement-breakpoint
REVOKE DELETE ON contracts.company_settings FROM contracts_rw;