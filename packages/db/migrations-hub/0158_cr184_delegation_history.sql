-- CR-184 · Lịch sử uỷ quyền · ai thu hồi (`revoked_by`) + chỉ mục đếm «việc đã làm thay» theo hàng giao việc uỷ quyền. CHỈ THÊM, chạy lại được.
-- Hàng cũ đã thu hồi trước migration này: `revoked_by` null (UI ghi «không rõ»).
-- Migration chạy trong MỘT tx ⇒ không CONCURRENTLY (repo chưa có tiền lệ CONCURRENTLY: 0066/0098/0129; `review_task_assignees` mỗi dòng = một người được giao việc duyệt,
-- chỉ mục MỘT PHẦN `via = 'delegated'` rất nhỏ, dựng một lần). `lock_timeout`: có phiên giữ bảng ⇒ migration thất bại (chạy lại được) thay vì treo hàng đợi khoá.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE hub.delegations ADD COLUMN IF NOT EXISTS revoked_by uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS review_task_assignees_delegated_idx
  ON hub.review_task_assignees (tenant_id, on_behalf_of, user_id) WHERE via = 'delegated';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS delegations_history_idx ON hub.delegations (tenant_id, created_at DESC, id);
