-- HUB-FR-118 · P-b2 review vòng 1 (security Minor) · `process_back_events.task_id` FK kép cùng tenant: 0024 chỉ FK `task_id`
-- ⇒ một hàng có thể trỏ task tenant khác. Thay bằng `(task_id, tenant_id)` → `review_tasks (id, tenant_id)` (UNIQUE
-- `review_tasks_id_tenant_uq`, 0019) `ON DELETE SET NULL (task_id)` (PG15+; compose/CI = postgres:16) — xoá task chỉ NULL
-- `task_id`, giữ `tenant_id` NOT NULL. Không sửa 0024 (đã áp). Viết tay, chạy lại an toàn: chỉ đổi khi FK hiện tại chưa kép.
-- Không mất dữ liệu (chỉ đổi ràng buộc; index `process_back_events_task_idx` (task_id) vẫn phục vụ tra FK).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'process_back_events_task_fk'
                 AND conrelid = 'hub.process_back_events'::regclass AND array_length(conkey, 1) = 2) THEN
    ALTER TABLE hub.process_back_events DROP CONSTRAINT IF EXISTS process_back_events_task_fk;
    ALTER TABLE hub.process_back_events ADD CONSTRAINT process_back_events_task_fk
      FOREIGN KEY (task_id, tenant_id) REFERENCES hub.review_tasks (id, tenant_id)
      ON DELETE SET NULL (task_id);
  END IF;
END $$;
