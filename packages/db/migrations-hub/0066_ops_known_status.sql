-- CR-104 · ops-fix-core · trạng thái ĐÃ BIẾT gần nhất của mỗi check (ok|warn|crit, bỏ qua `unknown`) + lúc nó đổi: chuông
-- warn/crit/hồi phục tính theo trạng thái này ⇒ `crit → unknown → crit` không báo lại, `warn → unknown → ok` vẫn báo hồi phục.
-- NULL = chưa biết (check mới / vừa tắt). Chỉ THÊM cột + điền từ dữ liệu hiện có — không mất dữ liệu; chạy lại vô hại.
-- Số 0066 (0065 giữ cho index của lát ops-checks). `when` lớn hơn mọi bản trước.
ALTER TABLE hub.ops_checks ADD COLUMN IF NOT EXISTS last_known_status text;
--> statement-breakpoint
ALTER TABLE hub.ops_checks ADD COLUMN IF NOT EXISTS last_known_at timestamptz;
--> statement-breakpoint
ALTER TABLE hub.ops_checks DROP CONSTRAINT IF EXISTS ops_checks_known_ck;
--> statement-breakpoint
ALTER TABLE hub.ops_checks ADD CONSTRAINT ops_checks_known_ck CHECK (
  (last_known_status IS NULL AND last_known_at IS NULL)
  OR (last_known_status IN ('ok', 'warn', 'crit') AND last_known_at IS NOT NULL));
--> statement-breakpoint
UPDATE hub.ops_checks SET last_known_status = status, last_known_at = changed_at
  WHERE status <> 'unknown' AND last_known_status IS NULL;
