-- HD4-FR-01 · HD4-FR-05 · HD4-NFR-01/02 · D4-01…D4-04 · D4-11 · N1 D-12 · HD4 plan §1: hạn chót + lịch nhắc + role quét chéo tenant.
-- (1) bảng lịch `contract_schedule` (due_at, một hàng/HĐ đã duyệt; tách khỏi `contracts` vì UPDATE hàng HĐ tính lại mọi cột sinh
--     — 100 hàng ~12 ms; KHÔNG FK tới `contracts` để `truncate` của test HD1 khoá không vỡ — dọn bằng trigger DELETE/TRUNCATE);
-- (2) trigger BEFORE trên `contracts` tính `action_deadline` cho MỌI đường ghi, mở lại khi hạn đổi, xếp lịch `-infinity` (xử lý
--     ngay, không phụ thuộc đồng hồ) khi HĐ vào trạng thái đã duyệt hoặc đổi dữ kiện nhắc; (3) role `contracts_job` chỉ đọc
--     (tenant_id, remind_at) của bảng lịch; (4) nạp lại HĐ có sẵn. Chỉ cộng thêm; chạy lại vô hại.
CREATE TABLE IF NOT EXISTS contracts.contract_schedule (
  contract_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  remind_at timestamptz NOT NULL,
  CONSTRAINT contract_schedule_pkey PRIMARY KEY (contract_id)
);
--> statement-breakpoint
-- Tìm tenant có việc (role job, chéo tenant) và claim lô theo tenant (role rw).
CREATE INDEX IF NOT EXISTS contract_schedule_due_idx ON contracts.contract_schedule (remind_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contract_schedule_tenant_idx ON contracts.contract_schedule (tenant_id, remind_at);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'contract_schedule');
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
    IF TG_OP = 'UPDATE' THEN DELETE FROM contracts.contract_schedule WHERE contract_id = NEW.id; END IF;
  ELSIF TG_OP = 'INSERT' OR NOT (OLD.status = ANY (confirmed)) OR OLD.kind <> 'contract'
     OR NEW.action_deadline IS DISTINCT FROM OLD.action_deadline OR NEW.handled IS DISTINCT FROM OLD.handled
     OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
     OR (NEW.fields -> 'end_date' ->> 'value') IS DISTINCT FROM (OLD.fields -> 'end_date' ->> 'value') THEN
    INSERT INTO contracts.contract_schedule (contract_id, tenant_id, remind_at) VALUES (NEW.id, NEW.tenant_id, '-infinity')
      ON CONFLICT (contract_id) DO UPDATE SET remind_at = '-infinity';
  END IF; -- còn lại (đổi trạng thái giữa các mức đã duyệt, sửa trường không liên quan): giữ lịch của vòng nhắc
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contracts.hd4_unschedule() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    TRUNCATE contracts.contract_schedule;
  ELSE
    DELETE FROM contracts.contract_schedule WHERE contract_id = OLD.id;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.deadline_of(text, jsonb), contracts.hd4_schedule(), contracts.hd4_unschedule() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.deadline_of(text, jsonb), contracts.hd4_schedule(), contracts.hd4_unschedule()
  TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_hd4_schedule ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_hd4_schedule BEFORE INSERT ON contracts.contracts
  FOR EACH ROW EXECUTE FUNCTION contracts.hd4_schedule();
--> statement-breakpoint
-- UPDATE: chỉ gọi hàm khi dữ kiện hạn/nhắc đổi (WHEN đánh giá trong C, không vào plpgsql) — đổi trạng thái giữa các mức đã
-- duyệt của vòng nhắc không chạy trigger (HD4-NFR-01).
DROP TRIGGER IF EXISTS contracts_hd4_schedule_upd ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_hd4_schedule_upd BEFORE UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (OLD.fields IS DISTINCT FROM NEW.fields OR OLD.handled IS DISTINCT FROM NEW.handled
    OR OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id OR OLD.kind IS DISTINCT FROM NEW.kind
    OR (OLD.status IS DISTINCT FROM NEW.status AND NOT (
      OLD.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated')
      AND NEW.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated'))))
  EXECUTE FUNCTION contracts.hd4_schedule();
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_hd4_unschedule ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_hd4_unschedule AFTER DELETE ON contracts.contracts
  FOR EACH ROW EXECUTE FUNCTION contracts.hd4_unschedule();
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_hd4_unschedule_all ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_hd4_unschedule_all AFTER TRUNCATE ON contracts.contracts
  FOR EACH STATEMENT EXECUTE FUNCTION contracts.hd4_unschedule();
--> statement-breakpoint
-- D-12: role quét chéo tenant — chỉ tìm tenant có việc tới hạn trên bảng lịch; xử lý lô vẫn bằng `contracts_rw` + `app.tenant_id`.
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
GRANT SELECT (tenant_id, remind_at) ON contracts.contract_schedule TO contracts_job;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'contracts.contract_schedule'::regclass
                 AND polname = 'contract_schedule_job') THEN
    CREATE POLICY contract_schedule_job ON contracts.contract_schedule FOR SELECT TO contracts_job USING (true);
  END IF;
END
$$;
--> statement-breakpoint
GRANT contracts_job TO hub_api WITH INHERIT FALSE, SET TRUE;
--> statement-breakpoint
-- Nạp lại (readiness #6): HĐ có sẵn ⇒ tính hạn; HĐ đã duyệt ⇒ xếp lịch ngay. Chạy bằng role chủ migration (bỏ RLS).
UPDATE contracts.contracts SET action_deadline = contracts.deadline_of(kind, fields)
  WHERE action_deadline IS DISTINCT FROM contracts.deadline_of(kind, fields);
--> statement-breakpoint
INSERT INTO contracts.contract_schedule (contract_id, tenant_id, remind_at)
  SELECT id, tenant_id, '-infinity' FROM contracts.contracts
  WHERE kind = 'contract' AND status IN ('active', 'expiring', 'expired', 'renewed', 'terminated')
  ON CONFLICT (contract_id) DO NOTHING;
