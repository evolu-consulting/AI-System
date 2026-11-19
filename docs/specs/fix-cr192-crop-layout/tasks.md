---
id: fix-cr192-crop-layout
lát: fix-cr192-crop-layout
cr: CR-192
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
e2e C1 đỏ: `me-avatar` lệch 18 px (trục x, không phải y). Gốc: test đo khi hộp cắt chưa đóng.

## Làm
- [x] `cr192-crop.cs.ts` C1: chờ `crop-dialog` đóng hẳn rồi mới so khung bao.

## Không làm / Chạm
Không đổi code sản phẩm. Chạm: `e2e/community-web/cr192-crop.cs.ts`, `tests/.lock`.

## Test tối thiểu
Không chạy e2e (điều phối chạy).

## Quyết định trong lúc làm
- Gốc: `ImagePick.confirm` chờ `onSave` xong mới `closeCrop`; ảnh mới hiện trong lúc hộp còn mở, Radix khoá cuộn (bỏ thanh cuộn) ⇒ nội dung nhích ~18 px. Hộp đóng thì bố cục về như cũ ⇒ code đúng BR-192-1, test đo sớm. Chưa xác nhận bằng chạy lại.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa thời điểm đo của test e2e).

## Việc còn lại
Điều phối chạy lại C1.
