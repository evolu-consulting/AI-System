-- CR-127 K6 · spec §2.1/§7 · BR-67…69 · D6: gỡ `handled` + `action_deadline` (nguồn hiệu lực = `effect_outcome` + `refresh_effect`, K1a/K6).
-- Mọi chỗ đọc đã chuyển (mywork/todo/list/detail/export/assistant/mgmt-import); K1a đã backfill `effect_outcome` từ `handled`.
-- Thứ tự: trigger/chỉ mục nhắc tham chiếu cột → hàm → cột. `contracts_job` EXECUTE `refresh_effect` (vòng hiệu lực theo lô).
DROP TRIGGER IF EXISTS contracts_hd4_deadline ON contracts.contracts;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_hd4_deadline_upd ON contracts.contracts;
--> statement-breakpoint
DROP FUNCTION IF EXISTS contracts.hd4_deadline();
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_hd4_schedule_upd ON contracts.contracts;
--> statement-breakpoint
-- Lịch nhắc nay chỉ để tính lại HIỆU LỰC đúng ngày (không còn chuông cứng): xếp `-infinity` khi vào DONE, đổi ngày/ngưỡng/kết cục.
CREATE OR REPLACE FUNCTION contracts.hd4_schedule() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.kind <> 'contract' OR NEW.status <> 'done' THEN
    IF TG_OP = 'UPDATE' THEN DELETE FROM contracts.contract_schedule WHERE contract_id = NEW.id; END IF;
  ELSIF TG_OP = 'INSERT' OR OLD.status <> 'done' OR OLD.kind <> 'contract'
     OR NEW.effect_outcome IS DISTINCT FROM OLD.effect_outcome
     OR NEW.start_date IS DISTINCT FROM OLD.start_date OR NEW.end_date IS DISTINCT FROM OLD.end_date
     OR (NEW.fields -> 'notice_days' ->> 'value') IS DISTINCT FROM (OLD.fields -> 'notice_days' ->> 'value') THEN
    INSERT INTO contracts.contract_schedule (contract_id, tenant_id, remind_at) VALUES (NEW.id, NEW.tenant_id, '-infinity')
      ON CONFLICT (contract_id) DO UPDATE SET remind_at = '-infinity';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER contracts_hd4_schedule_upd AFTER UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (OLD.fields IS DISTINCT FROM NEW.fields OR OLD.effect_outcome IS DISTINCT FROM NEW.effect_outcome
    OR OLD.kind IS DISTINCT FROM NEW.kind
    OR (OLD.status IS DISTINCT FROM NEW.status AND (OLD.status = 'done' OR NEW.status = 'done')))
  EXECUTE FUNCTION contracts.hd4_schedule();
--> statement-breakpoint
-- Bản bị thay chỉ đọc (0049): bỏ `handled` khỏi danh sách cột so sánh.
DROP TRIGGER IF EXISTS contracts_k2_ro ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_k2_ro BEFORE UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (OLD.superseded_at IS NOT NULL AND (
    (NEW.fields, NEW.owner_user_id, NEW.locked_at, NEW.commission_pct, NEW.commission_fixed, NEW.deal, NEW.direction,
      NEW.parent_id, NEW.title, NEW.file_id, NEW.superseded_at, NEW.superseded_by, NEW.root_id, NEW.version_no)
    IS DISTINCT FROM
    (OLD.fields, OLD.owner_user_id, OLD.locked_at, OLD.commission_pct, OLD.commission_fixed, OLD.deal, OLD.direction,
      OLD.parent_id, OLD.title, OLD.file_id, OLD.superseded_at, OLD.superseded_by, OLD.root_id, OLD.version_no)))
  EXECUTE FUNCTION contracts.k2_superseded_ro();
--> statement-breakpoint
DROP INDEX IF EXISTS contracts.contracts_deadline_idx;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_handled_ck;
--> statement-breakpoint
ALTER TABLE contracts.contracts DROP COLUMN IF EXISTS handled, DROP COLUMN IF EXISTS action_deadline;
--> statement-breakpoint
DROP FUNCTION IF EXISTS contracts.deadline_of(text, jsonb);
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.effect_of(text, timestamptz, text, date, date, jsonb, date),
  contracts.refresh_effect(uuid[], date) TO contracts_job;
