# usage

FR: ADM-FR-42 (chi phí & usage, CSV), ADM-BR-09. Spec: `docs/specs/M4-ops/spec.md` M4-R01, R03, R07–R09; plan-contract §2.2; plan §5.4; plan-rules §A5.

| File | Vai trò |
|---|---|
| `usage.routes.ts` | `GET /admin/usage`, `GET /admin/usage.csv` (mount ở `/admin`, guard theo route); platform + tenant_admin, member 403 |
| `usage.service.ts` | khoảng/tenant (`resolve`), một `withScope` RR read-only, dựng bản Platform → `stripCost` + parse strict theo role; CSV + tên file |
| `usage.repo.ts` | SQL trên `hub.usage_logs` (KHÔNG RLS → luôn `tenant_id = $t` khi có tenant); ngày VN = `at` UTC + 420' |
| `usage.tenants.ts` | dòng `tenants[]` platform: usage khoảng + `quota_pct`/`level` tháng hiện tại |
| `usage.rules.ts` | thuần: `resolveUsageTenant`, `usageRange`, `csvColumns`, `toCsv` (BOM, CRLF, chống formula), `stripCost` |

Bẫy: run = `run_id` khác nhau (NULL không tính runs/overage_runs nhưng cộng token/USD) · `quotas` dùng `quotaStatuses` của module quotas (tháng hiện tại) · test đọc `res.text()` mất BOM (xem spec §10).
