---
id: fix-cr182-partner-mobile
lát: fix-cr182-partner-mobile
cr: CR-182
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Soát UI lượt 6 (`docs/specs/CR-181/uat-ui-review.md`, ảnh 530) ở 390px: «Chữ ký của tôi» xuống dòng và tràn khỏi ô trong khay; nút «Lưu (còn 1 chỗ chưa ký)» chiếm gần hết thanh trên. Sửa ở `SignTopBar` dùng chung ⇒ cả màn ký công ty và màn ký đối tác.

## Làm
- [x] `SignTopBar`: khay ≤ 640px chỉ hiện ảnh + «Của tôi» (đầy đủ còn trong tên truy cập), ô không tràn (`shrink-0`, `max-w-full`, tên người cắt `truncate`); nút Lưu có bản gọn «Lưu · còn n» (tên truy cập vẫn là nhãn đầy đủ), `px-3`.
- [x] `lib/save-label.ts` chọn khoá nhãn đầy đủ/gọn; `SignBody` và `SignWorkspace` truyền `saveShort`; khoá i18n `saveLeftShort`, `tray.mineShort` (vi, en).

## Không làm / Chạm
`PartnerSignBody` (lát `cr182-partner-web`, chưa gộp) cần truyền `saveShort` giống `SignBody` sau khi gộp. Vùng bấm giữ ≥ 44px nhờ `Button` / `max-sm:min-h-11` sẵn có.

## Test tối thiểu
- unit: `bun test apps/workspace-web/src/features/doc-sign/lib/save-label.test.ts`.

## Quyết định trong lúc làm
- Nhãn gọn đi bằng hai `span` đổi theo breakpoint (CSS) thay vì đo bề rộng trong JS; chữ đầy đủ vẫn là tên truy cập nên e2e `button { name: /^Lưu/ }` và khay «Chữ ký của tôi» không đổi.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Thanh trên màn ký gọn trên điện thoại
Ở màn hình ≤ 640px, khay chữ ký trên thanh trên của màn ký chỉ hiện ảnh chữ ký và chữ ngắn «Của tôi», không tràn khỏi ô; nút Lưu dùng nhãn gọn «Lưu · còn n» khi còn n chỗ chưa ký. Trên máy tính giữ nhãn đầy đủ «Chữ ký của tôi» và «Lưu (còn n chỗ chưa ký)».
- Kịch bản: khi còn chỗ chưa ký thì nút Lưu có nhãn gọn cho điện thoại [test: apps/workspace-web/src/features/doc-sign/lib/save-label.test.ts » ký còn chỗ chưa ký thì có nhãn gọn cho điện thoại]
- Kịch bản: khi ký đủ hoặc chuẩn bị chỗ ký thì giữ nhãn đã ngắn [test: apps/workspace-web/src/features/doc-sign/lib/save-label.test.ts » ký đủ hoặc chuẩn bị chỗ ký thì nhãn đã ngắn, không cần bản gọn]
