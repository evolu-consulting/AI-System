# settings-split · [CR-138b] Tách «Ký & đối tác» khỏi «Quy trình duyệt»

## Làm
- [x] Tab «Quy trình duyệt» chỉ còn quy trình đang áp dụng + Uỷ quyền khi vắng; tab mới «Ký & đối tác» (`?sec=sign`): Ký số, Người ký HĐ + tự trả việc, Đối tác xác nhận, mỗi khối một câu nói tác động bước nào.
- [x] Link cũ `{{path:flow}}` về ký số / người phụ trách nhận ⇒ `{{path:sign}}`; admin-web mở `?sec=sign`.
- [x] Bảng kiểm Đối tác xác nhận: bỏ `receive_template_id` / Gán mẫu Thư viện; thiếu quy trình Nhận ⇒ «Tạo quy trình Nhận HĐ ở trang Quy trình» (nút mở trang Quy trình); nhóm xác nhận đọc từ quy trình nhận của công ty.
- [x] Editor quy trình: cảnh báo (không chặn) `esign_off` / `partner_off` trong xem trước (khuôn `flow-preview`).

## Quyết định trong lúc làm
- Tab «Ký & đối tác» chỉ hiện với chủ sở hữu (mọi khối chỉ quản trị sửa; luật CR-138 ẩn tab chỉ đọc).
- «Gửi đối tác chưa sẵn» = công ty chưa được cấp tính năng `contracts-partner-confirm`; «ký số chưa bật» = `approval_settings.esign_enabled` false/vắng.
- `who` của mục `receive_flow` đổi platform ⇒ company (quản trị công ty tự tạo quy trình).
- Int test hub partner-confirm bỏ ca nhóm theo mẫu (không còn mẫu); luật nhóm vẫn có unit ở contracts. Chưa chạy int (cần evotest).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Tab «Ký & đối tác» tách khỏi «Quy trình duyệt»
«Quy trình duyệt» chỉ còn quy trình đang áp dụng (chỉ xem) và «Uỷ quyền khi vắng». Ký số, Người ký HĐ + thời gian tự trả việc, Đối tác xác nhận nằm ở tab «Ký & đối tác» (`?sec=sign`, chỉ chủ sở hữu thấy); mỗi khối có một câu nói nó dùng cho bước nào của quy trình. Link cũ trỏ tới các khối này trỏ tab mới.
- Kịch bản: khi mở khoá sec=sign thì vào tab Ký & đối tác và tab nằm trong 6 mục của chủ sở hữu [test: apps/workspace-web/src/features/settings/lib/section-key.test.ts » chủ sở hữu thấy đủ 6 mục]
- Kịch bản: khi người không phải chủ sở hữu mở Cài đặt thì chỉ thấy Quy trình duyệt, không thấy Ký & đối tác [test: apps/workspace-web/src/features/settings/components/SettingsNav.test.ts » CR-138 Q6]
- Kịch bản: khi câu hướng dẫn nhắc ký số thì đường dẫn là Cài đặt › Ký & đối tác [test: packages/i18n/src/settings-paths.test.ts » CR-138b · tab Ký & đối tác]
- Kịch bản: khi bật công tắc ký số ở tab Ký & đối tác thì lưu và tải lại vẫn bật [test: e2e/journey-approval/cr125-s2-settings-flow.spec.ts » 3 · công tắc ký số]

### MODIFIED sht/gui-doi-tac-dieu-kien-bat.md
#### Yêu cầu: Thiếu quy trình Nhận HĐ thì tạo ở trang Quy trình
Không còn mẫu Thư viện để gán: mục «quy trình nhận» do quản trị công ty tạo ở trang Quy trình (nút mở trang Quy trình), dùng chung ở Quản trị nền tảng và Cài đặt.
- Kịch bản: khi công ty chưa có quy trình nhận thì mục receive_flow còn thiếu, công ty làm, nút Mở Quy trình [test: packages/contracts/src/modules/partner-confirm.test.ts » chưa có flow nhận]
- Kịch bản: khi công ty có quy trình nhận của chính mình thì receive_flow xong [test: apps/hub-api/src/modules/processes/library/partner-confirm.int.test.ts » tạo quy trình nhận của chính công ty]

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Cảnh báo khi lưu quy trình có bước chưa sẵn
Quy trình có bước Ký số mà công ty chưa bật ký số, hoặc bước «Gửi đối tác xác nhận» mà tính năng đối tác chưa sẵn ⇒ cảnh báo trong xem trước (không chặn lưu).
- Kịch bản: khi công ty chưa bật ký số và chưa có tính năng đối tác thì xem trước báo hai cảnh báo đúng bước [test: apps/hub-api/src/modules/processes/domain/preview/flow-preview.test.ts » CR-138b · cảnh báo]

## Việc còn lại
- Int hub/admin-api partner-confirm chưa chạy (cần evotest). e2e chưa chạy.
