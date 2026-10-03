# audit

FR: ADM-FR-51 (đọc nhật ký), ADM-FR-52 (khôi phục), ADM-BR-09.
Spec: `docs/specs/M4-ops/plan-contract.md` §2.4, `plan.md` §4.3–4.4, `plan-rules.md` §A2–A3. Ghi audit ở `lib/audit/`.

| File | Vai trò |
|---|---|
| `audit.routes.ts` | `requireRole(platform_admin, tenant_admin)`; restore thêm `requireRole(platform_admin)` trước khi tra |
| `audit.service.ts` | `resolveAuditFilter` → 404; `auditRange`; cursor sai → 400; `restorable` = `canRestore(actor.role, row)`; summary lọc theo khoá contract |
| `audit.repo.ts` | một `withScope` actor (RLS) + `tenant_id` tường minh; keyset `seq < cursor` desc `limit n+1`; `seq::text` |
| `audit.restore.ts` | `POST /:id/restore`: một `configWrite` → tra dòng (scope all) → `canRestore` → adapter `modules/<m>/<m>.restore.ts` chạy lõi tx PATCH/POST/PUT của module; sink đổi audit thành `restore` (+`restored_from/restored_version`, id đặt trước = `audit_id`); quota → `evaluateLater` |
| `audit.restore-kit.ts` | `restoreMode` (`restoreCheck`), dựng request từ `before` qua zod, `NAME_TAKEN`/`RESTORE_REF_MISSING`, `keepExisting` |
| `audit.rules.ts` | `resolveAuditFilter`, `canRestore`, `restoreCheck`, `encode/decodeCursor`, `auditRange` (ngày VN) |

Bẫy: `audit_log.seq` Drizzle `mode:"number"` — luôn đọc `seq::text` cho cursor, so sánh `::bigint`.
Bẫy restore: lõi module không gọi `ch.audit` (no-op) → NOT_RESTORABLE; VERSION_CONFLICT do lõi PATCH ném dưới khoá (không tự so trước).
