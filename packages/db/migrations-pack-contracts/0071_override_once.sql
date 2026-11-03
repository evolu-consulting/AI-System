-- CR-113 (review #4) · "duyệt thay" (`contract_events` type `approval_override`) ghi write-ahead TRƯỚC khi engine nhận quyết ⇒ bấm
-- lại / thử lại cùng task không được nhân bản: một hàng mỗi (lượt `run_id`, task engine `task_id`, người). Có `actor_user_id` vì hai
-- chủ gói khác nhau có thể cùng bấm một task (người thua đua giữ bản ghi lần bấm; thẻ chỉ tính bản ghi của ĐÚNG người quyết).
-- Index một phần (chỉ type này) ⇒ không ảnh hưởng event khác; ghi `on conflict do nothing`. Chỉ cộng thêm.
CREATE UNIQUE INDEX IF NOT EXISTS contract_events_override_uq
  ON contracts.contract_events (tenant_id, (data ->> 'run_id'), (data ->> 'task_id'), actor_user_id)
  WHERE type = 'approval_override';
