# Các route đối tác chỉ mở khi công ty bật tính năng Gửi đối tác xác nhận

Cập nhật: 2026-11-08 · Nguồn: CR-124/125.

## CR-124/125 · Delta gộp 2026-11-08 (đợt cr124-cr125)

#### Yêu cầu: Các route đối tác chỉ mở khi công ty bật tính năng Gửi đối tác xác nhận (nguồn: cr124-q7-gating)
Tắt tính năng ⇒ mọi `/pack/contracts/partner/*` trả 403 với câu «Công ty chưa bật Gửi đối tác xác nhận».
- Kịch bản: khi công ty chưa bật tính năng thì mọi route đối tác trả 403 PARTNER_FEATURE_OFF [test: apps/hub-api/src/modules/packs/contracts/partner-routes.gate.test.ts » công ty chưa bật ⇒ 403 PARTNER_FEATURE_OFF + câu nghiệp vụ cho MỌI route đối tác]

#### Yêu cầu: Tool Gửi đối tác từ chối rõ ràng khi chưa bật tính năng hoặc kênh hệ thống tắt (nguồn: cr124-q7-gating)
Run chuyển «cần quyết định» với lý do trên thẻ; không ghi hàng mailbox/lần gửi/lời mời mồ côi.
- Kịch bản: khi kênh hộp thư tắt thì tool ném PARTNER_CHANNEL_OFF và không ghi gì [test: apps/hub-api/src/modules/packs/contracts/partner-gating.int.test.ts » kênh hộp thư TẮT trên hệ thống]
- Kịch bản: khi công ty chưa bật tính năng thì tool ném PARTNER_FEATURE_OFF và không ghi gì [test: apps/hub-api/src/modules/packs/contracts/partner-gating.int.test.ts » công ty chưa bật tính năng]
