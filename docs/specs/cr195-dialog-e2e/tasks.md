---
id: cr195-dialog-e2e
lát: cr195-dialog-e2e
cr: CR-195
làn: nhanh
migration: không
phụ thuộc: cr195-dialog
---
## Plan (ngắn)
e2e cr195-composer đỏ «Expected none» (bóng còn trên form). Nguyên nhân: UI, không phải test.

## Làm
- [x] `styles/mobile.css`: khối `.composedlg` viết dạng `[data-mod] .composedlg` nhưng `data-mod` và `composedlg` cùng một thẻ ⇒ selector không khớp, thẻ lồng + bố cục điện thoại không áp. Đổi thành `.composedlg[data-mod="community"]`.

## Không làm / Chạm
Không sửa test (kiểm đúng phần tử).

## Test tối thiểu
e2e `e2e/community-web/cr195-composer-dialog.cm.ts` (2 ca).

## Quyết định trong lúc làm
- Lỗi do UI thật (CSS không khớp), giữ nguyên test.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa CSS để đạt BR-195-2 đã ghi ở lát cr195-dialog; ô viết điện thoại cao tối thiểu 160px, giãn thêm theo chỗ trống).
