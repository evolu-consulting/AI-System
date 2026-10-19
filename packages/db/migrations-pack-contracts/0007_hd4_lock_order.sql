-- HD4 review m2 · D4-12: tách trigger của 0003. Phần tính hạn chót (sửa NEW) giữ BEFORE; phần ghi lịch `contract_schedule`
-- (tác dụng phụ) chuyển sang AFTER ROW: quyết theo hàng đã chốt (mọi trigger BEFORE khác đã chạy xong), không phụ thuộc thứ tự
-- tên trigger BEFORE. Thứ tự khoá vẫn là hàng HĐ → hàng lịch (UPDATE đã khoá hàng HĐ trước khi trigger AFTER chạy) — cùng thứ
-- tự với claim của vòng nhắc (review M1). Không sửa 0003 tại chỗ (review m4). Chạy lại vô hại.
CREATE OR REPLACE FUNCTION contracts.hd4_deadline() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  -- Cột sinh (`end_date`) chưa có trong BEFORE ⇒ tính từ `fields`.
  NEW.action_deadline := contracts.deadline_of(NEW.kind, NEW.fields);
  IF TG_OP = 'UPDATE' AND NEW.action_deadline IS DISTINCT FROM OLD.action_deadline
     AND OLD.handled IS NOT NULL AND NEW.handled IS NOT DISTINCT FROM OLD.handled THEN
    -- Hạn đổi ⇒ mở lại (mgmt-app `_set_deadline`): bỏ kết quả xử lý; trạng thái chốt theo kết quả quay về theo ngày.
    NEW.handled := NULL;
    IF NEW.status IN ('renewed', 'terminated') THEN NEW.status := 'active'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.hd4_schedule() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  confirmed constant text[] := ARRAY['active', 'expiring', 'expired', 'renewed', 'terminated'];
BEGIN
  IF NEW.kind <> 'contract' OR NOT (NEW.status = ANY (confirmed)) THEN
    IF TG_OP = 'UPDATE' THEN DELETE FROM contracts.contract_schedule WHERE contract_id = NEW.id; END IF;
  ELSIF TG_OP = 'INSERT' OR NOT (OLD.status = ANY (confirmed)) OR OLD.kind <> 'contract'
     OR NEW.action_deadline IS DISTINCT FROM OLD.action_deadline OR NEW.handled IS DISTINCT FROM OLD.handled
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR (NEW.fields -> 'end_date' ->> 'value') IS DISTINCT FROM (OLD.fields -> 'end_date' ->> 'value') THEN
    INSERT INTO contracts.contract_schedule (contract_id, tenant_id, remind_at) VALUES (NEW.id, NEW.tenant_id, '-infinity')
      ON CONFLICT (contract_id) DO UPDATE SET remind_at = '-infinity';
  END IF; -- còn lại (đổi trạng thái giữa các mức đã duyệt, sửa trường không liên quan): giữ lịch của vòng nhắc
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.hd4_deadline() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.hd4_deadline() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_hd4_schedule ON contracts.contracts;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_hd4_schedule_upd ON contracts.contracts;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_hd4_deadline ON contracts.contracts;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_hd4_deadline_upd ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_hd4_deadline BEFORE INSERT ON contracts.contracts
  FOR EACH ROW EXECUTE FUNCTION contracts.hd4_deadline();
--> statement-breakpoint
-- Hạn chót chỉ phụ thuộc `fields` + `kind` ⇒ UPDATE khác (trạng thái, lịch, version…) không vào plpgsql.
CREATE TRIGGER contracts_hd4_deadline_upd BEFORE UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (OLD.fields IS DISTINCT FROM NEW.fields OR OLD.kind IS DISTINCT FROM NEW.kind)
  EXECUTE FUNCTION contracts.hd4_deadline();
--> statement-breakpoint
CREATE TRIGGER contracts_hd4_schedule AFTER INSERT ON contracts.contracts
  FOR EACH ROW EXECUTE FUNCTION contracts.hd4_schedule();
--> statement-breakpoint
-- WHEN đánh giá trong C: lệnh đổi trạng thái giữa các mức đã duyệt của vòng nhắc không chạy plpgsql (HD4-NFR-01).
CREATE TRIGGER contracts_hd4_schedule_upd AFTER UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (OLD.fields IS DISTINCT FROM NEW.fields OR OLD.handled IS DISTINCT FROM NEW.handled
    OR OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id OR OLD.kind IS DISTINCT FROM NEW.kind
    OR (OLD.status IS DISTINCT FROM NEW.status AND NOT (
      OLD.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated')
      AND NEW.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated'))))
  EXECUTE FUNCTION contracts.hd4_schedule();
