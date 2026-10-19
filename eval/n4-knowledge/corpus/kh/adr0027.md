# ADR-0027 · Thư viện gửi email (SMTP) và Web Push cho cổng thông báo N3

Trạng thái: **Accepted** (2026-10-19, người dùng duyệt; đề xuất backend-lead N3) · Liên quan: spec [N3](../specs/N3-notify/spec.md) N3-FR-07, N3-FR-08, D-03; ADR-0001 (stack, pin chính xác)

## Bối cảnh
Cổng thông báo N3 gửi email và push web. Repo chưa có thư viện SMTP hay Web Push. Lát N3 dựng cổng, hàng đợi, thử lại, cách ly tenant và **transport giả**; transport thật cần thư viện ngoài ADR-0001 nên dừng ở đây chờ duyệt.

## Lựa chọn
| Phương án | Được | Mất |
|---|---|---|
| A. `nodemailer` (SMTP) + `web-push` | Phổ biến, đã kiểm chứng; `web-push` lo VAPID + mã hóa `aes128gcm` (RFC 8291) | Cần kiểm tương thích Bun (cả hai dùng `node:net/tls/crypto`); `nodemailer` ~0 phụ thuộc, `web-push` kéo `asn1.js`, `http_ece`, `jws` |
| B. Tự viết bằng `node:net/tls` + `node:crypto` | 0 phụ thuộc mới | SMTP (STARTTLS, AUTH, dot-stuffing, mã trả lời nhiều dòng) và mã hóa Web Push là mã mật mã/giao thức tự bảo trì — rủi ro cao |
| C. Dịch vụ HTTP (SES/Resend + FCM) | Không giữ SMTP | Dịch vụ trả tiền, secret thật ⇒ hard stop Luật 2 |

## Quyết định (phương án A, đã duyệt)
Phương án A, pin chính xác bản ≥ 2 tuần tuổi; đặt adapter ở `apps/hub-api/src/modules/notify/adapters/` (lớp 3) sau cổng `EmailTransport`/`PushTransport` đã có; thêm smoke test với SMTP/push mock trước khi bật `HUB_NOTIFY_MODE=live`. Secret: kind `smtp_password`, `vapid_private_key` trong `hub.secrets`; phần không bí mật (host, cổng, người gửi, khóa công khai VAPID, subject) ở env.

## Hệ quả
Đã cài trong `apps/hub-api` (pin chính xác): `nodemailer` 10.0.14 (2026-10-03; bản 10.1.x mới hơn < 2 tuần), `web-push` 3.6.7, kiểu `@types/nodemailer` 8.0.2, `@types/web-push` 3.6.4. Adapter `smtp.transport.ts`, `webpush.transport.ts` (lớp 3) sau cổng `EmailTransport`/`PushTransport`; `HUB_NOTIFY_MODE=live` khởi động được.
Cấu hình tạm (người dùng 2026-10-19 "tạm hardcode"): MỘT bộ SMTP nền tảng, host/cổng/secure/from là biến `HUB_SMTP_*` với mặc định cố định trong config; mật khẩu chỉ từ env `SMTP_PASSWORD`, nếu vắng thì kho secret `smtp_password`; khoá VAPID cùng cách (`HUB_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` hoặc `vapid_private_key`). Không có bí mật trong mã, `.env` đã commit, test hay log. SMTP riêng từng tenant = nợ (TECH-DEBT).
