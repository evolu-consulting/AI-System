---
id: fix-cr181-web
lát: fix-cr181-web
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa lỗi web soát cuối CR-181: body ký khớp contract, câu lỗi nghiệp vụ, bật ký trên tài liệu lưu ngay, revoke blob.

## Làm
- [x] #1 body POST ký dùng SignSaveBody (caption boolean)
- [x] #5 12 mã lỗi có câu VI/EN, SIGN_VERSION_STALE tự tải lại
- [x] #4 nhãn issue ONDOC_NOT_ENABLED ở panel Ký qua (panel không biết cờ công ty ⇒ chỉ hiện khi kiểm/lưu)
- [x] #8 SignImg revoke blob
- [x] s5 xác nhận bật ký trên tài liệu ⇒ PUT ngay

## Không làm / Chạm
Chạm workspace-web (doc-sign, settings, contract-approval), packages/i18n, admin-web Panel (chỉ i18n). Không đổi contract.

## Test tối thiểu
bun test doc-sign + settings.

## Quyết định trong lúc làm
- Bật ký trên tài liệu lưu cả bản đã lưu + cờ; phần đang sửa dở khác bị nạp lại từ máy chủ.
- Panel admin không đọc được cờ công ty ⇒ không khoá mục, chỉ hiện issue.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/pack-contracts/ky-tren-tai-lieu-loi.md
#### Yêu cầu: Ký trên tài liệu nối API
Lưu chữ ký gửi cờ caption (true khi định dạng công ty có dòng dưới chữ ký); máy chủ tự dựng dòng chữ. Mỗi mã lỗi ký có câu nghiệp vụ; bản cũ tự tải lại phiên.
- Kịch bản: khi lưu chữ ký thì body qua được SignSaveBodySchema với caption boolean [test: apps/workspace-web/src/features/doc-sign/doc-sign-api.test.tsx » fix-cr181-web · body khớp schema contracts]
- Kịch bản: khi API trả lỗi ký thì hiện câu riêng, mã lạ ⇒ câu chung [test: apps/workspace-web/src/features/doc-sign/doc-sign-api.test.tsx » signErrorKey: mọi mã đã biết có câu riêng]

### ADDED docs/current/sht/cai-dat-chu-ky-bat-tren-tai-lieu.md
#### Yêu cầu: Bật ký trên tài liệu
Xác nhận xong thì lưu ngay công tắc và báo «Đã bật ký trên tài liệu», không cần bấm «Lưu định dạng».
- Kịch bản: khi xác nhận bật thì body PUT chỉ đổi cờ on_doc_enabled, đúng schema [test: apps/workspace-web/src/features/settings/signature-settings.test.tsx » onDocBody: chỉ đổi cờ trên bản đã lưu, đúng schema]
