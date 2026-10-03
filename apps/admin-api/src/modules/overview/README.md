# overview

FR: ADM-FR-44 (Tổng quan), ADM-FR-40, ADM-FR-51, ADM-BR-09. Spec: `docs/specs/M4-ops/` plan-contract §2.3, plan §5.5, ui 7.2, Q5.

| File | Vai trò |
|---|---|
| `overview.routes.ts` | `GET /admin/overview` (mount `/admin`, guard theo route); tenant_admin kích `evaluateThrottled` |
| `overview.service.ts` | một `withScope` RR read-only; `kind` theo role; parse `OverviewResponseSchema` |
| `overview.repo.ts` | đếm users/groups/catalog/tenants, never-logged-in, `runs_24h`, tenant có quota |
| `overview.rules.ts` | thuần: `rankQuotaTenants` (level ≠ none, pct giảm rồi key, ≤ 10) |

Bẫy: `hub.usage_logs` không RLS → nhánh tenant luôn `tenant_id = actor.tenantId` · tenant `platform` không tính vào `tenants_active`/`users_active` · `command_errors`/`agent_studio` luôn trong `unavailable` (chưa đọc `hub.runs`, TECH-DEBT #30).
