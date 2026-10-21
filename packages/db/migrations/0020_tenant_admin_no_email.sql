-- tenant-owner · docs/specs/tenant-owner: chủ tenant (tenant_admin) được phép KHÔNG có email (tenant không bao giờ nhận mail).
-- Bỏ CHECK DB `users_tenant_admin_email_check` (0001). API giữ luật cũ (`isEmailRequired`): chỉ script tenant-owner-setup tạo
-- tenant_admin không email. Chỉ nới ràng buộc, không đổi dữ liệu.
ALTER TABLE admin.users DROP CONSTRAINT IF EXISTS users_tenant_admin_email_check;
