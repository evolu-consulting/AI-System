-- CR-125 · node «Quy trình con»: lượt con ghi lượt cha + stage cha + lần chạy (attempt, round) của stage cha. Unique một phần ⇒ kick lại /
-- hai instance cùng kick chỉ tạo MỘT lượt con cho mỗi lần chạy stage (thử lại sau lỗi = attempt mới ⇒ lượt con mới). FK NOT VALID rồi
-- VALIDATE (như 0098); cột mới toàn NULL.
-- Chờ lượt con = stage cha `waiting_timer` + MỘT hẹn canh (`wait_until`, khoá `sub:<stage>:<attempt>:<round>:<n>`) do launcher ghi CÙNG tx mở
-- lượt con; hẹn canh tới hạn ⇒ `finishWait` đọc lượt con: đã kết thúc / không còn ⇒ chốt; còn chạy ⇒ ghi hẹn canh kế (lưới an toàn cho
-- lượt con bị xoá, trigger không chạy…). Đường nhanh: lượt con kết thúc ⇒ trigger KÉO hẹn canh mở của stage cha về `now()`. Trigger chỉ
-- UPDATE hàng hẹn (không đổi cột FK ⇒ không khoá hàng lượt cha) với `SKIP LOCKED` ⇒ tx kết thúc lượt con không bao giờ chờ khoá phía cha
-- (huỷ cha khoá cha → con; không chu trình khoá). SECURITY DEFINER + search_path cố định: chạy được từ mọi scope (system, user, sweeper).
-- Không CONCURRENTLY: migrator bọc MỘT tx (như 0066/0098) ⇒ `lock_timeout` + ghi chú deploy (docs/specs/CR-125/wave-review.md). Chạy lại vô hại.
SET LOCAL lock_timeout = '10s';
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS parent_run_id uuid;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS parent_stage_run_id uuid;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS parent_attempt smallint;
--> statement-breakpoint
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS parent_round smallint;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_runs_parent_fk'
                 AND conrelid = 'hub.process_runs'::regclass) THEN
    ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_parent_fk
      FOREIGN KEY (parent_run_id, tenant_id) REFERENCES hub.process_runs (id, tenant_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_runs_parent_stage_fk'
                 AND conrelid = 'hub.process_runs'::regclass) THEN
    ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_parent_stage_fk
      FOREIGN KEY (parent_stage_run_id, tenant_id) REFERENCES hub.stage_runs (id, tenant_id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_runs_parent_ck'
                 AND conrelid = 'hub.process_runs'::regclass) THEN
    ALTER TABLE hub.process_runs ADD CONSTRAINT process_runs_parent_ck CHECK (
      (parent_run_id IS NULL) = (parent_stage_run_id IS NULL)
      AND (parent_run_id IS NULL) = (parent_attempt IS NULL)
      AND (parent_run_id IS NULL) = (parent_round IS NULL)) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE hub.process_runs VALIDATE CONSTRAINT process_runs_parent_fk;
--> statement-breakpoint
ALTER TABLE hub.process_runs VALIDATE CONSTRAINT process_runs_parent_stage_fk;
--> statement-breakpoint
ALTER TABLE hub.process_runs VALIDATE CONSTRAINT process_runs_parent_ck;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS process_runs_parent_stage_uq
  ON hub.process_runs (parent_stage_run_id, parent_attempt, parent_round) WHERE parent_stage_run_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_runs_parent_idx ON hub.process_runs (parent_run_id) WHERE parent_run_id IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION hub.subprocess_settled() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, hub AS $$
BEGIN
  UPDATE hub.process_timers t SET due_at = now()
   WHERE t.id IN (SELECT x.id FROM hub.process_timers x
                   WHERE x.stage_run_id = NEW.parent_stage_run_id AND x.tenant_id = NEW.tenant_id
                     AND x.kind = 'wait_until' AND x.fired_at IS NULL AND x.cancelled_at IS NULL
                     AND x.idempotency_key LIKE 'sub:%' AND x.due_at > now()
                   FOR UPDATE SKIP LOCKED);
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION hub.subprocess_settled() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS process_runs_subprocess_settled ON hub.process_runs;
--> statement-breakpoint
CREATE TRIGGER process_runs_subprocess_settled AFTER UPDATE OF status ON hub.process_runs
  FOR EACH ROW
  WHEN (NEW.parent_stage_run_id IS NOT NULL AND OLD.status IS DISTINCT FROM NEW.status
        AND NEW.status IN ('done', 'cancelled', 'failed', 'expired')
        AND OLD.status NOT IN ('done', 'cancelled', 'failed', 'expired'))
  EXECUTE FUNCTION hub.subprocess_settled();
