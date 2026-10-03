# features/auth

Đăng nhập, đổi mật khẩu, trang member [ADM-FR-01] [ADM-FR-03].

- `api.ts`: nơi duy nhất gọi `/auth/*` (hiện có `patchMyLocale`; FE3 thêm các lệnh còn lại).
- `pages/`: khung trang `LoginPage`, `MemberPage`, `SelfPasswordPage` (FE1b); FE3 thay bằng màn thật.

## 2FA TOTP (ADM-FR-08)

- `pages/TwoFactorPage.tsx` (`/account/2fa`): bật (quét QR → nhập mã xác nhận → hiện mã dự phòng một lần), tắt (cần mật khẩu + mã), tạo lại mã dự phòng. Hooks: `use-totp-setup.ts`, `use-totp-manage.ts`; bước ở `components/totp/*` (`lib/totp-steps.ts`).
- Đăng nhập 2 bước: `login` trả `totp_required` → `LoginTotpStep` (mã 6 số tự gửi khi đủ, hoặc mã dự phòng) qua `hooks/use-totp-login.ts` (`INVALID_OTP` → báo sai mã; `TEMP_LOCKED` → giờ mở khoá; `INVALID_TOTP_TOKEN` → về form mật khẩu).
- Hộp thoại "Phiên đăng nhập đã hết hạn" (`features/shell/components/SessionExpiredGate.tsx`) dùng lại `LoginTotpStep` + `useTotpLogin`; quay lại từ bước mã → focus ô mật khẩu; tài khoản buộc đổi mật khẩu → báo `session.expired.changeRequired`, người dùng đăng xuất rồi đăng nhập lại.
