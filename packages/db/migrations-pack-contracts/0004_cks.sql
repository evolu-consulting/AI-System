-- HD-FR-91…96 · HD9 plan §2 · D9-01 · D9-02: chữ ký số (CKS) trong gói `contracts` — khách, lô mua, chữ ký, gia hạn, lịch nhắc,
-- văn bản đã ký, giá thị trường, nhật ký giá. FK kép `(x_id, tenant_id)` chỉ giữa các bảng `cks_*`; cột trỏ `contracts.contracts`
-- KHÔNG có FK (D9-02: test HD1/HD2 TRUNCATE contracts không CASCADE; HĐ không xoá được — D-08). Tiền = bigint đồng (BR-1).
-- Chỉ cộng thêm; app không xoá hàng CKS (REVOKE DELETE), nhật ký giá chỉ thêm (BR-2).
CREATE TABLE IF NOT EXISTS contracts.cks_customers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  tax_id text,
  name_key text GENERATED ALWAYS AS (contracts.fold(name)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cks_customers_pkey PRIMARY KEY (id),
  CONSTRAINT cks_customers_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT cks_customers_name_ck CHECK (char_length(name) BETWEEN 1 AND 200),
  CONSTRAINT cks_customers_tax_ck CHECK (tax_id ~ '^[0-9A-Za-z-]{1,30}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS cks_customers_tax_uq ON contracts.cks_customers (tenant_id, tax_id)
  WHERE tax_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS cks_customers_name_uq ON contracts.cks_customers (tenant_id, name_key)
  WHERE tax_id IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.cks_lots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  label text NOT NULL,
  ca text NOT NULL,
  qty int NOT NULL,
  unit_cost bigint NOT NULL,
  years smallint NOT NULL DEFAULT 1,
  device text NOT NULL DEFAULT 'token',
  bought_at date NOT NULL,
  purchase_contract_id uuid NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cks_lots_pkey PRIMARY KEY (id),
  CONSTRAINT cks_lots_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT cks_lots_text_ck CHECK (char_length(label) BETWEEN 1 AND 40 AND char_length(ca) BETWEEN 1 AND 60),
  CONSTRAINT cks_lots_qty_ck CHECK (qty BETWEEN 1 AND 100000),
  CONSTRAINT cks_lots_cost_ck CHECK (unit_cost BETWEEN 0 AND 10000000000),
  CONSTRAINT cks_lots_years_ck CHECK (years BETWEEN 1 AND 5),
  CONSTRAINT cks_lots_device_ck CHECK (device IN ('token', 'remote'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_lots_bought_idx ON contracts.cks_lots (tenant_id, bought_at, id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.cks_certificates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  serial text,
  serial_key text,
  ca text NOT NULL,
  device text NOT NULL DEFAULT 'token',
  holder_name text NOT NULL,
  holder_title text,
  keeper text,
  valid_from date,
  valid_to date NOT NULL,
  source text NOT NULL,
  lot_id uuid,
  sale_contract_id uuid,
  sale_price bigint,
  status text NOT NULL DEFAULT 'active',
  replaces uuid,
  replaced_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cks_certificates_pkey PRIMARY KEY (id),
  CONSTRAINT cks_certificates_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT cks_certificates_text_ck CHECK (char_length(serial) <= 100 AND char_length(serial_key) <= 100
    AND char_length(ca) BETWEEN 1 AND 60 AND char_length(holder_name) BETWEEN 1 AND 200
    AND char_length(holder_title) <= 200 AND char_length(keeper) <= 200),
  CONSTRAINT cks_certificates_device_ck CHECK (device IN ('token', 'remote')),
  CONSTRAINT cks_certificates_source_ck CHECK (source IN ('ours', 'elsewhere')),
  CONSTRAINT cks_certificates_status_ck CHECK (status IN ('active', 'pending_renewal', 'replaced', 'revoked')),
  CONSTRAINT cks_certificates_price_ck CHECK (sale_price BETWEEN 0 AND 10000000000),
  CONSTRAINT cks_certificates_customer_fk FOREIGN KEY (customer_id, tenant_id)
    REFERENCES contracts.cks_customers (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT cks_certificates_lot_fk FOREIGN KEY (lot_id, tenant_id)
    REFERENCES contracts.cks_lots (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT cks_certificates_replaces_fk FOREIGN KEY (replaces, tenant_id)
    REFERENCES contracts.cks_certificates (id, tenant_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS cks_certificates_serial_uq ON contracts.cks_certificates (tenant_id, serial_key)
  WHERE serial_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_certificates_customer_idx ON contracts.cks_certificates (tenant_id, customer_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_certificates_lot_idx ON contracts.cks_certificates (tenant_id, lot_id)
  WHERE lot_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_certificates_sale_idx ON contracts.cks_certificates (tenant_id, sale_contract_id)
  WHERE sale_contract_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_certificates_replaces_idx ON contracts.cks_certificates (replaces, tenant_id)
  WHERE replaces IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.cks_renewals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sale_contract_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  certificate_ids uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'open',
  new_contract_id uuid NOT NULL,
  price_each bigint NOT NULL,
  valid_to date NOT NULL,
  lost_reason text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at date,
  CONSTRAINT cks_renewals_pkey PRIMARY KEY (id),
  CONSTRAINT cks_renewals_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT cks_renewals_status_ck CHECK (status IN ('open', 'done', 'lost')),
  CONSTRAINT cks_renewals_price_ck CHECK (price_each BETWEEN 0 AND 10000000000),
  CONSTRAINT cks_renewals_certs_ck CHECK (cardinality(certificate_ids) BETWEEN 1 AND 500),
  CONSTRAINT cks_renewals_reason_ck CHECK (char_length(lost_reason) <= 500),
  CONSTRAINT cks_renewals_customer_fk FOREIGN KEY (customer_id, tenant_id)
    REFERENCES contracts.cks_customers (id, tenant_id) ON DELETE RESTRICT
);
--> statement-breakpoint
-- BR-8: một lượt gia hạn mở mỗi nhóm.
CREATE UNIQUE INDEX IF NOT EXISTS cks_renewals_open_uq ON contracts.cks_renewals (tenant_id, sale_contract_id)
  WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_renewals_sale_idx ON contracts.cks_renewals (tenant_id, sale_contract_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_renewals_customer_idx ON contracts.cks_renewals (customer_id, tenant_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.cks_followups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  customer_id uuid,
  renewal_id uuid,
  due_at timestamptz NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  CONSTRAINT cks_followups_pkey PRIMARY KEY (id),
  CONSTRAINT cks_followups_one_ck CHECK ((customer_id IS NULL) <> (renewal_id IS NULL)),
  CONSTRAINT cks_followups_note_ck CHECK (char_length(note) <= 200),
  CONSTRAINT cks_followups_customer_fk FOREIGN KEY (customer_id, tenant_id)
    REFERENCES contracts.cks_customers (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT cks_followups_renewal_fk FOREIGN KEY (renewal_id, tenant_id)
    REFERENCES contracts.cks_renewals (id, tenant_id) ON DELETE RESTRICT
);
--> statement-breakpoint
-- D9-09: HD4 quét nhắc tới hạn chưa xong.
CREATE INDEX IF NOT EXISTS cks_followups_due_idx ON contracts.cks_followups (tenant_id, due_at) WHERE done_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_followups_renewal_idx ON contracts.cks_followups (renewal_id, tenant_id)
  WHERE renewal_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_followups_customer_idx ON contracts.cks_followups (customer_id, tenant_id)
  WHERE customer_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.cks_signed_docs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid,
  certificate_id uuid,
  serial_key text,
  kind text NOT NULL,
  number text,
  title text NOT NULL,
  signed_at date,
  period text,
  source text NOT NULL,
  filename text NOT NULL,
  sha256 text NOT NULL,
  unsigned boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cks_signed_docs_pkey PRIMARY KEY (id),
  CONSTRAINT cks_signed_docs_kind_ck CHECK (kind IN ('invoice', 'tax_return', 'contract', 'other')),
  CONSTRAINT cks_signed_docs_source_ck CHECK (source IN ('xml', 'pdf')),
  CONSTRAINT cks_signed_docs_sha_ck CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT cks_signed_docs_text_ck CHECK (char_length(title) BETWEEN 1 AND 300 AND char_length(number) <= 100
    AND char_length(period) <= 50 AND char_length(filename) BETWEEN 1 AND 255 AND char_length(serial_key) <= 100),
  CONSTRAINT cks_signed_docs_customer_fk FOREIGN KEY (customer_id, tenant_id)
    REFERENCES contracts.cks_customers (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT cks_signed_docs_cert_fk FOREIGN KEY (certificate_id, tenant_id)
    REFERENCES contracts.cks_certificates (id, tenant_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS cks_signed_docs_once_uq ON contracts.cks_signed_docs
  (tenant_id, sha256, coalesce(serial_key, ''));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_signed_docs_cert_idx ON contracts.cks_signed_docs (certificate_id, tenant_id)
  WHERE certificate_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_signed_docs_customer_idx ON contracts.cks_signed_docs (customer_id, tenant_id)
  WHERE customer_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.cks_market_prices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  ca_key text NOT NULL,
  ca_name text,
  years smallint NOT NULL,
  kind text,
  device text,
  seller text NOT NULL,
  tier text,
  price_ex_vat bigint,
  url text,
  verified boolean NOT NULL DEFAULT false,
  seen date NOT NULL,
  CONSTRAINT cks_market_prices_pkey PRIMARY KEY (id),
  CONSTRAINT cks_market_prices_text_ck CHECK (char_length(ca_key) BETWEEN 1 AND 40 AND char_length(ca_name) <= 100
    AND char_length(seller) BETWEEN 1 AND 200 AND char_length(tier) <= 100 AND char_length(url) <= 2000),
  CONSTRAINT cks_market_prices_years_ck CHECK (years BETWEEN 1 AND 5),
  CONSTRAINT cks_market_prices_kind_ck CHECK (kind IN ('new', 'renew')),
  CONSTRAINT cks_market_prices_device_ck CHECK (device IN ('token', 'remote')),
  CONSTRAINT cks_market_prices_price_ck CHECK (price_ex_vat BETWEEN 0 AND 10000000000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_market_prices_pkg_idx ON contracts.cks_market_prices (tenant_id, ca_key, years);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.cks_price_audit (
  id bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  entity text NOT NULL,
  entity_id uuid NOT NULL,
  field text NOT NULL,
  old_value bigint,
  new_value bigint,
  actor_user_id uuid NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cks_price_audit_pkey PRIMARY KEY (id),
  CONSTRAINT cks_price_audit_entity_ck CHECK (entity IN ('lot', 'sale', 'renewal', 'certificate')),
  CONSTRAINT cks_price_audit_field_ck CHECK (field IN ('unit_cost', 'price_each', 'sale_price'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_price_audit_entity_idx ON contracts.cks_price_audit (tenant_id, entity_id);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'cks_customers');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'cks_lots');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'cks_certificates');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'cks_renewals');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'cks_followups');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'cks_signed_docs');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'cks_market_prices');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'cks_price_audit');
--> statement-breakpoint
REVOKE DELETE ON contracts.cks_customers, contracts.cks_lots, contracts.cks_certificates, contracts.cks_renewals,
  contracts.cks_followups, contracts.cks_signed_docs, contracts.cks_market_prices, contracts.cks_price_audit
  FROM contracts_rw;
--> statement-breakpoint
REVOKE UPDATE ON contracts.cks_price_audit, contracts.cks_lots FROM contracts_rw;
