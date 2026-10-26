-- CR-097 G1 · GD-FR-01…05 · intake 2026-10-23 R9, R10, R27–R32: thực thể Giao dịch (nháp → đã ghi sổ; mô tả sửa trực tiếp; số liệu
-- = điều chỉnh có lý do, bản cũ giữ; huỷ = ghi thêm sự kiện, không xoá). Chỉ cộng thêm; chạy lại vô hại.
-- Kho: ghi sổ/điều chỉnh/huỷ đi qua ĐÚNG đường `applyDelivery` / đảo kho của V2-B/V2-M (adapters/stock.repo.ts) — dòng sổ kho mang
-- `transaction_id` (cột mới, không `contract_id` ⇒ xoá HĐ V2-M và cutover K2 không đụng kho của giao dịch).
-- Nghĩa vụ: `obligations.transaction_id`, `contract_id` thôi NOT NULL, CHECK đúng một trong hai.
-- Không FK sang `contracts.contracts` (D9-02: bộ test cũ TRUNCATE HĐ không CASCADE); HĐ liên kết phải thấy được khi ghi (policy).
CREATE TABLE IF NOT EXISTS contracts.transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  deal text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  rev int NOT NULL DEFAULT 0,
  occurred_on date NOT NULL,
  due_on date,
  valid_until date,
  partner_name text NOT NULL,
  partner_tax_id text,
  party_key text GENERATED ALWAYS AS (contracts.party_key(partner_name, partner_tax_id)) STORED,
  product_group text,
  rep_cell smallint GENERATED ALWAYS AS (contracts.v2e_cell(deal, product_group)) STORED,
  contract_id uuid,
  note text,
  holder text,
  lot_label text,
  total bigint NOT NULL DEFAULT 0,
  created_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  posted_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  CONSTRAINT transactions_pkey PRIMARY KEY (id),
  CONSTRAINT transactions_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT transactions_deal_ck CHECK (deal IN ('buy', 'sell')),
  CONSTRAINT transactions_status_ck CHECK (status IN ('draft', 'posted', 'cancelled')
    AND (status = 'draft') = (posted_at IS NULL)
    AND (status = 'cancelled') = (cancelled_at IS NOT NULL)
    AND (status = 'cancelled') = (cancel_reason IS NOT NULL)
    AND (status <> 'draft' OR rev = 0)),
  CONSTRAINT transactions_num_ck CHECK (rev BETWEEN 0 AND 9998 AND total BETWEEN 0 AND 1000000000000000),
  CONSTRAINT transactions_group_ck CHECK (product_group IS NULL OR product_group IN ('service', 'goods')),
  CONSTRAINT transactions_text_ck CHECK (char_length(partner_name) BETWEEN 1 AND 300 AND char_length(partner_tax_id) <= 20
    AND char_length(note) <= 2000 AND char_length(holder) <= 200 AND char_length(lot_label) <= 200
    AND char_length(cancel_reason) BETWEEN 1 AND 500)
);
--> statement-breakpoint
-- Danh sách: mới nhất trước (ngày phát sinh, id) — lọc trạng thái/loại đi kèm; HĐ liên kết; đối tác.
CREATE INDEX IF NOT EXISTS transactions_list_idx ON contracts.transactions (tenant_id, occurred_on DESC, id DESC)
  INCLUDE (status, deal);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS transactions_contract_idx ON contracts.transactions (tenant_id, contract_id)
  WHERE contract_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS transactions_party_idx ON contracts.transactions (tenant_id, party_key)
  WHERE party_key IS NOT NULL;
--> statement-breakpoint
-- Dòng hàng theo lần điều chỉnh (`rev`): bản hiện hành = `rev` của giao dịch; bản cũ giữ nguyên (R31). Tiền đồng chưa VAT.
CREATE TABLE IF NOT EXISTS contracts.transaction_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  rev int NOT NULL DEFAULT 0,
  ord smallint NOT NULL,
  name text NOT NULL,
  product_id uuid,
  component_ids uuid[],
  unit text,
  qty numeric(18, 4) NOT NULL,
  unit_price bigint NOT NULL,
  amount bigint NOT NULL,
  CONSTRAINT transaction_lines_pkey PRIMARY KEY (id),
  CONSTRAINT transaction_lines_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT transaction_lines_ord_uq UNIQUE (transaction_id, tenant_id, rev, ord),
  CONSTRAINT transaction_lines_num_ck CHECK (qty > 0 AND qty <= 99999999999999 AND unit_price BETWEEN 0 AND 1000000000000000
    AND amount BETWEEN 0 AND 1000000000000000 AND rev BETWEEN 0 AND 9998 AND ord BETWEEN 0 AND 199),
  CONSTRAINT transaction_lines_text_ck CHECK (char_length(name) BETWEEN 1 AND 300 AND char_length(unit) <= 40),
  CONSTRAINT transaction_lines_components_ck
    CHECK (component_ids IS NULL OR (product_id IS NOT NULL AND cardinality(component_ids) BETWEEN 1 AND 20)),
  CONSTRAINT transaction_lines_tx_fk FOREIGN KEY (transaction_id, tenant_id)
    REFERENCES contracts.transactions (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT transaction_lines_product_fk FOREIGN KEY (product_id, tenant_id)
    REFERENCES contracts.products (id, tenant_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS transaction_lines_product_idx ON contracts.transaction_lines (tenant_id, product_id)
  WHERE product_id IS NOT NULL;
--> statement-breakpoint
-- Vết: chỉ thêm (huỷ / điều chỉnh = thêm một sự kiện có lý do). Xoá nháp ⇒ CASCADE theo FK.
CREATE TABLE IF NOT EXISTS contracts.transaction_events (
  id bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  type text NOT NULL,
  actor_user_id uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  reason text,
  data jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transaction_events_pkey PRIMARY KEY (id),
  CONSTRAINT transaction_events_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT transaction_events_type_ck CHECK (type IN ('created', 'edited', 'posted', 'described', 'adjusted', 'cancelled')),
  CONSTRAINT transaction_events_reason_ck CHECK (char_length(reason) BETWEEN 1 AND 500
    AND (type NOT IN ('adjusted', 'cancelled') OR reason IS NOT NULL)),
  CONSTRAINT transaction_events_data_ck CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 16384),
  CONSTRAINT transaction_events_tx_fk FOREIGN KEY (transaction_id, tenant_id)
    REFERENCES contracts.transactions (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS transaction_events_tx_idx ON contracts.transaction_events (tenant_id, transaction_id, id);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'transactions');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'transaction_lines');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'transaction_events');
--> statement-breakpoint
-- Thấy (M1, như `stock_moves`/`cks_lots`): thấy hết · mình tạo · HĐ liên kết thấy được. Ghi: `created_by` = chính phiên; HĐ liên kết
-- phải thấy được. Xoá: chỉ nháp (R28). Dòng/sự kiện theo giao dịch thấy được.
DROP POLICY IF EXISTS transactions_visible ON contracts.transactions;
--> statement-breakpoint
CREATE POLICY transactions_visible ON contracts.transactions AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR (contract_id IS NOT NULL AND EXISTS (SELECT 1 FROM contracts.contracts c
      WHERE c.id = transactions.contract_id AND c.tenant_id = transactions.tenant_id)));
--> statement-breakpoint
DROP POLICY IF EXISTS transactions_visible_ins ON contracts.transactions;
--> statement-breakpoint
CREATE POLICY transactions_visible_ins ON contracts.transactions AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK (created_by IS NOT DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (contract_id IS NULL OR EXISTS (SELECT 1 FROM contracts.contracts c
      WHERE c.id = transactions.contract_id AND c.tenant_id = transactions.tenant_id)));
--> statement-breakpoint
DROP POLICY IF EXISTS transactions_link_upd ON contracts.transactions;
--> statement-breakpoint
CREATE POLICY transactions_link_upd ON contracts.transactions AS RESTRICTIVE FOR UPDATE TO contracts_rw
  USING (true)
  WITH CHECK (contract_id IS NULL OR EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = transactions.contract_id AND c.tenant_id = transactions.tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS transactions_draft_del ON contracts.transactions;
--> statement-breakpoint
CREATE POLICY transactions_draft_del ON contracts.transactions AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (status = 'draft');
--> statement-breakpoint
DROP POLICY IF EXISTS transaction_lines_visible ON contracts.transaction_lines;
--> statement-breakpoint
CREATE POLICY transaction_lines_visible ON contracts.transaction_lines AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING (EXISTS (SELECT 1 FROM contracts.transactions x
    WHERE x.id = transaction_lines.transaction_id AND x.tenant_id = transaction_lines.tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS transaction_lines_visible_ins ON contracts.transaction_lines;
--> statement-breakpoint
CREATE POLICY transaction_lines_visible_ins ON contracts.transaction_lines AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK (EXISTS (SELECT 1 FROM contracts.transactions x
    WHERE x.id = transaction_lines.transaction_id AND x.tenant_id = transaction_lines.tenant_id AND x.status <> 'cancelled'));
--> statement-breakpoint
-- Dòng chỉ xoá khi giao dịch còn nháp (sửa nháp = thay dòng); dòng đã ghi sổ giữ nguyên.
DROP POLICY IF EXISTS transaction_lines_draft_del ON contracts.transaction_lines;
--> statement-breakpoint
CREATE POLICY transaction_lines_draft_del ON contracts.transaction_lines AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING (EXISTS (SELECT 1 FROM contracts.transactions x
    WHERE x.id = transaction_lines.transaction_id AND x.tenant_id = transaction_lines.tenant_id AND x.status = 'draft'));
--> statement-breakpoint
DROP POLICY IF EXISTS transaction_events_visible ON contracts.transaction_events;
--> statement-breakpoint
CREATE POLICY transaction_events_visible ON contracts.transaction_events AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING (EXISTS (SELECT 1 FROM contracts.transactions x
    WHERE x.id = transaction_events.transaction_id AND x.tenant_id = transaction_events.tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS transaction_events_visible_ins ON contracts.transaction_events;
--> statement-breakpoint
CREATE POLICY transaction_events_visible_ins ON contracts.transaction_events AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK (actor_user_id IS NOT DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM contracts.transactions x
      WHERE x.id = transaction_events.transaction_id AND x.tenant_id = transaction_events.tenant_id));
--> statement-breakpoint
REVOKE UPDATE ON contracts.transaction_lines FROM contracts_rw;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON contracts.transaction_events FROM contracts_rw;
--> statement-breakpoint
-- Giao dịch không sửa id/tenant/người tạo; `party_key`/`rep_cell` sinh tự động.
REVOKE UPDATE ON contracts.transactions FROM contracts_rw;
--> statement-breakpoint
GRANT UPDATE (status, rev, occurred_on, due_on, valid_until, partner_name, partner_tax_id, product_group, contract_id, note,
  holder, lot_label, total, updated_at, posted_at, posted_by, cancelled_at, cancelled_by, cancel_reason)
  ON contracts.transactions TO contracts_rw;
--> statement-breakpoint
-- GD-FR-03/04/05 lưới an toàn mức hàng (đồng bộ `transactions.rules.ts`): nháp ⇒ sửa tự do / ghi sổ; đã ghi sổ ⇒ bên, loại, HĐ, mốc ghi
-- sổ cố định; số liệu (ngày, hạn, nhóm, tổng) chỉ đổi cùng `rev + 1` (điều chỉnh); chỉ sang huỷ; đã huỷ ⇒ chỉ đọc. Sai ⇒ `EG409`.
CREATE OR REPLACE FUNCTION contracts.g1_transactions_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'TRANSACTION_STATE' USING ERRCODE = 'EG409';
  END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.status NOT IN ('draft', 'posted') THEN
      RAISE EXCEPTION 'TRANSACTION_STATE' USING ERRCODE = 'EG409';
    END IF;
  ELSIF NEW.status NOT IN ('posted', 'cancelled') OR NEW.rev NOT IN (OLD.rev, OLD.rev + 1)
    OR (NEW.deal, NEW.partner_name, NEW.partner_tax_id, NEW.contract_id, NEW.posted_at, NEW.posted_by)
      IS DISTINCT FROM (OLD.deal, OLD.partner_name, OLD.partner_tax_id, OLD.contract_id, OLD.posted_at, OLD.posted_by)
    OR (NEW.rev = OLD.rev AND (NEW.occurred_on, NEW.due_on, NEW.valid_until, NEW.product_group, NEW.total)
      IS DISTINCT FROM (OLD.occurred_on, OLD.due_on, OLD.valid_until, OLD.product_group, OLD.total)) THEN
    RAISE EXCEPTION 'TRANSACTION_STATE' USING ERRCODE = 'EG409';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.g1_transactions_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.g1_transactions_guard() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS transactions_g1_guard ON contracts.transactions;
--> statement-breakpoint
CREATE TRIGGER transactions_g1_guard BEFORE UPDATE ON contracts.transactions
  FOR EACH ROW EXECUTE FUNCTION contracts.g1_transactions_guard();
--> statement-breakpoint
-- Kho: dòng sổ của giao dịch (ghi sổ `delivery`, đảo `reversal`) — tra đảo theo giao dịch qua index một phần.
ALTER TABLE contracts.stock_moves ADD COLUMN IF NOT EXISTS transaction_id uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_moves_transaction_idx ON contracts.stock_moves (tenant_id, transaction_id)
  WHERE transaction_id IS NOT NULL;
--> statement-breakpoint
-- R10 · nghĩa vụ gắn HĐ HOẶC giao dịch (đúng một). Hàng cũ đều có `contract_id` ⇒ CHECK hợp lệ ngay.
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS transaction_id uuid;
--> statement-breakpoint
ALTER TABLE contracts.obligations ALTER COLUMN contract_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE contracts.obligations DROP CONSTRAINT IF EXISTS obligations_parent_ck;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD CONSTRAINT obligations_parent_ck
  CHECK ((contract_id IS NULL) <> (transaction_id IS NULL));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS obligations_transaction_idx ON contracts.obligations (tenant_id, transaction_id)
  WHERE transaction_id IS NOT NULL;
--> statement-breakpoint
DROP POLICY IF EXISTS obligations_visible ON contracts.obligations;
--> statement-breakpoint
CREATE POLICY obligations_visible ON contracts.obligations AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR (contract_id IS NOT NULL AND EXISTS (SELECT 1 FROM contracts.contracts c
      WHERE c.id = obligations.contract_id AND c.tenant_id = obligations.tenant_id))
    OR (transaction_id IS NOT NULL AND EXISTS (SELECT 1 FROM contracts.transactions x
      WHERE x.id = obligations.transaction_id AND x.tenant_id = obligations.tenant_id)));
--> statement-breakpoint
-- Ô uy tín của nghĩa vụ giao dịch = ô của giao dịch (loại × nhóm SP), như nghĩa vụ HĐ lấy ô của HĐ (0028).
CREATE OR REPLACE FUNCTION contracts.v2e_obligation_cell() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.contract_id IS NULL THEN
    NEW.rep_cell := (SELECT x.rep_cell FROM contracts.transactions x
      WHERE x.tenant_id = NEW.tenant_id AND x.id = NEW.transaction_id);
  ELSE
    NEW.rep_cell := (SELECT c.rep_cell FROM contracts.contracts c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.contract_id);
  END IF;
  RETURN NEW;
END $$;
