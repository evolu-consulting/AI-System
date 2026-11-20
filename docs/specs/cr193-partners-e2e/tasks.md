---
id: cr193-partners-e2e
lát: cr193-partners-e2e
cr: CR-193
làn: nhanh
migration: không
phụ thuộc: cr193-partners
---
## Plan (ngắn)
Sửa bộ chọn e2e theo trang Đối tác mới: «Ngắt kết nối» nằm trong danh sách «Đang kết nối» (mở bằng `connected-toggle`); băng lời mời ở trang Đối tác là `connect-request`.

## Làm
- [x] cr161 J7, cr169 C3 + J8: mở danh sách trước khi bấm «Ngắt kết nối với …».
- [x] flows3 FL3-4, prod-journey `_kit`, smoke-journey: `connect-invite` ⇒ `connect-request`.

## Không làm / Chạm
cr127 j06 (form hợp đồng, không phải trang Đối tác) — không sửa.

## Test tối thiểu
Không chạy e2e (điều phối chạy); `test:lock:verify`.

## Quyết định trong lúc làm
Không đổi code ứng dụng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa bộ chọn e2e)

## Việc còn lại
Điều phối chạy lại cr161, cr169, flows3.
