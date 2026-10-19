-- N2-FR-02 · N2 engine mở rộng (spec N2 §3). Viết tay, idempotent như 0037 (CHECK dựng lại chỉ khi chưa chứa giá trị mới).
-- Chỉ nới enum `review_tasks.result` thêm `reject` (Từ chối) ở cuối — không bảng/cột mới, không mất dữ liệu.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_result_ck'
                 AND conrelid = 'hub.review_tasks'::regclass AND pg_get_constraintdef(oid) LIKE '%''reject''%') THEN
    ALTER TABLE hub.review_tasks DROP CONSTRAINT IF EXISTS review_tasks_result_ck;
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_result_ck CHECK (result IS NULL OR result IN ('pass', 'fail',
      'answer', 'add_attempt', 'use_current', 'cancel', 'cancelled', 'expired', 'superseded', 'reject'));
  END IF;
END $$;
