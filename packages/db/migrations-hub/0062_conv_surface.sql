-- chat-api-gate-fix · hội thoại tạo qua dock trợ lý Sổ Hợp Tác (`X-Ai-Surface: contracts`) mang `surface = 'contracts'`.
-- Công ty không có Chat AI (`chat-app`) chỉ được gửi tin qua dock vào hội thoại có dấu này (hub-api `chat-gate`). Chỉ thêm
-- cột null + CHECK; hàng cũ = NULL (hội thoại chat thường). Chạy lại vô hại.
ALTER TABLE hub.conversations ADD COLUMN IF NOT EXISTS surface text;
--> statement-breakpoint
ALTER TABLE hub.conversations DROP CONSTRAINT IF EXISTS conversations_surface_ck;
--> statement-breakpoint
ALTER TABLE hub.conversations ADD CONSTRAINT conversations_surface_ck
  CHECK (surface IS NULL OR surface = 'contracts');
