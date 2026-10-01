# users

FR: ADM-FR-04 (list/tạo/sửa/reset mật khẩu), ADM-FR-05 (khoá/mở khoá, đăng xuất mọi thiết bị), ADM-FR-63 (username unique trong tenant), BR-05, BR-08, BR-09.
Spec: `docs/specs/M1-foundation-identity/spec.md` §3 (`/admin/users*`), M1-R09…R17; plan §4–§5.

| File | Vai trò |
|---|---|
| `users.routes.ts` | `requireAuth` + `requireRole(platform_admin, tenant_admin)`; parse contract → service |
| `users.service.ts` | một `withScope` mỗi hành động; BR-08 dưới `SELECT … FOR UPDATE` hàng `tenants`; `createFirstAdmin`/`setTenantLockFlags` cho module tenants |
| `users.repo.ts` | list (`count(*) over()` + `counts` trừ `status`), đếm admin còn lại, insert/update |
| `users.rules.ts` | luật thuần: role gán được, tự thao tác, LAST_ADMIN, phạm vi tenant, `bumpsVersion` |

Cách ly: tenant_admin luôn lọc `tenant_id` của mình (bỏ qua `?tenant_id=`) + RLS; user tenant khác, id lạ, id sai uuid → cùng 404.
Lặp lock/unlock không tăng `version`; unlock xoá khoá tạm, không gỡ `locked_by_tenant`. Thu hồi phiên qua `auth.service`.
Hiệu năng: `users.perf.int.test.ts` (5.000 user, p95 `GET /admin/users` < 100 ms, `POST /auth/login` < 150 ms).
