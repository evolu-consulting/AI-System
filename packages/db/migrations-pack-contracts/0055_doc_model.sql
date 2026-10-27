-- CR-101 DOC-model · 3 loại chứng từ trên `contracts.contracts` (R3, R4, R30, R36, R43–R46; Câu 9). Chỉ cộng thêm; chạy lại vô hại.
-- `doc_type` contract (HĐ kinh tế, mặc định hàng cũ) | framework (HĐ nguyên tắc, chứng từ cha) | deal (giao dịch, DOC-deals ghi).
-- Con (contract/deal, kind = contract) gắn HĐ NT qua `frame_root_id` = `root_id` (= id v1) của chuỗi phiên bản HĐ NT ⇒ v2 của HĐ NT
-- tự tiếp quản con. FK kép (frame_root_id, tenant_id) ⇒ không trỏ được sang tenant khác. Xoá HĐ NT (v1 = cả chuỗi, X5) ⇒ con giữ,
-- `frame_root_id` = null (R36; hành động FK chạy quyền chủ bảng nên cả con người xoá không thấy cũng được gỡ).
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'contract';
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS frame_root_id uuid;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS credit_limit bigint;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS order_terms text;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_doc_type_ck;
--> statement-breakpoint
-- Hạn mức / cách đặt hàng chỉ của HĐ NT; HĐ NT không là con, không là phụ lục; con là HĐ (kind = contract) không trỏ chính chuỗi mình.
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_doc_type_ck CHECK (
  doc_type IN ('contract', 'framework', 'deal')
  AND (credit_limit IS NULL OR (doc_type = 'framework' AND credit_limit BETWEEN 0 AND 1000000000000000))
  AND (order_terms IS NULL OR (doc_type = 'framework' AND char_length(order_terms) <= 4000))
  AND (doc_type <> 'framework' OR kind = 'contract')
  AND (frame_root_id IS NULL OR (doc_type <> 'framework' AND kind = 'contract' AND frame_root_id <> root_id)));
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_frame_fk;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_frame_fk FOREIGN KEY (frame_root_id, tenant_id)
  REFERENCES contracts.contracts (id, tenant_id) ON DELETE SET NULL (frame_root_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contracts_frame_idx ON contracts.contracts (tenant_id, frame_root_id)
  WHERE frame_root_id IS NOT NULL;
--> statement-breakpoint
-- R43 · con cùng đối tác + cùng hướng với HĐ NT. Kiểm khi gắn (INSERT / đổi `frame_root_id`) và khi con được xác nhận (khoá) —
-- không kiểm lúc AI đọc (bên chưa chắc) để luồng đọc không vỡ. Bên/hướng còn trống ở một phía ⇒ chưa kết luận, cho qua.
-- Cha phải là v1 của chuỗi HĐ NT và THẤY ĐƯỢC (RLS, SECURITY INVOKER) khi gắn; lúc xác nhận mà không thấy cha ⇒ bỏ qua.
-- Lỗi: SQLSTATE `EK422` + message = mã (Hub ⇒ 422).
CREATE OR REPLACE FUNCTION contracts.doc_frame_check() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  attach boolean := TG_OP = 'INSERT' OR NEW.frame_root_id IS DISTINCT FROM OLD.frame_root_id;
  f record;
BEGIN
  SELECT c.doc_type, c.root_id = c.id AS is_root, cur.partner_key, cur.direction INTO f
  FROM contracts.contracts c
  LEFT JOIN LATERAL (SELECT v.partner_key, v.direction FROM contracts.contracts v
    WHERE v.tenant_id = c.tenant_id AND v.root_id = c.id AND v.superseded_at IS NULL
    ORDER BY v.version_no LIMIT 1) cur ON true
  WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.frame_root_id;
  IF NOT FOUND THEN
    IF attach THEN RAISE EXCEPTION 'FRAME_INVALID' USING ERRCODE = 'EK422'; END IF;
    RETURN NULL;
  END IF;
  IF f.doc_type <> 'framework' OR NOT f.is_root THEN
    RAISE EXCEPTION 'FRAME_INVALID' USING ERRCODE = 'EK422';
  END IF;
  IF (f.partner_key IS NOT NULL AND NEW.partner_key IS NOT NULL AND f.partner_key <> NEW.partner_key)
     OR (f.direction IS NOT NULL AND NEW.direction IS NOT NULL AND f.direction <> NEW.direction) THEN
    RAISE EXCEPTION 'FRAME_PARTNER_MISMATCH' USING ERRCODE = 'EK422';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.doc_frame_check() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.doc_frame_check() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_doc_frame_ins ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_doc_frame_ins AFTER INSERT ON contracts.contracts
  FOR EACH ROW WHEN (NEW.frame_root_id IS NOT NULL) EXECUTE FUNCTION contracts.doc_frame_check();
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_doc_frame_upd ON contracts.contracts;
--> statement-breakpoint
-- WHEN đánh giá trong C: UPDATE thường của con (vòng nhắc, sửa trường) không vào plpgsql.
CREATE TRIGGER contracts_doc_frame_upd AFTER UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (NEW.frame_root_id IS NOT NULL AND (NEW.frame_root_id IS DISTINCT FROM OLD.frame_root_id
    OR (OLD.locked_at IS NULL AND NEW.locked_at IS NOT NULL)))
  EXECUTE FUNCTION contracts.doc_frame_check();
--> statement-breakpoint
-- HĐ NT còn con thì không đổi loại (con sẽ trỏ vào chứng từ không phải HĐ NT). Một câu EXISTS theo index `contracts_frame_idx`.
CREATE OR REPLACE FUNCTION contracts.doc_frame_type_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM contracts.contracts k WHERE k.tenant_id = NEW.tenant_id AND k.frame_root_id = NEW.root_id) THEN
    RAISE EXCEPTION 'FRAME_HAS_CHILDREN' USING ERRCODE = 'EK409';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.doc_frame_type_guard() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.doc_frame_type_guard() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_doc_frame_type ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_doc_frame_type AFTER UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (OLD.doc_type = 'framework' AND NEW.doc_type <> 'framework')
  EXECUTE FUNCTION contracts.doc_frame_type_guard();
--> statement-breakpoint
-- R44 · HĐ NT không có mốc tiền/giao/hoa hồng/serial (không kho, không doanh thu): chỉ `renewal` (nhắc gia hạn) + `other`.
-- Mốc sinh tự động (`default` của HD7/duyệt, `ai`, `cks`) cho HĐ NT bị BỎ QUA (không ném — không được làm hỏng lệnh duyệt);
-- mốc người dùng ghi tay ⇒ `EK422 FRAME_MILESTONE_KIND`. WHEN trong C: mốc renewal/other không vào plpgsql.
CREATE OR REPLACE FUNCTION contracts.doc_frame_milestone() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contracts.contracts c WHERE c.tenant_id = NEW.tenant_id AND c.id = NEW.contract_id
                 AND c.doc_type = 'framework') THEN
    RETURN NEW;
  END IF;
  IF NEW.source = 'manual' THEN
    RAISE EXCEPTION 'FRAME_MILESTONE_KIND' USING ERRCODE = 'EK422';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.doc_frame_milestone() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.doc_frame_milestone() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS obligations_doc_frame ON contracts.obligations;
--> statement-breakpoint
CREATE TRIGGER obligations_doc_frame BEFORE INSERT ON contracts.obligations
  FOR EACH ROW WHEN (NEW.kind NOT IN ('renewal', 'other')) EXECUTE FUNCTION contracts.doc_frame_milestone();
