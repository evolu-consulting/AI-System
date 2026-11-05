-- CR-121 · cr121-c2-tenant-profile: hồ sơ công ty NHẬP TAY (tên pháp lý, MST, địa chỉ, quy mô, liên hệ, CEO, Giám đốc).
-- Chỉ thêm cột tuỳ chọn vào `admin.tenants` (RLS/GRANT của bảng áp nguyên: policy FOR ALL theo hàng, không theo cột).
-- CEO/Giám đốc là FK kép (id, user) → users(tenant_id, id): chỉ trỏ được user CÙNG công ty; xoá user ⇒ về NULL.
-- Một nguồn: legal_name/address/tax_code/contact_email/contact_phone trùng vài khoá của `profile` jsonb (niti-onboard 0015)
-- ⇒ backfill MỘT lần từ jsonb vào cột (chỉ khi cột còn trống và giá trị hợp lệ); UI đọc cột, không đọc lại các khoá đó từ jsonb.
ALTER TABLE admin.tenants
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS tax_code text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS staff_size integer,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS ceo_user_id uuid,
  ADD COLUMN IF NOT EXISTS director_user_id uuid;
--> statement-breakpoint
ALTER TABLE admin.tenants
  ADD CONSTRAINT tenants_legal_name_check CHECK (legal_name IS NULL OR char_length(legal_name) BETWEEN 1 AND 256),
  ADD CONSTRAINT tenants_tax_code_check CHECK (tax_code IS NULL OR tax_code ~ '^[0-9]{10}(-[0-9]{3})?$'),
  ADD CONSTRAINT tenants_address_check CHECK (address IS NULL OR char_length(address) BETWEEN 1 AND 512),
  ADD CONSTRAINT tenants_staff_size_check CHECK (staff_size IS NULL OR staff_size BETWEEN 0 AND 1000000),
  ADD CONSTRAINT tenants_contact_name_check CHECK (contact_name IS NULL OR char_length(contact_name) BETWEEN 1 AND 128),
  ADD CONSTRAINT tenants_contact_email_check CHECK (contact_email IS NULL OR char_length(contact_email) BETWEEN 3 AND 254),
  ADD CONSTRAINT tenants_contact_phone_check CHECK (contact_phone IS NULL OR contact_phone ~ '^[0-9 .+()-]{6,24}$');
--> statement-breakpoint
ALTER TABLE admin.tenants
  ADD CONSTRAINT tenants_ceo_fk FOREIGN KEY (id, ceo_user_id)
    REFERENCES admin.users (tenant_id, id) ON DELETE SET NULL (ceo_user_id),
  ADD CONSTRAINT tenants_director_fk FOREIGN KEY (id, director_user_id)
    REFERENCES admin.users (tenant_id, id) ON DELETE SET NULL (director_user_id);
--> statement-breakpoint
UPDATE admin.tenants SET
  legal_name = CASE WHEN legal_name IS NULL AND char_length(profile->>'legal_name') BETWEEN 1 AND 256
                    THEN profile->>'legal_name' ELSE legal_name END,
  address = CASE WHEN address IS NULL AND char_length(profile->>'address') BETWEEN 1 AND 512
                 THEN profile->>'address' ELSE address END,
  tax_code = CASE WHEN tax_code IS NULL AND profile->>'tax_id' ~ '^[0-9]{10}(-[0-9]{3})?$'
                  THEN profile->>'tax_id' ELSE tax_code END,
  contact_email = CASE WHEN contact_email IS NULL AND char_length(profile->>'email') BETWEEN 3 AND 254
                       THEN profile->>'email' ELSE contact_email END,
  contact_phone = CASE WHEN contact_phone IS NULL AND profile->'phones'->0->>'number' ~ '^[0-9 .+()-]{6,24}$'
                       THEN profile->'phones'->0->>'number' ELSE contact_phone END
WHERE profile <> '{}'::jsonb;
