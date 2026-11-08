-- CR-125 · xoá công ty giữ lịch sử đối tác: `tenant-purge` đổi id của bên bị xoá trong hub.partner_mailbox / partner_links thành id giả (tombstone)
-- 00000000-0000-4000-8000-00000000dead (`PARTNER_DELETED_TENANT_ID` ở @ai/contracts/pack-contracts). Chặn dùng id đó làm tenant thật để dòng
-- ẩn danh không bao giờ trùng một công ty mới. Chỉ thêm ràng buộc; mọi dòng cũ thoả; chạy lại vô hại.
ALTER TABLE admin.tenants DROP CONSTRAINT IF EXISTS tenants_not_tombstone_ck;
--> statement-breakpoint
ALTER TABLE admin.tenants ADD CONSTRAINT tenants_not_tombstone_ck CHECK (id <> '00000000-0000-4000-8000-00000000dead'::uuid);
