-- HD-FR-01…07 · HD-NFR-04 · HD-AC01/02/04/12/13 · D-04 · D-07 · D-08 · D-14 · D-15 · HD1 plan §3: gói `contracts` — 5 bảng nghiệp vụ
-- (contracts, contract_items, contract_categories, contract_reminders, contract_events) trên khung N1 (`packs.install`: role
-- `contracts_rw`, schema, `files`, `index_outbox`). Mọi FK kép `(x_id, tenant_id)`; không FK sang admin.*/hub.*. 4 hàm IMMUTABLE
-- (bản TS cùng luật: `modules/packs/contracts/domain/fold.rules.ts`) cấp cột sinh STORED cho lọc/sắp (D-07). Chỉ cộng thêm.
SELECT packs.install('contracts');
--> statement-breakpoint
-- fold ≡ foldVi (trừ NFC — chuẩn hoá ở biên, D-18): bỏ dấu tiếng Việt (hoa+thường), A-Z → a-z bằng translate (không dựa
-- lower() ngoài ASCII), gộp khoảng trắng ASCII, cắt hai đầu theo đúng tập khoảng trắng của String.prototype.trim.
CREATE OR REPLACE FUNCTION contracts.fold(x text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog
  RETURN btrim(
    regexp_replace(
      translate(x,
        'àÀáÁảẢãÃạẠăĂằẰắẮẳẲẵẴặẶâÂầẦấẤẩẨẫẪậẬèÈéÉẻẺẽẼẹẸêÊềỀếẾểỂễỄệỆìÌíÍỉỈĩĨịỊòÒóÓỏỎõÕọỌôÔồỒốỐổỔỗỖộỘơƠờỜớỚởỞỡỠợỢùÙúÚủỦũŨụỤưƯừỪứỨửỬữỮựỰỳỲýÝỷỶỹỸỵỴđĐABCDEFGHIJKLMNOPQRSTUVWXYZ',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeeeeeeeeeeiiiiiiiiiioooooooooooooooooooooooooooooooooouuuuuuuuuuuuuuuuuuuuuuyyyyyyyyyyddabcdefghijklmnopqrstuvwxyz'),
      '[ \t\n\r\f\v]+', ' ', 'g'),
    E'  ﻿                　');
--> statement-breakpoint
-- person_key ≡ personKey: fold phần trước dấu tách đầu tiên (' – ', ' - ', ','); rỗng ⇒ null.
CREATE OR REPLACE FUNCTION contracts.person_key(x text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog
  RETURN nullif(contracts.fold(left(x, coalesce(
    least(nullif(strpos(x, ' – '), 0), nullif(strpos(x, ' - '), 0), nullif(strpos(x, ','), 0)) - 1, length(x)))), '');
--> statement-breakpoint
-- as_bigint: chỉ chuỗi số nguyên (≤ 18 chữ số, không khoảng trắng) ⇒ bigint, còn lại null (không ném).
CREATE OR REPLACE FUNCTION contracts.as_bigint(x text) RETURNS bigint
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog
  RETURN CASE WHEN x ~ '^-?[0-9]{1,18}$' THEN x::bigint END;
--> statement-breakpoint
-- as_date ≡ asDate (D-15): 'YYYY-MM-DD', năm ≥ 1, tháng 1…12, ngày ≤ số ngày của tháng (năm nhuận) ⇒ date; ngoài ra null,
-- không ném 22008. CASE lồng: chỉ ép kiểu sau khi regex đã khớp.
CREATE OR REPLACE FUNCTION contracts.as_date(x text) RETURNS date
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE SET search_path = pg_catalog
  RETURN CASE WHEN x ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
    CASE
      WHEN substr(x, 1, 4)::int < 1 THEN NULL
      WHEN substr(x, 9, 2)::int <= CASE substr(x, 6, 2)::int
        WHEN 2 THEN CASE WHEN (substr(x, 1, 4)::int % 4 = 0 AND substr(x, 1, 4)::int % 100 <> 0)
                              OR substr(x, 1, 4)::int % 400 = 0 THEN 29 ELSE 28 END
        WHEN 4 THEN 30 WHEN 6 THEN 30 WHEN 9 THEN 30 WHEN 11 THEN 30 ELSE 31 END
      THEN make_date(substr(x, 1, 4)::int, substr(x, 6, 2)::int, substr(x, 9, 2)::int)
    END
  END;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.fold(text), contracts.person_key(text), contracts.as_bigint(text), contracts.as_date(text)
  FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.fold(text), contracts.person_key(text), contracts.as_bigint(text), contracts.as_date(text)
  TO contracts_rw;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.contract_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_categories_pkey PRIMARY KEY (id),
  CONSTRAINT contract_categories_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT contract_categories_name_ck CHECK (char_length(name) BETWEEN 1 AND 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS contract_categories_name_uq ON contracts.contract_categories (tenant_id, lower(name));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.contracts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'contract',
  parent_id uuid,
  title text NOT NULL,
  direction text,
  status text NOT NULL DEFAULT 'extracting',
  error text,
  owner_user_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1,
  confirmed_at timestamptz,
  confirmed_by uuid,
  fields jsonb NOT NULL DEFAULT '{}',
  file_id uuid,
  source_text text,
  clauses jsonb NOT NULL DEFAULT '[]',
  warnings jsonb NOT NULL DEFAULT '[]',
  action_deadline date,
  handled jsonb,
  run_id uuid,
  -- Cột sinh (D-07, D-14): nguồn duy nhất là `fields`; cột sinh không trỏ cột sinh nên viết lại biểu thức gốc.
  number text GENERATED ALWAYS AS (nullif(btrim(fields -> 'number' ->> 'value'), '')) STORED,
  seller text GENERATED ALWAYS AS (nullif(btrim(fields -> 'supplier_name' ->> 'value'), '')) STORED,
  buyer text GENERATED ALWAYS AS (nullif(btrim(fields -> 'buyer_name' ->> 'value'), '')) STORED,
  seller_signer text GENERATED ALWAYS AS (nullif(btrim(fields -> 'supplier_representative' ->> 'value'), '')) STORED,
  buyer_signer text GENERATED ALWAYS AS (nullif(btrim(fields -> 'buyer_representative' ->> 'value'), '')) STORED,
  type text GENERATED ALWAYS AS (CASE WHEN fields -> 'type' ->> 'value' IN ('purchase', 'service', 'framework', 'principle')
    THEN fields -> 'type' ->> 'value' END) STORED,
  value bigint GENERATED ALWAYS AS (contracts.as_bigint(fields -> 'total_value' ->> 'value')) STORED,
  end_date date GENERATED ALWAYS AS (contracts.as_date(fields -> 'end_date' ->> 'value')) STORED,
  signer_keys text[] GENERATED ALWAYS AS (array_remove(ARRAY[
    contracts.person_key(fields -> 'supplier_representative' ->> 'value'),
    contracts.person_key(fields -> 'buyer_representative' ->> 'value')], NULL)) STORED,
  search_key text GENERATED ALWAYS AS (contracts.fold(
    coalesce(title, '') || ' ' || coalesce(fields -> 'number' ->> 'value', '') || ' '
    || coalesce(fields -> 'supplier_name' ->> 'value', '') || ' ' || coalesce(fields -> 'buyer_name' ->> 'value', '') || ' '
    || coalesce(fields -> 'supplier_representative' ->> 'value', '') || ' '
    || coalesce(fields -> 'buyer_representative' ->> 'value', ''))) STORED,
  CONSTRAINT contracts_pkey PRIMARY KEY (id),
  CONSTRAINT contracts_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT contracts_kind_ck CHECK (kind IN ('contract', 'appendix')),
  CONSTRAINT contracts_parent_ck CHECK ((kind = 'appendix') = (parent_id IS NOT NULL)),
  CONSTRAINT contracts_title_ck CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT contracts_direction_ck CHECK (direction IN ('sale', 'purchase')),
  CONSTRAINT contracts_status_ck CHECK (status IN ('extracting', 'extract_failed', 'needs_review', 'active', 'expiring',
    'expired', 'renewed', 'terminated', 'rejected')),
  CONSTRAINT contracts_error_ck CHECK (char_length(error) <= 2000),
  CONSTRAINT contracts_fields_ck CHECK (jsonb_typeof(fields) = 'object'),
  CONSTRAINT contracts_source_ck CHECK (char_length(source_text) <= 5000000),
  CONSTRAINT contracts_handled_ck CHECK (handled IS NULL
    OR handled ->> 'outcome' IN ('renewed', 'not_renewed', 'negotiating', 'replaced')),
  CONSTRAINT contracts_parent_fk FOREIGN KEY (parent_id, tenant_id)
    REFERENCES contracts.contracts (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT contracts_file_fk FOREIGN KEY (file_id, tenant_id)
    REFERENCES contracts.files (id, tenant_id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contracts_list_idx ON contracts.contracts (tenant_id, updated_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contracts_owner_idx ON contracts.contracts (tenant_id, owner_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contracts_status_idx ON contracts.contracts (tenant_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contracts_parent_idx ON contracts.contracts (parent_id) WHERE parent_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.contract_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  ord smallint NOT NULL,
  code text,
  name text NOT NULL,
  spec text,
  unit text,
  qty numeric(18, 4),
  unit_price bigint,
  vat_rate numeric(5, 2),
  moq numeric(18, 4),
  lead_time_days int,
  valid_from date,
  valid_to date,
  category_id uuid,
  quote text,
  verified boolean NOT NULL DEFAULT false,
  edited boolean NOT NULL DEFAULT false,
  CONSTRAINT contract_items_pkey PRIMARY KEY (id),
  -- Có tenant_id: hàng tenant khác trỏ HĐ lạ phải gặp FK (23503), không gặp UNIQUE (23505 = lộ HĐ tồn tại); cũng là index FK kép.
  CONSTRAINT contract_items_ord_uq UNIQUE (contract_id, tenant_id, ord),
  CONSTRAINT contract_items_ord_ck CHECK (ord BETWEEN 0 AND 9999),
  CONSTRAINT contract_items_text_ck CHECK (char_length(name) BETWEEN 1 AND 500 AND char_length(code) <= 100
    AND char_length(spec) <= 2000 AND char_length(unit) <= 50 AND char_length(quote) <= 2000),
  CONSTRAINT contract_items_vat_ck CHECK (vat_rate BETWEEN 0 AND 100),
  CONSTRAINT contract_items_lead_ck CHECK (lead_time_days BETWEEN 0 AND 3650),
  CONSTRAINT contract_items_contract_fk FOREIGN KEY (contract_id, tenant_id)
    REFERENCES contracts.contracts (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT contract_items_category_fk FOREIGN KEY (category_id, tenant_id)
    REFERENCES contracts.contract_categories (id, tenant_id) ON DELETE SET NULL (category_id)
);
--> statement-breakpoint
-- Semi-join bộ lọc `category[]` (plan §6) + index FK loại hàng.
CREATE INDEX IF NOT EXISTS items_category_idx ON contracts.contract_items (tenant_id, category_id, contract_id)
  WHERE category_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.contract_reminders (
  id bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  deadline date NOT NULL,
  milestone smallint NOT NULL,
  user_id uuid NOT NULL,
  channel text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_reminders_pkey PRIMARY KEY (id),
  -- Khoá idempotency nhắc hạn (HD-AC13): HĐ + hạn + mốc + người; HD4 ghi ON CONFLICT DO NOTHING. tenant_id đứng sau
  -- contract_id (HĐ đã quyết định tenant) để chéo tenant gặp FK chứ không gặp UNIQUE; cũng là index FK kép.
  CONSTRAINT contract_reminders_once_uq UNIQUE (contract_id, tenant_id, deadline, milestone, user_id),
  CONSTRAINT contract_reminders_milestone_ck CHECK (milestone BETWEEN -3650 AND 3650),
  CONSTRAINT contract_reminders_channel_ck CHECK (channel ~ '^[a-z_]{2,20}$'),
  CONSTRAINT contract_reminders_contract_fk FOREIGN KEY (contract_id, tenant_id)
    REFERENCES contracts.contracts (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.contract_events (
  id bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  type text NOT NULL,
  actor_user_id uuid,
  at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT contract_events_pkey PRIMARY KEY (id),
  CONSTRAINT contract_events_type_ck CHECK (type ~ '^[a-z_]{2,40}$'),
  CONSTRAINT contract_events_data_ck CHECK (octet_length(data::text) <= 65536),
  CONSTRAINT contract_events_contract_fk FOREIGN KEY (contract_id, tenant_id)
    REFERENCES contracts.contracts (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contract_events_contract_idx ON contracts.contract_events (contract_id, id DESC);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'contract_categories');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'contracts');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'contract_items');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'contract_reminders');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'contract_events');
--> statement-breakpoint
-- D-08: HD1 không xoá (HD5 cấp lại); nhắc hạn và nhật ký chỉ thêm.
REVOKE DELETE ON contracts.contracts, contracts.contract_items, contracts.contract_categories FROM contracts_rw;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON contracts.contract_reminders, contracts.contract_events FROM contracts_rw;
