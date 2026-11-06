---
id: cr122-u2f-esign-panel
lát: cr122-u2f-esign-panel
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: cr122-e5-esign-node-config, cr122-e5b
---
## Plan (ngắn)
Panel cấu hình riêng của node module theo manifest `config { stage, options_path }` (Ký số trước): nhà cung cấp, người ký công ty (≤ 3), đối tác ký, thứ tự, hạn, nhắc; ô trống = "Theo cài đặt ứng dụng"; kiểm trực tiếp bằng `node-config/check`; lỗi lưu `FLOW_NODE_CONFIG_INVALID` chỉ đúng ô.

## Làm
- `lib/node-config.ts` (đường kiểm suy từ `options_path`, đọc/ghi `executor.args` hằng, bộ mã hoá `NODE_CONFIGS`; Ký số dùng `encode/decodeEsignNodeArgs`), `components/flow/NodeConfigPanel.tsx` (lấy lựa chọn từ `options_path`, kiểm mỗi lần cấu hình đổi, hạn ký ⇒ đặt `timeout_h` stage chờ qua `FlowCtx.patchStage`), nối vào `ModuleBody` (chỉ stage `config.stage` dạng tool). Các mục kỹ thuật vẫn ở "Nâng cao".
- `errors.ts` `nodeConfigErrors` + `use-def-save` (422 `FLOW_NODE_CONFIG_INVALID`, `details.issues[{path,code}]`, path `stages.<i>.executor.args.<khoá>`); i18n vi/en `process.admin.flow.esign.*` + `apiError.FLOW_NODE_CONFIG_INVALID`.

## Không làm / Chạm
- Người cụ thể chỉ liệt kê tối đa 50 thành viên đầu của công ty (danh sách người dùng admin); chưa có ô tìm.
- Kiểm "trước khi Lưu" là kiểm trực tiếp mỗi lần đổi ô (không chặn nút Lưu); server vẫn chặn khi lưu.
- Người dùng nền tảng sửa Thư viện không gọi được `options` (gói theo công ty) ⇒ panel báo "mở bản của công ty"; chụp bằng tenant_admin trên bản công ty.
- Ảnh `u2f-ky-so-panel.png` dùng `options` GIẢ LẬP (UAT chưa bật ký số: hub thật trả `enabled:false`, ảnh thật `u2f-ky-so-chua-bat-ky-so.png`).

## Test tối thiểu
`bun test apps/admin-web/src/features/processes/lib/node-config.test.ts` xanh (đường kiểm, mã hoá ⇄ args giữ `contract_id`, lỗi lưu theo ô).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED platform/node-config-panel.md
#### Yêu cầu: Panel cấu hình riêng của node module (FLOW2-FR-25)
Node có `config` trong manifest hiện panel với lựa chọn lấy từ `options_path`; ô trống ghi "Theo cài đặt ứng dụng"; cấu hình ghi vào `args` của stage; lỗi lưu chỉ đúng ô.
- Kịch bản: khi đặt cấu hình Ký số thì args hằng được ghi và đọc lại đúng, giữ nguyên `contract_id` [test: apps/admin-web/src/features/processes/lib/node-config.test.ts » cấu hình Ký số ⇄ args hằng, giữ nguyên arg khác (contract_id)]
- Kịch bản: khi server báo `FLOW_NODE_CONFIG_INVALID` thì lỗi gắn đúng ô theo `path` [test: apps/admin-web/src/features/processes/lib/node-config.test.ts » lỗi lưu theo ô]

## Việc còn lại
Ô tìm người ký; nối kiểm vào nút Lưu nếu cần chặn cứng.
