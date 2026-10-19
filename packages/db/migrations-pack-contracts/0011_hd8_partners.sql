-- HD8-FR-01…08 · HD8-NFR-01 · HD8 tasks.md §Dữ liệu: điểm uy tín đối tác + báo giá hàng hoá + nối khách CKS ↔ đối tác.
-- Port `mgmt-app/api/app/scoring/{config,service}.py` (cấu hình theo vai, lịch sử, ảnh chụp điểm) + `prices/compare.py` (báo giá).
-- Điểm KHÔNG lưu sẵn (tính khi đọc như mgmt); chỉ lưu cấu hình, lịch sử đổi cấu hình, ảnh chụp điểm khi lưu cấu hình.
-- Đối tác = `party_key` (D7-04: `tax:<MST>` | `name:<fold(tên)>`), không có bảng công ty. Chỉ cộng thêm; chạy lại vô hại.
--
-- D8-07 · tên người ghi trên sổ (mgmt hiện email): SECURITY DEFINER chỉ đọc `admin.users` của CHÍNH tenant phiên (`app.tenant_id`),
-- trả tên hiển thị — như M1 `org_owner_ids()`. Người khác tenant / không có ⇒ null.
CREATE OR REPLACE FUNCTION contracts.user_label(u uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(nullif(x.display_name, ''), x.username) FROM admin.users x
  WHERE x.id = u AND x.tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.user_label(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.user_label(uuid) TO contracts_rw;
--> statement-breakpoint
-- D9-03 → HD8-FR-07: khách CKS nối đối tác bằng cùng khoá `party_key` (chỉ thêm cột, D9-03). Cột sinh ⇒ không lệch được.
ALTER TABLE contracts.cks_customers
  ADD COLUMN IF NOT EXISTS party_key text GENERATED ALWAYS AS (contracts.party_key(name, tax_id)) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_customers_party_idx ON contracts.cks_customers (tenant_id, party_key);
--> statement-breakpoint
-- HD8-FR-03 · `score_configs` của mgmt (doc id `{org}:{role}`): một hàng mỗi (tenant, vai). Chưa có hàng ⇒ mặc định (`config.default`).
CREATE TABLE IF NOT EXISTS contracts.score_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  role text NOT NULL,
  version int NOT NULL,
  criteria jsonb NOT NULL,
  rules jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT score_configs_pkey PRIMARY KEY (id),
  CONSTRAINT score_configs_role_uq UNIQUE (tenant_id, role),
  CONSTRAINT score_configs_role_ck CHECK (role IN ('customer', 'supplier')),
  CONSTRAINT score_configs_version_ck CHECK (version >= 1),
  CONSTRAINT score_configs_json_ck CHECK (jsonb_typeof(criteria) = 'array' AND jsonb_typeof(rules) = 'object'
    AND octet_length(criteria::text) <= 8192 AND octet_length(rules::text) <= 2048)
);
--> statement-breakpoint
-- `score_config_history`: mỗi lần lưu một dòng (trước/sau + tóm tắt), chỉ thêm.
CREATE TABLE IF NOT EXISTS contracts.score_config_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  role text NOT NULL,
  version int NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  by_user uuid,
  summary text NOT NULL,
  before jsonb NOT NULL,
  after jsonb NOT NULL,
  CONSTRAINT score_config_history_pkey PRIMARY KEY (id),
  CONSTRAINT score_config_history_role_ck CHECK (role IN ('customer', 'supplier')),
  CONSTRAINT score_config_history_text_ck CHECK (char_length(summary) <= 2000
    AND octet_length(before::text) <= 10240 AND octet_length(after::text) <= 10240)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS score_config_history_idx ON contracts.score_config_history (tenant_id, role, version DESC);
--> statement-breakpoint
-- `score_snapshots`: "Lưu & tính lại điểm" chụp điểm mọi đối tác của vai (lịch sử thay đổi điểm), chỉ thêm.
CREATE TABLE IF NOT EXISTS contracts.score_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  party_key text NOT NULL,
  role text NOT NULL,
  config_version int NOT NULL,
  score smallint,
  band text,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT score_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT score_snapshots_role_ck CHECK (role IN ('customer', 'supplier')),
  CONSTRAINT score_snapshots_score_ck CHECK (score BETWEEN 0 AND 100),
  CONSTRAINT score_snapshots_band_ck CHECK (band IN ('good', 'fair', 'watch')),
  CONSTRAINT score_snapshots_text_ck CHECK (char_length(party_key) BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS score_snapshots_party_idx ON contracts.score_snapshots (tenant_id, party_key, role, at);
--> statement-breakpoint
-- HD8-FR-05 · báo giá (`quotes` của mgmt): giá = bigint đồng > 0 … 10¹⁵. `supplier_party_key` tính lúc thêm (khớp đối tác cùng tên
-- khi không MST, `compare.supplier_company`). `source` = website khi có link (chưa kiểm link: D8-10).
CREATE TABLE IF NOT EXISTS contracts.price_quotes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_key text NOT NULL,
  product_name text NOT NULL,
  unit text,
  supplier_name text NOT NULL,
  supplier_tax_id text,
  supplier_party_key text NOT NULL,
  price bigint NOT NULL,
  quoted_at date NOT NULL,
  source text NOT NULL DEFAULT 'quote',
  url text,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT price_quotes_pkey PRIMARY KEY (id),
  CONSTRAINT price_quotes_price_ck CHECK (price BETWEEN 1 AND 1000000000000000),
  CONSTRAINT price_quotes_source_ck CHECK (source IN ('quote', 'website')),
  CONSTRAINT price_quotes_text_ck CHECK (char_length(product_key) BETWEEN 1 AND 600
    AND char_length(product_name) BETWEEN 1 AND 300 AND char_length(unit) <= 40
    AND char_length(supplier_name) BETWEEN 1 AND 200 AND char_length(supplier_tax_id) <= 30
    AND char_length(supplier_party_key) BETWEEN 1 AND 300 AND char_length(url) <= 2000 AND char_length(note) <= 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS price_quotes_product_idx ON contracts.price_quotes (tenant_id, product_key, quoted_at);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'score_configs');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'score_config_history');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'score_snapshots');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'price_quotes');
--> statement-breakpoint
-- Lịch sử + ảnh chụp chỉ thêm; cấu hình không xoá (đổi = UPDATE, có lịch sử); báo giá xoá được (mgmt DELETE /prices/quotes).
REVOKE UPDATE, DELETE ON contracts.score_config_history, contracts.score_snapshots FROM contracts_rw;
--> statement-breakpoint
REVOKE DELETE ON contracts.score_configs FROM contracts_rw;
