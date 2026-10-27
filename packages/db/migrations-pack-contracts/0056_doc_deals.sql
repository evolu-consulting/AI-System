-- CR-101 DOC-deals · Giao dịch hợp nhất vào chứng từ (R1, R5–R10, R37; X1–X3; Câu 1, 3, 4, 7). Chỉ cộng thêm; chạy lại vô hại.
-- Giao dịch = hàng `contracts.contracts` với `doc_type = 'deal'` (kind = contract, file tuỳ chọn, `source` bắt buộc): dùng chung mốc
-- (`obligations`), kho (`stock_moves` theo `contract_id`/`milestone_id`), điểm, xoá V2-M, danh sách. Lưu là có hiệu lực, KHÔNG khoá
-- (K1 bỏ qua deal) ⇒ sửa trực tiếp; máy ghi lịch sử từng trường vào `contract_edit_log` (trigger, mọi đường ghi). Nâng thành HĐ = đổi
-- `doc_type` → `contract` + có file + số HĐ (trigger chặn thiếu) ⇒ K1 khoá ngay trong cùng câu (id/mốc/kho giữ nguyên).
-- Dữ liệu G1 (`transactions*`) chuyển bằng script `tools/scripts/src/migrate-transactions-to-contracts.ts` (giữ id); bảng G1 thành
-- CHỈ ĐỌC (thu quyền ghi + trigger chặn), cột `obligations.transaction_id` / `stock_moves.transaction_id` giữ để đối chiếu.
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS source text;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_deal_source_ck;
--> statement-breakpoint
-- Nguồn: hoá đơn | nói miệng | tin nhắn | báo giá | khác. Giao dịch luôn có nguồn + loại (Mua/Bán/Giới thiệu); nâng thành HĐ giữ nguồn.
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_deal_source_ck CHECK (
  (source IS NULL OR source IN ('invoice', 'verbal', 'message', 'quote', 'other'))
  AND (doc_type <> 'deal' OR (source IS NOT NULL AND deal IS NOT NULL AND kind = 'contract')));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contracts_deal_idx ON contracts.contracts (tenant_id, updated_at DESC, id DESC)
  WHERE doc_type = 'deal' AND superseded_at IS NULL;
--> statement-breakpoint
-- K1: giao dịch không khoá khi lưu (sửa trực tiếp, X2); nâng thành HĐ ⇒ `doc_type` đổi ⇒ trigger này khoá ngay (HĐ khoá như K1).
DROP TRIGGER IF EXISTS contracts_k1_lock ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_k1_lock BEFORE INSERT OR UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (NEW.locked_at IS NULL AND NEW.doc_type <> 'deal'
    AND NEW.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated'))
  EXECUTE FUNCTION contracts.k1_lock_on_confirm();
--> statement-breakpoint
-- R10 · nâng: chỉ sang `contract`, phải có file ký + số HĐ (BEFORE: cột sinh `number` chưa tính ⇒ đọc `fields`). Lỗi `EK422`.
CREATE OR REPLACE FUNCTION contracts.doc_deal_promote_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.doc_type <> 'contract' THEN
    RAISE EXCEPTION 'PROMOTE_INVALID' USING ERRCODE = 'EK422';
  END IF;
  IF NEW.file_id IS NULL THEN
    RAISE EXCEPTION 'PROMOTE_NEEDS_FILE' USING ERRCODE = 'EK422';
  END IF;
  IF nullif(btrim(NEW.fields -> 'number' ->> 'value'), '') IS NULL THEN
    RAISE EXCEPTION 'PROMOTE_NEEDS_NUMBER' USING ERRCODE = 'EK422';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.doc_deal_promote_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.doc_deal_promote_guard() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_doc_deal_promote ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_doc_deal_promote BEFORE UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (OLD.doc_type = 'deal' AND NEW.doc_type <> 'deal')
  EXECUTE FUNCTION contracts.doc_deal_promote_guard();
--> statement-breakpoint
-- X2 · lịch sử sửa giao dịch (ai, khi nào, trường, cũ → mới). Chỉ thêm. Không FK sang `contracts` (D9-02: bộ test TRUNCATE HĐ không
-- CASCADE; như obligations/esign); thấy được khi thấy chứng từ (RLS M1 của `contracts`).
CREATE TABLE IF NOT EXISTS contracts.contract_edit_log (
  id bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  actor_user_id uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  at timestamptz NOT NULL DEFAULT now(),
  field text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  CONSTRAINT contract_edit_log_pkey PRIMARY KEY (id),
  CONSTRAINT contract_edit_log_ck CHECK (field ~ '^[a-z_.]{2,60}$'
    AND octet_length(coalesce(old_value::text, '')) <= 16384 AND octet_length(coalesce(new_value::text, '')) <= 16384)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contract_edit_log_contract_idx ON contracts.contract_edit_log (tenant_id, contract_id, id);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'contract_edit_log');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON contracts.contract_edit_log FROM contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS contract_edit_log_visible ON contracts.contract_edit_log;
--> statement-breakpoint
CREATE POLICY contract_edit_log_visible ON contracts.contract_edit_log AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING (EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = contract_edit_log.contract_id AND c.tenant_id = contract_edit_log.tenant_id));
--> statement-breakpoint
DROP POLICY IF EXISTS contract_edit_log_ins ON contracts.contract_edit_log;
--> statement-breakpoint
CREATE POLICY contract_edit_log_ins ON contracts.contract_edit_log AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK (actor_user_id IS NOT DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
-- Một câu INSERT theo tập mỗi lệnh UPDATE hàng giao dịch: khoá `fields` (so `value`) + cột chứng từ. WHEN trong C ⇒ UPDATE không đổi
-- nội dung (vòng nhắc, trạng thái) không vào plpgsql. Ghi cả lệnh nâng (doc_type deal → contract, file).
CREATE OR REPLACE FUNCTION contracts.doc_deal_edit_log() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO contracts.contract_edit_log (tenant_id, contract_id, field, old_value, new_value)
  SELECT NEW.tenant_id, NEW.id, x.f, x.o, x.n
  FROM (
    SELECT 'fields.' || k AS f, OLD.fields -> k -> 'value' AS o, NEW.fields -> k -> 'value' AS n
    FROM (SELECT jsonb_object_keys(OLD.fields) UNION SELECT jsonb_object_keys(NEW.fields)) AS kk(k)
    UNION ALL
    SELECT v.f, v.o, v.n FROM (VALUES
      ('title', to_jsonb(OLD.title), to_jsonb(NEW.title)),
      ('source', to_jsonb(OLD.source), to_jsonb(NEW.source)),
      ('doc_type', to_jsonb(OLD.doc_type), to_jsonb(NEW.doc_type)),
      ('file_id', to_jsonb(OLD.file_id), to_jsonb(NEW.file_id)),
      ('commission_pct', to_jsonb(OLD.commission_pct), to_jsonb(NEW.commission_pct)),
      ('commission_fixed', to_jsonb(OLD.commission_fixed), to_jsonb(NEW.commission_fixed)),
      ('product_group', to_jsonb(OLD.product_group), to_jsonb(NEW.product_group)),
      ('frame_root_id', to_jsonb(OLD.frame_root_id), to_jsonb(NEW.frame_root_id)),
      ('owner_user_id', to_jsonb(OLD.owner_user_id), to_jsonb(NEW.owner_user_id))) AS v(f, o, n)
  ) x
  WHERE x.o IS DISTINCT FROM x.n AND char_length(x.f) <= 60 AND x.f ~ '^[a-z_.]{2,60}$';
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.doc_deal_edit_log() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.doc_deal_edit_log() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_doc_deal_edit_log ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_doc_deal_edit_log AFTER UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (OLD.doc_type = 'deal' AND (OLD.fields, OLD.title, OLD.source, OLD.doc_type, OLD.file_id,
      OLD.commission_pct, OLD.commission_fixed, OLD.product_group, OLD.frame_root_id, OLD.owner_user_id)
    IS DISTINCT FROM (NEW.fields, NEW.title, NEW.source, NEW.doc_type, NEW.file_id,
      NEW.commission_pct, NEW.commission_fixed, NEW.product_group, NEW.frame_root_id, NEW.owner_user_id))
  EXECUTE FUNCTION contracts.doc_deal_edit_log();
--> statement-breakpoint
-- Hàng G1 chuyển sang: nghĩa vụ trỏ lại `contract_id` (= id giao dịch, giữ id) và GIỮ `transaction_id` để đối chiếu ⇒ nới CHECK
-- "đúng một": cho phép cả hai khi trùng nhau.
ALTER TABLE contracts.obligations DROP CONSTRAINT IF EXISTS obligations_parent_ck;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD CONSTRAINT obligations_parent_ck
  CHECK ((contract_id IS NULL) <> (transaction_id IS NULL) OR contract_id = transaction_id);
--> statement-breakpoint
-- Bảng G1 chỉ đọc: thu quyền ghi của app + trigger chặn mọi đường ghi (kể cả chủ bảng) trừ khi phiên đặt
-- `contracts.g1_legacy_write = 'on'` (chỉ dùng cho bộ test dựng dữ liệu cũ). Lỗi `EG410` ⇒ Hub 410 `USE_CONTRACTS`.
REVOKE INSERT, UPDATE, DELETE ON contracts.transactions, contracts.transaction_lines, contracts.transaction_events
  FROM contracts_rw;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.g1_read_only() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF coalesce(current_setting('contracts.g1_legacy_write', true), '') = 'on' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'USE_CONTRACTS' USING ERRCODE = 'EG410';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.g1_read_only() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS transactions_g1_ro ON contracts.transactions;
--> statement-breakpoint
CREATE TRIGGER transactions_g1_ro BEFORE INSERT OR UPDATE OR DELETE ON contracts.transactions
  FOR EACH ROW EXECUTE FUNCTION contracts.g1_read_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS transaction_lines_g1_ro ON contracts.transaction_lines;
--> statement-breakpoint
CREATE TRIGGER transaction_lines_g1_ro BEFORE INSERT OR UPDATE OR DELETE ON contracts.transaction_lines
  FOR EACH ROW EXECUTE FUNCTION contracts.g1_read_only();
--> statement-breakpoint
DROP TRIGGER IF EXISTS transaction_events_g1_ro ON contracts.transaction_events;
--> statement-breakpoint
CREATE TRIGGER transaction_events_g1_ro BEFORE INSERT OR UPDATE OR DELETE ON contracts.transaction_events
  FOR EACH ROW EXECUTE FUNCTION contracts.g1_read_only();
