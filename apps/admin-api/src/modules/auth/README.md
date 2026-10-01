# auth

FR: ADM-FR-01 (đăng nhập), 02 (refresh xoay vòng), 03 (đăng xuất), 06 (đổi mật khẩu, `/auth/me`), 07 (khoá tạm), NFR-01.
Spec: `docs/specs/M1-foundation-identity/spec.md` §3, plan §4–§5.

| File | Vai trò |
|---|---|
| `auth.routes.ts` | `/auth/login`, `/refresh`, `/logout`, `/change-password` (bắt buộc). Cookie `ai_rt` cho web, body cho `X-Client: extension` |
| `auth.me.routes.ts` | `GET/PATCH /auth/me`, đổi mật khẩu tự đổi (cần Bearer) |
| `auth.service.ts` | luồng nghiệp vụ; mỗi bước DB = một `withScope` |
| `auth.session.ts` | phát refresh token (DB chỉ lưu SHA-256) + access token, `toMe` |
| `auth.repo.ts` | query Drizzle, luôn lọc `tenant_id`; 2 hàm SECURITY DEFINER trước khi biết tenant |
| `auth.rules.ts` | luật thuần (khoá tạm, phân loại refresh, mật khẩu tạm) |

Phụ thuộc: `@ai/db` (`withScope`, `hashPassword/verifyPassword`), `lib/{jwt,http,cookie,errors}`.
Thời gian: khoá tạm và `last_login_at` theo `deps.now` (test điều khiển được); token theo `now()` của DB.
Env cần: `ADMIN_API_DATABASE_URL` (role `admin_api`), `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KID`. `.env.local` cũ thiếu `ADMIN_API_DATABASE_URL` → chép dòng từ `.env.example`.
