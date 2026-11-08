# Admin · Cấu hình gửi mail chỉ có một nguồn là kho secret của Hub

Cập nhật: 2026-11-09 · Gộp từ: cr121-c21-mail-config (đợt cr125-wave).

## Yêu cầu: Cấu hình gửi mail chỉ có một nguồn là kho secret của Hub (nguồn: cr121-c21-mail-config)
Máy chủ gửi, cổng, tài khoản, địa chỉ người gửi và mật khẩu mail được lưu trong kho secret của Hub (secret nền tảng). Biến môi trường mail cũ chỉ dùng để khởi tạo kho đúng một lần khi kho chưa có cấu hình; sau đó không đọc lại và không ghi đè cấu hình đã có. Mọi email của hệ thống được gửi theo cấu hình trong kho. Khi kho chưa có cấu hình mail, trang Tình trạng hệ thống hiện cảnh báo "Chưa cấu hình mail" kèm cách sửa, nhưng hệ thống vẫn khởi động bình thường.
- Kịch bản: khi kho secret chưa có cấu hình mail và môi trường có mật khẩu mail thì lần khởi động đầu chép cấu hình vào kho, lần sau với giá trị khác không ghi đè, và cấu hình đọc lại đúng [test: apps/hub-api/src/modules/notify/adapters/mail-config.int.test.ts » kho trống ⇒ seeded (đọc lại đúng), lần 2 giá trị khác ⇒ exists, KHÔNG ghi đè]
- Kịch bản: khi người vận hành đã tạo sẵn cấu hình mail trong kho thì khởi tạo từ môi trường không thêm hay đổi gì [test: apps/hub-api/src/modules/notify/adapters/mail-config.int.test.ts » đã có secret mail sẵn (tên khác do người vận hành tạo) ⇒ giữ nguyên, seed không thêm hàng]
- Kịch bản: khi hai máy chủ Hub khởi động cùng lúc thì kho chỉ có một cấu hình mail [test: apps/hub-api/src/modules/notify/adapters/mail-config.int.test.ts » hai instance seed đồng thời ⇒ đúng một hàng]
- Kịch bản: khi kho chưa có cấu hình mail thì kiểm tra vận hành báo cảnh báo "Chưa cấu hình mail", có cấu hình thì hết cảnh báo [test: apps/hub-api/src/modules/notify/adapters/mail-config.int.test.ts » kho trống ⇒ warn 'Chưa cấu hình mail', sau seed ⇒ ok]
- Kịch bản: khi giá trị cấu hình mail trong kho sai định dạng thì báo lỗi cấu hình không lộ giá trị [test: apps/hub-api/src/modules/notify/adapters/mail-config.test.ts » không phải JSON / thiếu trường / thừa trường / sai kiểu ⇒ MailConfigInvalid, message không chứa giá trị]
