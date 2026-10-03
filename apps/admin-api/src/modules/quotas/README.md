# quotas

FR: ADM-FR-40 (quota tháng tenant/feature), ADM-FR-41 (cảnh báo 80/100, banner — T4). Q9 (quota thuộc tenant).
Spec: `docs/specs/M4-ops/spec.md` M4-R01–R06, R10; plan-contract §2.1; plan §4.2, §5.1–5.2, §6 (hạng 11a).

| File | Vai trò |
|---|---|
| `quotas.routes.ts` | `GET/PUT /admin/tenants/:id/quotas`; GET platform + tenant_admin (tenant mình, khác → 404), PUT platform. Mount **trước** `tenantsRoutes` (middleware chỉ-platform `*`) |
| `quotas.service.ts` | GET dựng `QuotaSetResponse`; PUT thay cả bộ theo version tenant, no-op không bump/audit/NOTIFY/evaluate; đổi → `void evaluateTenant(...).catch(log)` sau commit |
| `quotas.repo.ts` | tenant NKU → features SHARE id tăng → delete+insert → bump tenant; mức dùng tháng một câu `grouping sets` |
| `quotas.rules.ts` | thuần: `monthRange` (VN), `quotaPct` (micro-USD BigInt), `evaluateQuota`, `alertsDue`, `bannerFor`, normalize/so bộ |
| `quotas.evaluator.ts` | `evaluateTenant` — stub no-op tới T4 |

Bẫy: `ch.changed` luôn đi cặp `ch.audit` (bất biến configWrite); nhánh no-op không gọi cả hai. `max_usd` so sau `canonicalUsd` ("300" = "300.00"). `has_usage_data` = `usage_logs` có hàng nào (toàn bảng, M4-R09).
