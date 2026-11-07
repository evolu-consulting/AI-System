-- CR-125 · lịch sử HĐ: mỗi task duyệt chỉ MỘT dòng `stage_decided` (bấm đúp / thử lại ⇒ `on conflict do nothing`). Index một phần, chỉ cộng thêm.
CREATE UNIQUE INDEX IF NOT EXISTS contract_events_stage_decided_uq
  ON contracts.contract_events (tenant_id, (data ->> 'task_id'))
  WHERE type = 'stage_decided';
