-- CR-097 K1 · HD-FR-100 khoá cứng sau xác nhận · HD-FR-104 owner mở lại (log ở `contract_events` type `reopened`). Chỉ cộng thêm.
-- Bất biến DB: HĐ ở trạng thái đã xác nhận (active/expiring/expired/renewed/terminated) LUÔN có `locked_at` — trigger BEFORE
-- INSERT/UPDATE lấp khi còn trống (bao mọi đường xác nhận: "Lưu" khi tắt duyệt, finalize máy duyệt, CKS, import, contract-flow).
-- Mở lại (owner) đặt `status = 'needs_review'` + xoá `locked_*` trong cùng câu ⇒ trigger không khoá lại; xác nhận lại ⇒ khoá lại.
-- Backfill: HĐ đã xác nhận hiện có ⇒ `locked_at = coalesce(confirmed_at, updated_at)`, `locked_by = confirmed_by` (import cũ có thể
-- null). Một câu UPDATE theo tập (vài trăm hàng/tenant). Chạy lại vô hại.
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS locked_at timestamptz;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS locked_by uuid;
--> statement-breakpoint
UPDATE contracts.contracts SET locked_at = coalesce(confirmed_at, updated_at), locked_by = confirmed_by
  WHERE locked_at IS NULL AND status IN ('active', 'expiring', 'expired', 'renewed', 'terminated');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.k1_lock_on_confirm() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  NEW.locked_at := coalesce(NEW.confirmed_at, now());
  NEW.locked_by := NEW.confirmed_by;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.k1_lock_on_confirm() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_k1_lock ON contracts.contracts;
--> statement-breakpoint
-- WHEN đánh giá trong C: chỉ hàng đã xác nhận mà chưa khoá mới vào plpgsql (UPDATE thường của HĐ đã khoá không tốn gì).
CREATE TRIGGER contracts_k1_lock BEFORE INSERT OR UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (NEW.locked_at IS NULL
    AND NEW.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated'))
  EXECUTE FUNCTION contracts.k1_lock_on_confirm();
