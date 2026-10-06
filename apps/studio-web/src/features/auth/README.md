# features/auth

Đăng nhập Studio [HUB-FR-72] (H4a): dùng `admin-api POST /auth/login` + bước TOTP như Admin (QF2); không có login riêng của Hub.

- `api.ts`: `login`, `verifyTotp` (contract auth dùng chung).
- `pages/LoginPage.tsx` ghép `LoginForm` → `TotpForm`; xong ⇒ về `next` (kiểm `lib/auth/next.ts`, chống open redirect).
- `lib/login-error.ts`: mã lỗi đăng nhập → khoá i18n.
- Role khác `platform_admin` đăng nhập được nhưng `me` trả 403 ⇒ `/forbidden`.

Phụ thuộc: `src/lib/auth/session` (access token chỉ trong bộ nhớ; refresh bằng cookie `ai_rt` khi tải trang — cần `/auth` cùng origin, CR-044/U4).
