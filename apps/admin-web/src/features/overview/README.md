# overview — Tổng quan `/` (ADM-FR-41, ADM-FR-42, CR-121 C-3b)
- `api.ts`: `useOverview()` → `GET /admin/overview` (tenant_admin); `useOpsOverview()` → Hub `GET /ops/overview` (platform_admin).
- `pages/OverviewPage`: platform_admin → `components/ops/OpsBento` (bento: lượt chạy 24 giờ + 5 ô số liệu + Cần xử lý ngay + Sức khoẻ hệ thống); tenant_admin → `TenantOverview`.
- `lib/ops-overview.ts`: hàm thuần (định dạng, so hôm qua, xu hướng, cột giờ, mục cần xử lý, mức sức khoẻ). `components/ops/charts.tsx`: SVG/CSS, không thư viện biểu đồ.
- Còn lại: `Panel`, `NeverLoggedIn`, `RecentChanges`, `TenantQuotaCard` (bản tenant). Banner quota nằm ở `features/shell` (`QuotaBanner`).
