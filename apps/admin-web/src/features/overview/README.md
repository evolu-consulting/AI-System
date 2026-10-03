# overview — Tổng quan `/` (ADM-FR-41, ADM-FR-42)
- `api.ts`: `useOverview()` → `GET /admin/overview` (union `kind: tenant | platform`).
- `pages/OverviewPage`: chọn bản theo role. `components/`: `TenantOverview`, `PlatformOverview`, `Panel` (section + lỗi/tải riêng), `NeverLoggedIn`, `RecentChanges`, `TenantQuotaCard`, `NearQuotaCard`, `HubCards` (Hub chưa có → "Sẽ có khi Agent Hub sẵn sàng.").
- Banner quota nằm ở `features/shell` (`QuotaBanner`).
