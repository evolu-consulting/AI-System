# features/tenants

Quản lý tenant [ADM-FR-60] [ADM-FR-61]; chỉ `platform_admin` (tenant_admin thấy 403 trong khung).

- `api.ts`: hook TanStack Query cho `/admin/tenants*` (list, detail, create, update theo `version`, lock/unlock).
- `pages/`: `TenantsPage` (chip trạng thái có số lấy từ `counts`, ô tìm, bảng), `TenantCreatePage` (+ hộp thoại mật khẩu tạm), `TenantDetailPage` (tab Thông tin/Feature/Agent/Quota/Users).
- `hooks/use-lock-flow.tsx`: xác nhận (gõ lại key khi khoá) + gọi API + toast, dùng cho danh sách và chi tiết.
- `lib/schemas.ts`: schema form (hằng số từ `@ai/contracts`, thông điệp là key i18n).
