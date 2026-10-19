-- HD4-FR-01 · HD4-FR-05 · HD4-NFR-02 · D4-01…D4-04 · N1 D-12 · HD4 plan §1: hạn chót + lịch nhắc + role quét chéo tenant.
-- (1) cột `remind_at` (due_at trên bảng chính — không bảng con: FK tới `contracts` làm vỡ `truncate` các test HD1 khoá);
-- (2) trigger BEFORE INSERT/UPDATE tính `action_deadline` cho MỌI đường ghi, mở lại khi hạn đổi, xếp lịch `-infinity` (xử lý
--     ngay, không phụ thuộc đồng hồ) khi HĐ vào trạng thái đã duyệt hoặc đổi dữ kiện nhắc; (3) role `contracts_job` chỉ thấy
--     (tenant_id, remind_at) của hàng có lịch; (4) nạp lại HĐ đã duyệt có sẵn. Chỉ cộng thêm; chạy lại vô hại.
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS remind_at timestamptz;
--> statement-breakpoint
-- Tìm tenant có việc (role job, chéo tenant) và claim lô theo tenant (role rw): hai index một phần, chỉ hàng có lịch.
CREATE INDEX IF NOT EXISTS contracts_remind_idx ON contracts.contracts (remind_at) WHERE remind_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contracts_remind_tenant_idx ON contracts.contracts (tenant_id, remind_at)
  WHERE remind_at IS NOT NULL;
--> statement-breakpoint
-- ≡ `deadlineOf` (domain/deadline.rules.ts): end_date − notice_days; notice rỗng/không phải số nguyên/ngoài 0…3650 ⇒ 0 (D4-06).
CREATE OR REPLACE FUNCTION contracts.deadline_of(p_kind text, p_fields jsonb) RETURNS date
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog
  RETURN CASE WHEN p_kind = 'contract' THEN
    contracts.as_date(p_fields -> 'end_date' ->> 'value') - COALESCE((SELECT n::int FROM (SELECT
      contracts.as_bigint(p_fields -> 'notice_days' ->> 'value') AS n) s WHERE n BETWEEN 0 AND 3650), 0)
  END;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.hd4_schedule() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  confirmed constant text[] := ARRAY['active', 'expiring', 'expired', 'renewed', 'terminated'];
BEGIN
  -- Cột sinh (`end_date`) chưa có trong BEFORE ⇒ tính từ `fields`.
  NEW.action_deadline := contracts.deadline_of(NEW.kind, NEW.fields);
  IF TG_OP = 'UPDATE' AND NEW.action_deadline IS DISTINCT FROM OLD.action_deadline
     AND OLD.handled IS NOT NULL AND NEW.handled IS NOT DISTINCT FROM OLD.handled THEN
    -- Hạn đổi ⇒ mở lại (mgmt-app `_set_deadline`): bỏ kết quả xử lý; trạng thái chốt theo kết quả quay về theo ngày.
    NEW.handled := NULL;
    IF NEW.status IN ('renewed', 'terminated') THEN NEW.status := 'active'; END IF;
  END IF;
  IF NEW.kind <> 'contract' OR NOT (NEW.status = ANY (confirmed)) THEN
    NEW.remind_at := NULL;
  ELSIF TG_OP = 'INSERT' OR NOT (OLD.status = ANY (confirmed)) OR OLD.kind <> 'contract'
     OR NEW.action_deadline IS DISTINCT FROM OLD.action_deadline OR NEW.handled IS DISTINCT FROM OLD.handled
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR (NEW.fields -> 'end_date' ->> 'value') IS DISTINCT FROM (OLD.fields -> 'end_date' ->> 'value') THEN
    NEW.remind_at := '-infinity';
  END IF; -- còn lại: giữ `remind_at` của lệnh (vòng nhắc tự ghi mốc kế; đổi trạng thái giữa các mức đã duyệt không xếp lại)
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.deadline_of(text, jsonb), contracts.hd4_schedule() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.deadline_of(text, jsonb), contracts.hd4_schedule() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_hd4_schedule ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_hd4_schedule BEFORE INSERT OR UPDATE ON contracts.contracts
  FOR EACH ROW EXECUTE FUNCTION contracts.hd4_schedule();
--> statement-breakpoint
-- D-12: role quét chéo tenant — chỉ tìm tenant có việc tới hạn; xử lý lô vẫn bằng `contracts_rw` + `app.tenant_id`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contracts_job') THEN
    CREATE ROLE contracts_job NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END
$$;
--> statement-breakpoint
ALTER ROLE contracts_job NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
--> statement-breakpoint
GRANT USAGE ON SCHEMA contracts TO contracts_job;
--> statement-breakpoint
GRANT SELECT (tenant_id, remind_at) ON contracts.contracts TO contracts_job;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'contracts.contracts'::regclass AND polname = 'contracts_job_due') THEN
    CREATE POLICY contracts_job_due ON contracts.contracts FOR SELECT TO contracts_job USING (remind_at IS NOT NULL);
  END IF;
END
$$;
--> statement-breakpoint
GRANT contracts_job TO hub_api WITH INHERIT FALSE, SET TRUE;
--> statement-breakpoint
-- Nạp lại (readiness #6): HĐ đã duyệt có sẵn ⇒ tính hạn + xếp lịch ngay (trigger chạy cho từng hàng).
UPDATE contracts.contracts SET remind_at = '-infinity'
  WHERE kind = 'contract' AND status IN ('active', 'expiring', 'expired', 'renewed', 'terminated') AND remind_at IS NULL;
