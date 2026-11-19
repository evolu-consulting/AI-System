---
id: fix-cr191-partners-search-mobile
lát: fix-cr191-partners-search-mobile
cr: CR-191
làn: nhanh
migration: không
phụ thuộc: fix-cr191-partners-ui
---
## Plan (ngắn)
Soát UI (G3): trên điện thoại «Tìm công ty» (thao tác chính của trang Đối tác) bị giấu sau «⋯». Hiện thành nút ở đầu trang.

## Làm
- [x] `PageHeaderAction.pinMobile` (web-kit `page-header.tsx`): nút phụ đánh dấu ghim hiện thành nút (icon + nhãn, `min-h-11` có sẵn của Button) dưới nút chính trên điện thoại, không vào «⋯»; «⋯» chỉ vẽ khi còn nút phụ khác. Luật thuần `page-header-actions.ts` + unit.
- [x] `PartnersPage`: «Tìm công ty» có icon tìm và `pinMobile`.

## Không làm / Chạm
Desktop giữ nguyên (nút `quiet` cạnh nút chính). Không đổi quyền: người không được mời vẫn mở hộp tìm (chỉ thấy đối tác đã kết nối, BR-191-9).

## Test tối thiểu
unit `page-header-actions.test.ts`; e2e `e2e/contracts-web/cr191-search-mobile.cw.ts` (xanh) + `mobile-rules.cw.ts` 13 ca «4 luật mobile» xanh (chạy bằng grep tạm, đã gỡ).

## Quyết định trong lúc làm
- Thêm khả năng `pinMobile` vào PageHeader dùng chung thay vì làm riêng cho trang Đối tác (RULES.md mục 3 vẫn đúng: nút phụ vào «⋯», trừ thao tác chính đánh dấu ghim).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đổi chỗ hiện nút «Tìm công ty» trên điện thoại).

## Việc còn lại
