-- price-scout · dò giá thị trường: cấu hình theo SP + mặc định theo nhóm SP, lịch dò (tuần/tháng), bộ đếm lượt dò/token theo
-- ngày lịch tenant, trần tháng của tenant (tenant admin + ghi đè platform), cảnh báo "Giá thị trường thay đổi" (nguồn Cần xử lý).
-- Chỉ cộng thêm; chạy lại vô hại. Mọi bảng RLS FORCE theo tenant (`packs.secure_table`, như các bảng gói khác); quyền sửa ở API
-- (cấu hình SP: contracts-write; mặc định nhóm + trần: contracts-admin; trường platform: platform_admin).
-- Vòng dò theo lịch theo khuôn HD4: role `contracts_job` chỉ đọc (tenant_id, next_at, lease_until) để tìm tenant có SP tới hạn;
-- việc theo tenant chạy trong tx `contracts_rw` + `app.tenant_id` — MỘT câu chọn SP tới hạn `FOR UPDATE SKIP LOCKED` (index
-- `(tenant_id, next_at)` một phần), giới hạn theo số lượt đang chạy của tenant + trần ngày/tháng, rồi đặt lease.
CREATE TABLE IF NOT EXISTS contracts.price_scout_defaults (
  tenant_id uuid NOT NULL,
  grp text NOT NULL,
  cfg jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_scout_defaults_pkey PRIMARY KEY (tenant_id, grp),
  CONSTRAINT price_scout_defaults_grp_ck CHECK (grp IN ('service', 'goods')),
  CONSTRAINT price_scout_defaults_cfg_ck CHECK (jsonb_typeof(cfg) = 'object' AND pg_column_size(cfg) <= 16384)
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'price_scout_defaults');
--> statement-breakpoint
-- `cfg` = ghi đè riêng của SP (khoá vắng = theo mặc định nhóm). `next_at` = lần dò theo lịch kế tiếp (null = không dò theo lịch:
-- tắt / lịch off), tính lại mỗi khi cấu hình SP hoặc mặc định nhóm đổi và sau mỗi lượt dò. `lease_until` = đang dò tới lúc đó.
CREATE TABLE IF NOT EXISTS contracts.price_scout_configs (
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  cfg jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_at timestamptz,
  lease_until timestamptz,
  last_at timestamptz,
  last_status text,
  updated_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_scout_configs_pkey PRIMARY KEY (tenant_id, product_id),
  CONSTRAINT price_scout_configs_cfg_ck CHECK (jsonb_typeof(cfg) = 'object' AND pg_column_size(cfg) <= 16384),
  CONSTRAINT price_scout_configs_status_ck CHECK (last_status IN ('ok', 'empty', 'failed', 'unavailable', 'cap')),
  CONSTRAINT price_scout_configs_product_fk FOREIGN KEY (product_id, tenant_id)
    REFERENCES contracts.products (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS price_scout_configs_due_idx ON contracts.price_scout_configs (tenant_id, next_at)
  WHERE next_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS price_scout_configs_next_idx ON contracts.price_scout_configs (next_at)
  WHERE next_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS price_scout_configs_lease_idx ON contracts.price_scout_configs (tenant_id, lease_until)
  WHERE lease_until IS NOT NULL;
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'price_scout_configs');
--> statement-breakpoint
GRANT SELECT (tenant_id, next_at, lease_until) ON contracts.price_scout_configs TO contracts_job;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'contracts' AND tablename = 'price_scout_configs'
      AND policyname = 'price_scout_configs_job') THEN
    CREATE POLICY price_scout_configs_job ON contracts.price_scout_configs FOR SELECT TO contracts_job
      USING (next_at IS NOT NULL);
  END IF;
END $$;
--> statement-breakpoint
-- Bộ đếm theo ngày lịch tenant: lượt dò bấm tay / theo lịch + token. Tháng = tổng các ngày trong tháng (≤ 31 hàng/tenant).
CREATE TABLE IF NOT EXISTS contracts.price_scout_usage (
  tenant_id uuid NOT NULL,
  day date NOT NULL,
  manual integer NOT NULL DEFAULT 0,
  scheduled integer NOT NULL DEFAULT 0,
  tokens bigint NOT NULL DEFAULT 0,
  CONSTRAINT price_scout_usage_pkey PRIMARY KEY (tenant_id, day),
  CONSTRAINT price_scout_usage_n_ck CHECK (manual >= 0 AND scheduled >= 0 AND tokens >= 0)
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'price_scout_usage');
--> statement-breakpoint
-- Trần tháng: tenant admin đặt `searches_month`/`tokens_month`; platform_admin ghi đè `platform_*` (thắng). null = theo mức dưới.
CREATE TABLE IF NOT EXISTS contracts.price_scout_quota (
  tenant_id uuid NOT NULL,
  searches_month integer,
  tokens_month bigint,
  platform_searches_month integer,
  platform_tokens_month bigint,
  updated_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_scout_quota_pkey PRIMARY KEY (tenant_id),
  CONSTRAINT price_scout_quota_ck CHECK (searches_month >= 0 AND tokens_month >= 0 AND platform_searches_month >= 0
    AND platform_tokens_month >= 0)
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'price_scout_quota');
--> statement-breakpoint
-- Cảnh báo của lượt dò theo lịch ⇒ nguồn "Giá thị trường thay đổi" của Cần xử lý (V2-K; Bỏ qua/Đã xong qua `todo_dismissals`).
CREATE TABLE IF NOT EXISTS contracts.price_scout_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  day date NOT NULL,
  kind text NOT NULL,
  detail text NOT NULL,
  supplier_name text,
  price bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_scout_alerts_pkey PRIMARY KEY (id),
  CONSTRAINT price_scout_alerts_kind_ck CHECK (kind IN ('threshold', 'watched')),
  CONSTRAINT price_scout_alerts_text_ck CHECK (char_length(detail) <= 500 AND char_length(supplier_name) <= 300),
  CONSTRAINT price_scout_alerts_product_fk FOREIGN KEY (product_id, tenant_id)
    REFERENCES contracts.products (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS price_scout_alerts_day_idx ON contracts.price_scout_alerts (tenant_id, day DESC);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'price_scout_alerts');
