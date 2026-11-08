-- CR-125 · purchase-flow G3 · «A + B cùng duyệt»: bước Duyệt có `after.parallel` mở MỘT thẻ duyệt mở cho MỖI nhóm cùng lúc.
-- Khoá "một task mở mỗi stage + loại" (0019) thêm nhóm assignee: vẫn một thẻ mở mỗi nhóm của stage; bước thường (một nhóm / không
-- nhóm) giữ nguyên ràng buộc. Chỉ đổi index (không đụng dữ liệu); index cũ là tập con chặt hơn ⇒ dữ liệu hiện có luôn thoả.
DROP INDEX IF EXISTS hub.review_tasks_open_uq;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS review_tasks_open_uq ON hub.review_tasks
  (stage_run_id, kind, coalesce(assignee_group_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'open';
