# L1b — Câu báo giới hạn đăng nhập trên 4 trang Đăng nhập (theo sau L1, TECH-DEBT #224)

Làn: nhanh (UI/nhãn), Luật 0b. Không đổi contract (dùng `AUTH_LIMIT_ERRORS` + `TEMP_LOCKED` của L1).

| # | Việc | Trạng thái |
|---|------|-----------|
| 1 | web-kit `auth-limit.ts`: `lockUntilClock(details)` (HH:MM giờ trình duyệt), `retryMinutes(details, Retry-After)`; `AuthErrorCode` thêm `RATE_LIMITED`, `AUTH_UNAVAILABLE` | xong |
| 2 | chat-web: `TEMP_LOCKED {until}` ⇒ alert "tạm khoá… thử lại sau HH:MM" (không `until` ⇒ hộp khoá như cũ); `RATE_LIMITED` ⇒ "N phút"; `AUTH_UNAVAILABLE` ⇒ tạm không khả dụng | xong |
| 3 | contracts-web: như chat-web (kết quả đổi từ key thành `{key, params}`) | xong |
| 4 | admin-web `describeError`/`describeLoginError` (cả bước TOTP, đổi mật khẩu): `auth.error.rateLimited {minutes}`, `auth.error.unavailable` | xong |
| 5 | studio-web `describeLoginError` (cả bước TOTP qua `classifyTotpError`): `login.err.rateLimited`, `login.err.unavailable` | xong |
| 6 | i18n vi/en: gốc, `studio/`, `chat/`, `contracts/`; `bun run i18n:check` OK | xong |
| 7 | Test: unit 4 app + web-kit; e2e chat-web `e2e/chat/login-limit.chat.ts` (giả `/auth/login` bằng page.route: 423/429/503) | xong |
| 8 | `.env.example`, `.env.production.example`, `docs/guides/deploy.md` §5: `REDIS_URL` (bắt buộc production), `TRUST_PROXY_HOPS`, `LOGIN_HASH_CONCURRENCY` | xong |

## Quyết định trong lúc làm
- Phút chờ lấy từ `details.retry_after_s` (có ở mọi app, kể cả admin-web/studio-web có `ApiError` riêng không đọc header); web-kit dự phòng bằng header `Retry-After`.
- chat-web/contracts-web: khoá tạm có giờ mở ⇒ câu trong vùng alert thay vì hộp "liên hệ quản trị" (khoá tạm tự mở); thiếu `until` ⇒ giữ hành vi cũ (test E-A6 khoá vẫn xanh).
- admin-web/studio-web không phụ thuộc web-kit ⇒ hàm `retryMinutes` nhỏ riêng trong `errors.ts` / `login-error.ts` (không thêm phụ thuộc gói).

## Kết quả
- Unit: 219 pass (4 app auth + web-kit); i18n:check OK; typecheck 4 app OK.
- e2e chat (local, cổng 3187/4087): `login-limit.chat.ts` 3/3 + `auth.chat.ts` 7/7.

## Việc còn lại
- Không có e2e cho admin-web/studio-web/contracts-web (unit đã phủ ánh xạ; e2e một app theo yêu cầu).
