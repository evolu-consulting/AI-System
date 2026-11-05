-- CR-121 · R-1 · "Chạy lại cả lượt": run mới ghi `rerun_of` = run cũ (cùng tenant). Unique một phần ⇒ hai lần bấm đồng thời chỉ
-- tạo MỘT run mới (kẻ thua thấy hàng đã có, trả lại đúng run đó). Người dừng + lý do + thời điểm KHÔNG thêm cột: nguồn duy nhất là
-- `hub.audit_log` (entity 'process_run', action có sẵn 'cancel'/'start', `summary.op` = stop|rerun_step|rerun + `reason`) +
-- `cancelled_by` đã có. FK thêm NOT VALID (khoá ngắn) rồi VALIDATE (SHARE UPDATE EXCLUSIVE — đọc/ghi vẫn chạy, như 0063). Index
-- không CONCURRENTLY: migrator drizzle bọc MỘT tx (repo chưa có tiền lệ CONCURRENTLY, xem 0066/0070); cột mới toàn NULL. Chạy lại vô hại.
ALTER TABLE hub.process_runs ADD COLUMN IF NOT EXISTS rerun_of uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_runs_rerun_of_fk'
                 AND conrelid = 'hub.process_runs'::regclass) THEN
    ALTER TABLE hub.process_runs
      ADD CONSTRAINT process_runs_rerun_of_fk FOREIGN KEY (rerun_of) REFERENCES hub.process_runs (id) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE hub.process_runs VALIDATE CONSTRAINT process_runs_rerun_of_fk;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS process_runs_rerun_of_uq ON hub.process_runs (rerun_of) WHERE rerun_of IS NOT NULL;
