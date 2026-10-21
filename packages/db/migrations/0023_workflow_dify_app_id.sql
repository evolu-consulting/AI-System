-- dify-workflows · "Mở trong Dify": mã app Dify (UUID) của workflow để dựng link console `${DIFY_CONSOLE_URL}/app/<id>/…`.
-- Cột nullable, không đổi dữ liệu cũ; vắng ⇒ không hiện nút. Không phải bí mật (khác app-key).
ALTER TABLE admin.workflows ADD COLUMN IF NOT EXISTS dify_app_id text;
--> statement-breakpoint
ALTER TABLE admin.workflows DROP CONSTRAINT IF EXISTS workflows_dify_app_id_check;
--> statement-breakpoint
ALTER TABLE admin.workflows ADD CONSTRAINT workflows_dify_app_id_check
  CHECK (dify_app_id IS NULL OR dify_app_id ~ '^[A-Za-z0-9-]{1,64}$');