# Admin · Điều hướng khung quản trị theo vai

Cập nhật: 2026-11-09 · Gộp từ: cr121-r2-shell-tenants (đợt cr125-wave).

## Yêu cầu: Điều hướng khung quản trị theo vai (nguồn: cr121-r2-shell-tenants)
Công cụ AI là mục gốc (breadcrumb không có cấp Hệ thống); quản trị công ty không có mục Quy trình riêng ở thanh bên; URL cũ `workflow-tools` đưa quản trị công ty về tab Quy trình của công ty mình.
- Kịch bản: quản trị công ty thấy Tổng quan, Công ty, Hệ thống [test: apps/admin-web/src/features/shell/lib/nav.test.ts » tenant_admin: Tổng quan · Công ty · Hệ thống (không có Quy trình riêng, dùng Công ty › Quy trình)]
- Kịch bản: quản trị công ty mở URL cũ workflow-tools ⇒ tab Quy trình, quản trị nền tảng ⇒ Công cụ AI [test: apps/admin-web/src/features/tenants/lib/workspace-search.test.ts » CR-121 c16 · ?tab=workflow-tools cũ]
