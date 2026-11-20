---
id: cr195-audience-picker
lát: cr195-audience-picker
cr: CR-195
làn: nhanh
migration: không
phụ thuộc: cr195-dialog
---
## Plan (ngắn)
BR-195-8: «Chọn công ty…» mở hộp chọn (tìm, ô chọn, «Xong (n)»), ngoài form chỉ tóm tắt + «Sửa». BR-195-9: sửa hàng chip loại bài điện thoại.

## Làm
- [x] `CompanyPickDialog.tsx` mới; `CompanyPicker.tsx` thành danh sách ô chọn, ô tìm lên hộp; `AudienceField.tsx` tóm tắt + «Sửa».
- [x] `mobile.css`: `.seg` trong hộp Viết bài `flex: 0 0 auto`, canh trái (nguyên nhân khoảng trống: `flex: 1 1 100%` của CR-186 phình theo chiều dọc).
- [x] i18n VI/EN: pickTitle, pickDone, edit, sumNone, sumSome.
- [x] e2e thêm 2 ca vào `cr195-composer-dialog.cm.ts` (viết, chạy 1 lượt).

## Không làm / Chạm
Không đổi contract/API «Ai thấy bài». Không sửa test khoá. Không dùng Command (kit không có): Dialog + Input + Checkbox.

## Test tối thiểu
e2e `e2e/community-web/cr195-composer-dialog.cm.ts`.

## Quyết định trong lúc làm
- Chọn «Chọn công ty…» tự mở hộp chọn; nút «Sửa» mở lại.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Hộp chọn công ty cho Ai thấy bài
Chọn «Chọn công ty…» mở hộp chọn có ô tìm, danh sách ô chọn, «Xong (n)»; trong form chỉ tóm tắt và «Sửa».
- Kịch bản: khi chọn công ty qua hộp thì form chỉ có tóm tắt và bài đăng hiện [test: e2e/community-web/cr195-composer-dialog.cm.ts » hộp Viết bài 1280px: chọn công ty qua hộp chọn, đăng bài, bài hiện]

### MODIFIED community/hien-thi.md
#### Yêu cầu: Hàng loại bài Viết bài điện thoại
Chip canh trái không bị cắt, ô viết sát ngay dưới và giãn.
- Kịch bản: khi mở ở 390px thì chip đầu trọn khung và ô viết sát dưới [test: e2e/community-web/cr195-composer-dialog.cm.ts » hộp Viết bài 390px: chip loại bài canh trái trọn khung, ô viết sát ngay dưới]
