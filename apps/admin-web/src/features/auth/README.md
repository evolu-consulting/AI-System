# features/auth

Đăng nhập, đổi mật khẩu, trang member [ADM-FR-01] [ADM-FR-03].

- `api.ts`: nơi duy nhất gọi `/auth/*` (hiện có `patchMyLocale`; FE3 thêm các lệnh còn lại).
- `pages/`: khung trang `LoginPage`, `MemberPage`, `SelfPasswordPage` (FE1b); FE3 thay bằng màn thật.
