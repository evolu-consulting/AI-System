-- CR-114 · hub-ha-sweeps · TD #254 · chỉ mục claim của vòng hết hạn (PD-P14) / nhắc (PD-P13) khớp ĐỦ `order by <hạn>, id limit n`.
-- EXPLAIN (ANALYZE, BUFFERS) trên dữ liệu PD-P14: index cũ chỉ `(expires_at)` ⇒ planner chọn Bitmap Heap Scan + Sort, đọc
-- MỌI entry còn trong index (24.300 TID, 4.840 trang heap) dù chỉ 100 run còn sống — entry của run đã `expired` là tuple chết
-- chờ vacuum, bitmap scan không đánh dấu LP_DEAD. Index `(hạn, id)` cho Index Scan theo thứ tự + Limit (dừng sau 100 hàng
-- sống, đánh dấu entry chết khi gặp) ⇒ chi phí lô không tăng theo số hàng đã xử lý. Giữ TÊN index cũ (tạo mới → bỏ cũ → đổi
-- tên) để test/tài liệu tham chiếu tên không đổi. Viết tay; chạy lại cho cùng kết quả.
CREATE INDEX IF NOT EXISTS process_runs_expiring_id_idx ON hub.process_runs (expires_at, id)
  WHERE expires_at IS NOT NULL
  AND status IN ('running', 'waiting_review', 'waiting_answer', 'needs_decision', 'waiting_timer');
--> statement-breakpoint
DROP INDEX IF EXISTS hub.process_runs_expiring_idx;
--> statement-breakpoint
ALTER INDEX hub.process_runs_expiring_id_idx RENAME TO process_runs_expiring_idx;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_tasks_remind_due_id_idx ON hub.review_tasks (remind_at, id)
  WHERE status = 'open' AND (reminded_at IS NULL OR (remind_every_h IS NOT NULL AND remind_count < 10));
--> statement-breakpoint
DROP INDEX IF EXISTS hub.review_tasks_remind_due_idx;
--> statement-breakpoint
ALTER INDEX hub.review_tasks_remind_due_id_idx RENAME TO review_tasks_remind_due_idx;
--> statement-breakpoint
-- `review_tasks_remind_idx` (0019, `reminded_at IS NULL`) bị `remind_due` (0036) bao trùm, không câu nào dùng riêng — bỏ để
-- mỗi lô `markRemindedMany` (đổi `remind_at`/`reminded_at`, không HOT) bớt một index phải ghi.
DROP INDEX IF EXISTS hub.review_tasks_remind_idx;
--> statement-breakpoint
-- Đếm chưa đọc mỗi lô notice (`writeNotices`: `user_id = any(…) and tenant_id = any(…) and read_at is null group by
-- tenant_id, user_id`): index cũ chỉ `(user_id)` ⇒ đọc heap lấy `tenant_id` + Sort mỗi lô (tăng theo số chưa đọc). Index
-- `(user_id, tenant_id)` cùng predicate: lọc + gom theo thứ tự index, không Sort; vẫn phục vụ tra theo `user_id`. Giữ tên.
CREATE INDEX IF NOT EXISTS process_notices_unread_ut_idx ON hub.process_notices (user_id, tenant_id) WHERE read_at IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS hub.process_notices_unread_idx;
--> statement-breakpoint
ALTER INDEX hub.process_notices_unread_ut_idx RENAME TO process_notices_unread_idx;
