# tenants

FR: ADM-FR-60 (CRUD tenant, không có Xoá; tạo kèm tenant_admin đầu tiên + mật khẩu tạm một lần), ADM-FR-61 (khoá/mở khoá).
Spec: `docs/specs/M1-foundation-identity/spec.md` §3 (`/admin/tenants*`), M1-R10, R15, R18, R19; plan §5.

| File | Vai trò |
|---|---|
| `tenants.routes.ts` | `requireAuth` + `requireRole("platform_admin")` cho mọi route; parse contract → service |
| `tenants.service.ts` | một `withScope(platform)` mỗi hành động; gọi `users.service` (first admin, `locked_by_tenant`) và `auth.service` (thu hồi phiên) |
| `tenants.repo.ts` | list (`count(*) over()` + `counts`), `user_count`, stats, insert/update |
| `tenants.rules.ts` | `canManageTenants`, `checkTenantLock`, `tenantStatus`, `changedTenantFields` |

Luật: `version` lệch → 409 `VERSION_CONFLICT {current, updated_at}`; PATCH/lock/unlock không đổi gì → không tăng `version`.
`key` trùng → 23505 `tenants_key_uq` → 409 `KEY_TAKEN`. Khoá `platform` → 409 `PLATFORM_TENANT_LOCKED`.
