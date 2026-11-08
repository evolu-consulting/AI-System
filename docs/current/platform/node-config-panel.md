# node config panel

Cập nhật: 2026-11-08 · Nguồn: cr122-u2f-esign-panel. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Panel cấu hình riêng của node module (FLOW2-FR-25)
Node có `config` trong manifest hiện panel với lựa chọn lấy từ `options_path`; ô trống ghi "Theo cài đặt ứng dụng"; cấu hình ghi vào `args` của stage; lỗi lưu chỉ đúng ô.
- Kịch bản: khi đặt cấu hình Ký số thì args hằng được ghi và đọc lại đúng, giữ nguyên `contract_id` [test: apps/admin-web/src/features/processes/lib/node-config.test.ts » cấu hình Ký số ⇄ args hằng, giữ nguyên arg khác (contract_id)]
- Kịch bản: khi server báo `FLOW_NODE_CONFIG_INVALID` thì lỗi gắn đúng ô theo `path` [test: apps/admin-web/src/features/processes/lib/node-config.test.ts » lỗi lưu theo ô]
