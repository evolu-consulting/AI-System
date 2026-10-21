-- portal-home: trang chủ AI System. "App mặc định" khi đăng nhập: cá nhân (users.default_app) và mặc định công ty (tenants.default_app).
-- NULL = vào trang chủ. Giá trị là key app trong admin.app_catalog (kiểm ở API lúc đặt, không FK: app có thể bị tắt/xoá ⇒ API coi như chưa đặt).
-- Chỉ cộng thêm; RLS/GRANT sẵn có của users/tenants áp nguyên cho cột mới.
ALTER TABLE admin.users ADD COLUMN IF NOT EXISTS default_app text;
--> statement-breakpoint
ALTER TABLE admin.users ADD CONSTRAINT users_default_app_check CHECK (default_app IS NULL OR default_app ~ '^[a-z0-9-]{2,32}$');
--> statement-breakpoint
ALTER TABLE admin.tenants ADD COLUMN IF NOT EXISTS default_app text;
--> statement-breakpoint
ALTER TABLE admin.tenants ADD CONSTRAINT tenants_default_app_check CHECK (default_app IS NULL OR default_app ~ '^[a-z0-9-]{2,32}$');