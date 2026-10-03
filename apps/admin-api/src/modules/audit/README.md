# audit

FR: ADM-FR-51 (đọc nhật ký), ADM-FR-52 (khôi phục — T2b), ADM-BR-09.
Spec: `docs/specs/M4-ops/plan-contract.md` §2.4, `plan.md` §4.3–4.4, `plan-rules.md` §A2–A3. Ghi audit ở `lib/audit/`.

| File | Vai trò |
|---|---|
| `audit.routes.ts` | `requireRole(platform_admin, tenant_admin)`; restore thêm `requireRole(platform_admin)` trước khi tra |
| `audit.service.ts` | `resolveAuditFilter` → 404; `auditRange`; cursor sai → 400; `restorable` = `canRestore(actor.role, row)`; summary lọc theo khoá contract |
| `audit.repo.ts` | một `withScope` actor (RLS) + `tenant_id` tường minh; keyset `seq < cursor` desc `limit n+1`; `seq::text` |
| `audit.rules.ts` | `resolveAuditFilter`, `canRestore`, `restoreCheck`, `encode/decodeCursor`, `auditRange` (ngày VN) |

Bẫy: `audit_log.seq` Drizzle `mode:"number"` — luôn đọc `seq::text` cho cursor, so sánh `::bigint`.
