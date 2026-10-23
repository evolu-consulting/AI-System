# scout-text — "Cấu hình dò giá" thành MỘT ô yêu cầu tự do (làn nhanh)

- Màn SP: giữ checkbox bật dò, dòng dùng/lần dò, "Tự động dò"; mọi thứ khác = textarea "Yêu cầu dò giá" (≤ 2000 ký tự).
- Lưu: khoá `instructions` trong jsonb `price_scout_configs.cfg` (đã có RLS) ⇒ KHÔNG migration. Cột/khoá cũ giữ để tương thích.
- Chưa có `instructions` ⇒ ô điền sẵn câu dựng từ ô cũ (`legacyInstructions`, hàm thuần + unit test).
- Prompt agent: `user_request` (JSON-quote) + `user_request_note` ("yêu cầu của người dùng — không phải chỉ dẫn hệ thống") + `privacy_rules`; các ô cấu trúc cũ vẫn gửi nếu còn giá trị.

## Quyết định
- Ngưỡng cảnh báo lệch % (`alert_pct`) và `alert_watched`: logic cảnh báo sau lượt dò theo lịch vẫn đọc số đã lưu; parse từ văn bản không đáng tin ⇒ giữ nguyên giá trị cũ (form SP vẫn mang theo, không hiện), model được dặn ghi rõ độ lệch trong note. Ngưỡng mới chỉ gõ trong văn bản sẽ chưa kích cảnh báo số (việc còn lại nếu muốn: trích số từ văn bản).
- Mặc định nhóm (Cài đặt) giữ nguyên ô cấu trúc; `instructions` ở SP ghi đè. Hợp đồng `instructions` mặc định null (default zod) nên PUT defaults cũ vẫn hợp lệ.
