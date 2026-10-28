-- com-c10b · dock trợ lý giá của Cộng đồng (`X-Ai-Surface: community`) mang `surface = 'community'`. Mở rộng CHECK của 0062
-- (thêm giá trị, không đổi dữ liệu; hàng cũ giữ nguyên). Chạy lại vô hại.
ALTER TABLE hub.conversations DROP CONSTRAINT IF EXISTS conversations_surface_ck;
--> statement-breakpoint
ALTER TABLE hub.conversations ADD CONSTRAINT conversations_surface_ck
  CHECK (surface IS NULL OR surface IN ('contracts', 'community'));