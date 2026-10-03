# usage — Chi phí & quota (ADM-FR-42)

`/usage` (platform_admin: mọi tenant + "Theo tenant"; tenant_admin: tenant mình, không thấy chi phí thật/biên). Dữ liệu từ `GET /admin/usage` (+ `/admin/usage.csv`).

| File | Vai trò |
|---|---|
| `api.ts` | nơi duy nhất gọi API: `useUsage` (khoá `["usage", params]`), tải CSV qua `lib/download.ts` |
| `hooks/use-usage-view.ts` | tháng/khoảng ngày + tenant đang chọn (URL search), trạng thái đang tải/lỗi/rỗng |
| `lib/months.ts`, `lib/types.ts` | nhãn tháng, `deltaPct`; kiểu suy từ contract |
| `components/UsageKpis.tsx` | KPI Run/Token/Số thu (+ delta kỳ trước), "Chi phí thật"/"Biên" chỉ khi response có khoá; `kpi.unpriced_rows > 0` → note "Chưa định giá" |
| `components/UsageChart.tsx`, `TopLists.tsx`, `ByTenantTable.tsx`, `QuotaCard.tsx` | trình bày (không fetch), bọc `components/shared/panel/Panel` |

Lưu ý: top lists chưa có cờ "chưa định giá" theo dòng (contract) — xem `docs/specs/M4-ops/spec-decisions.md`. Sau khi lưu quota, `features/tenants/api.ts` invalidate `["usage"]`.
