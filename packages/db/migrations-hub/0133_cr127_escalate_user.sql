-- CR-127 · E3c · spec §5.2 (Q18) · chuyển cấp quá hạn tới MỘT người: `review_tasks.escalate_user_id` (bước `after.escalate.user_id`).
-- CHECK `review_tasks_remind_ck` (0131) đổi: `escalate_at` có ⇔ có đích (nhóm HOẶC người). Vòng chuyển cấp thêm hàng người
-- `via='escalated'` (hàng nhóm như cũ). Chỉ cộng thêm / nới; chạy lại vô hại.
ALTER TABLE hub.review_tasks ADD COLUMN IF NOT EXISTS escalate_user_id uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'review_tasks_remind_ck'
                 AND conrelid = 'hub.review_tasks'::regclass AND pg_get_constraintdef(oid) LIKE '%escalate_user_id%') THEN
    ALTER TABLE hub.review_tasks DROP CONSTRAINT IF EXISTS review_tasks_remind_ck;
    ALTER TABLE hub.review_tasks ADD CONSTRAINT review_tasks_remind_ck CHECK (
      remind_count BETWEEN 0 AND 10
      AND (remind_every_h IS NULL OR remind_every_h BETWEEN 4 AND 168)
      AND ((escalate_at IS NULL) = (escalate_group_id IS NULL AND escalate_user_id IS NULL))
      AND (escalate_group_id IS NULL OR escalate_user_id IS NULL)
      AND (kind IN ('review', 'milestone') OR (remind_every_h IS NULL AND escalate_at IS NULL)));
  END IF;
END $$;
