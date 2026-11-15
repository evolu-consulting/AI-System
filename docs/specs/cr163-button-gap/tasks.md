---
id: cr163-button-gap
lát: cr163-button-gap
cr: CR-163
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Các nút cùng một hàng phải cách nhau (chuẩn `gap-2` = 8px; cụm nhỏ/icon tối thiểu `gap-1.5`). Form «Lưu báo giá» (Community) dính sát vì `.xf` không có CSS.

## Làm
- `bun run check:button-gap` (`tools/scripts/src/check-button-gap*.ts`): quét TSX web, báo container có ≥ 2 nút liền nhau mà không có `gap-*`/`space-x-*`/CSS gap-margin; chú thích `button-gap-ok` để bỏ qua có lý do.
- Footer dùng chung (Dialog/AlertDialog/Sheet) đã `gap-2`; thêm `gap-2` cho `CardFooter` (admin-web).
- Sửa chỗ vi phạm: workspace-web `.xf` (QuoteForm), web-kit `DateInput` chân lịch.

## Không làm / Chạm
Không đổi bố cục ngoài khoảng cách; không nối vào pre-commit; không sửa CONVENTIONS (điều phối ghi cuối đợt).

## Test tối thiểu
`tools/scripts/src/check-button-gap.test.ts`; `bun run check:button-gap`.

## Quyết định trong lúc làm
Chỉ xét thẻ HTML thường (div/span/...); component dùng chung tự lo gap ở định nghĩa. Nút xếp dọc (`flex-col`, `space-y-`, `w-full`) bỏ qua.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED ui/khoang-cach-nut.md
#### Yêu cầu: Nút cùng hàng có khoảng cách
- Kịch bản: khi hai nút nằm liền nhau trong một hàng flex không có gap thì kiểm check:button-gap báo lỗi [test: tools/scripts/src/check-button-gap.test.ts » đỏ: hai nút trong flex không gap]
- Kịch bản: khi hàng nút có gap-2 hoặc nút xếp dọc thì kiểm không báo lỗi [test: tools/scripts/src/check-button-gap.test.ts » xanh: có gap-2]

## Việc còn lại
Chụp lại baseline ảnh scene có form «Lưu báo giá» và popover chọn ngày (nếu có).
