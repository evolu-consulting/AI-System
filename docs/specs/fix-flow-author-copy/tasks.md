# fix-flow-author-copy — chữ «ai soạn quy trình» theo CR-127

Người dùng chốt 2026-11-14: quy trình do **quản trị nền tảng** soạn ở admin platform rồi gán cho từng công ty; quản trị công ty chỉ xem (đúng `docs/current/engine/quy-trinh-cr127.md:9`). Thay câu cũ từ CR-125 («Quản trị công ty thêm và bật quy trình ở trang Quy trình»), bỏ luật CR-125 «không đẩy sang quản trị nền tảng».

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/cai-dat-va-quyen.md

#### Yêu cầu: Chưa có quy trình thì Cài đặt nói quản trị nền tảng soạn và gán
Công ty chưa có quy trình duyệt bật ⇒ Cài đặt › Quy trình duyệt nói «Quản trị nền tảng soạn và gán quy trình cho công ty — liên hệ quản trị nền tảng»; thiếu quy trình Nhận HĐ ⇒ «Quản trị nền tảng tạo và gán quy trình Nhận HĐ cho công ty».
- Kịch bản: khi công ty chưa có quy trình bật thì câu nói quản trị nền tảng soạn và gán [test: thủ công — chưa viết]

## Tasks
- [x] i18n `contracts.flow.current.noFlow` (vi/en), `partner…receive_flow.todo` (vi/en)
