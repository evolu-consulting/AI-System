-- my-activity-rag · index cho tool `my-activity` ("tôi đã làm gì"): mỗi nhánh lọc `(tenant_id, <người làm>)` rồi lấy mới nhất
-- (`ORDER BY <giờ> DESC LIMIT n`) — không quét cả sổ của tenant. Chỉ thêm index; chạy lại vô hại.
CREATE INDEX IF NOT EXISTS contract_events_actor_idx ON contracts.contract_events (tenant_id, actor_user_id, at DESC)
  WHERE actor_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_events_by_user_idx ON contracts.partner_events (tenant_id, by_user, created_at DESC)
  WHERE by_user IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_event_voids_by_user_idx ON contracts.partner_event_voids (tenant_id, by_user, at DESC)
  WHERE by_user IS NOT NULL;
--> statement-breakpoint
-- "Lịch sử HĐ 2023/12-MP": tìm HĐ theo số (không phân biệt hoa thường, bỏ khoảng trắng hai đầu) trước khi áp luật thấy.
CREATE INDEX IF NOT EXISTS contracts_number_ci_idx ON contracts.contracts (tenant_id, lower(btrim(number)))
  WHERE number IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contract_delete_log_by_idx ON contracts.contract_delete_log (tenant_id, deleted_by, deleted_at DESC)
  WHERE deleted_by IS NOT NULL;
