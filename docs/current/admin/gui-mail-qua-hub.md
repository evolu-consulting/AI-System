# Admin · Admin gửi mail qua Hub, cấu hình mail chỉ ở kho secret

Cập nhật: 2026-11-09 · Gộp từ: cr121-c21b-admin-mailer (đợt cr125-wave).

## Yêu cầu: Admin gửi mail qua Hub, cấu hình mail chỉ ở kho secret (nguồn: cr121-c21b-admin-mailer)
Các email do Admin phát (cảnh báo hạn mức…) được gửi thông qua Hub, dùng đúng cấu hình mail trong kho secret của Hub. Admin không còn tự giữ cấu hình máy chủ gửi mail. Chỉ dịch vụ Admin (có token dịch vụ) gọi được đường gửi này; người khác bị từ chối và không có thư nào được gửi. Khi kho chưa có cấu hình mail thì thư không gửi được, cảnh báo hạn mức được giữ lại để gửi sau.
- Kịch bản: khi kho secret có cấu hình mail và Admin gọi Hub kèm token dịch vụ thì mọi người nhận đều được gửi bằng máy chủ và địa chỉ người gửi trong kho [test: apps/hub-api/src/modules/internal/mail-relay.int.test.ts » đường chính: kho có cấu hình ⇒ 200 {sent:2}, host/from/mật khẩu lấy từ kho]
- Kịch bản: khi người gọi không phải dịch vụ Admin (thiếu hoặc sai token) thì bị từ chối và không có thư nào được gửi [test: apps/hub-api/src/modules/internal/mail-relay.int.test.ts » người gọi không phải dịch vụ admin ⇒ 401, KHÔNG gửi (thiếu header, sai scheme, sai token, JWT)]
- Kịch bản: khi Hub chưa có token dịch vụ thì đường gửi không dùng được và thân thư sai bị từ chối [test: apps/hub-api/src/modules/internal/mail-relay.int.test.ts » Hub chưa cấu hình token dịch vụ ⇒ 503 kể cả khi gửi token, thân sai ⇒ 400]
- Kịch bản: khi kho chưa có cấu hình mail thì Hub báo chưa cấu hình và Admin coi là mail đang tắt [test: apps/hub-api/src/modules/internal/mail-relay.int.test.ts » kho trống ⇒ 409 NOT_CONFIGURED (không gửi)]
- Kịch bản: khi Hub báo lỗi gửi hoặc mất kết nối thì Admin báo gửi thất bại, còn khi Hub báo chưa cấu hình thì Admin báo mail tắt [test: apps/admin-api/src/lib/mailer/mailer.test.ts » Hub 409 NOT_CONFIGURED ⇒ MAIL_DISABLED, Hub 502/lỗi mạng ⇒ MAIL_SEND_FAILED]
