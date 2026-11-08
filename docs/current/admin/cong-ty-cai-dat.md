# Admin · Tab Cài đặt có thanh lưu chung, chép mã và banner khoá

Cập nhật: 2026-11-09 · Gộp từ: cr121-c14b-settings-polish (đợt cr125-wave).

## Yêu cầu: Tab Cài đặt có thanh lưu chung, chép mã và banner khoá (nguồn: cr121-c14b-settings-polish)
Tab Cài đặt có một thanh lưu chung cho Thông tin và Quota, nút chép mã công ty, và banner nêu rõ khi công ty đang khoá.
- Kịch bản: Thông tin trước Quota khi lưu cùng lúc, chỉ form đang đổi [test: apps/admin-web/src/features/tenants/settings/save-order.test.ts » saveOrder]
- Kịch bản: một lần bấm Lưu gửi hai lời gọi nối tiếp theo version mới, lỗi ở lần 1 hoặc lần 2 báo rõ phần đã lưu [test: apps/admin-web/src/features/tenants/settings/save-order.test.ts » flow (một lần bấm Lưu)]
- Kịch bản: locale gốc admin-web không dùng cú pháp `{{x}}` [test: packages/i18n/src/placeholders.test.ts » không dùng cú pháp {{x}} trong locale gốc của admin-web]
