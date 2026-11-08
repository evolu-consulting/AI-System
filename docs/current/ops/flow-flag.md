# flow flag

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Cảnh báo cấu hình quy trình nửa vời (nguồn: cr125-g8-flow-flag)
Ops-watch có check `flow_flag`: công ty có quy trình được gán đang bật (`company_flows.enabled`) mà cờ dùng quy trình mới (`tenant_flow_settings.flow_triggers`) tắt hoặc chưa có ⇒ cảnh báo nêu tên công ty và cách xử lý; không còn ⇒ ok.
- Kịch bản: khi công ty có dòng gán đang bật nhưng cờ tắt/vắng thì check cảnh báo, bật cờ thì ok [test: apps/hub-api/src/modules/ops/ops.flow-flag.int.test.ts » gán bật mà cờ tắt/vắng ⇒ warn nêu đúng 2 công ty, bật cờ ⇒ ok]

