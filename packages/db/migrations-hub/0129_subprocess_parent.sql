-- CR-125 · node «Quy trình con»: lượt con ghi lượt cha + stage cha + lần chạy (attempt, round) của stage cha. Unique một phần ⇒ kick lại /
-- hai instance cùng kick chỉ tạo MỘT lượt con cho mỗi lần chạy stage (thử lại sau lỗi = attempt mới ⇒ lượt con mới). FK NOT VALID rồi
-- VALIDATE (như 0098); cột mới toàn NULL. Lượt con kết thúc (done/cancelled/failed/expired) ⇒ trigger ghi MỘT hẹn `wait_until` tới hạn
-- NGAY cho stage cha đang chờ (`waiting_timer`) — vòng hẹn giờ sẵn có bắn ⇒ `finishWait` đọc kết quả lượt con (đường settle sẵn có, bền
-- qua khởi động lại; khoá hẹn `sub:<lượt con>` ⇒ không trùng). Stage cha đã huỷ/đổi ⇒ không ghi. Chạy lại vô hại.
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
-- SECURITY INVOKER: chạy với quyền + RLS của tx đổi trạng thái lượt con (cùng tenant với cha — FK (id, tenant_id) bảo đảm).
CREATE OR REPLACE FUNCTION hub.subprocess_settled() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, hub AS $$
BEGIN
  INSERT INTO hub.process_timers (tenant_id, process_run_id, stage_run_id, kind, due_at, timezone, idempotency_key)
  SELECT s.tenant_id, s.process_run_id, s.id, 'wait_until', now(), 'UTC', 'sub:' || NEW.id::text
    FROM hub.stage_runs s
   WHERE s.id = NEW.parent_stage_run_id AND s.tenant_id = NEW.tenant_id AND s.status = 'waiting_timer'
     AND s.attempt = NEW.parent_attempt AND s.round = NEW.parent_round
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS process_runs_subprocess_settled ON hub.process_runs;
--> statement-breakpoint
CREATE TRIGGER process_runs_subprocess_settled AFTER UPDATE OF status ON hub.process_runs
  FOR EACH ROW
  WHEN (NEW.parent_stage_run_id IS NOT NULL AND OLD.status IS DISTINCT FROM NEW.status
        AND NEW.status IN ('done', 'cancelled', 'failed', 'expired')
        AND OLD.status NOT IN ('done', 'cancelled', 'failed', 'expired'))
  EXECUTE FUNCTION hub.subprocess_settled();
