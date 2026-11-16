---
id: cr180-pages-a
lát: cr180-pages-a
cr: CR-180
làn: nhanh
migration: không
phụ thuộc: cr180-foundation
---
## Plan (ngắn)
Áp luật Mobile (≤ 640px) của CR-180 cho các trang hợp đồng: PageHeader, FilterBar, MetaList, vùng bấm 44px. Desktop giữ nguyên (trừ chỗ ghi ở Quyết định).

## Làm
- [x] Danh sách HĐ: `ListHeader` (điện thoại: nút chính «Tải hợp đồng lên» rộng hết, Xuất Excel/CSV + Thêm giao dịch vào «⋯»); `FilterBar` (chip loại HĐ 1 hàng cuộn ngang; lọc cột, lọc ngày, chọn cột vào Sheet «Lọc»); thẻ HĐ: tên 1 dòng, dòng 2 loại · đối tác · giá trị, trạng thái hàng riêng, Xem/Xoá vào «⋯»; phân trang ≥ 44.
- [x] Chi tiết HĐ: tên tối đa 2 dòng + tooltip đủ; nút chính rộng hết + «Thao tác» thành «⋯»; dòng thông tin dùng `MetaList` (Hồ sơ là một mục); «Chưa có tài liệu kèm…» cỡ chữ đọc; «← Hợp đồng» ≥ 44.
- [x] Tạo HĐ, Việc của tôi, Tổng quan: `PageHeader`; chip/tab ≥ 44; link «Xem tất cả…» `.tap-target`.

## Không làm / Chạm
Không sửa kit. Không chạm Đối tác, Sản phẩm, Thông báo, Cài đặt, Sơ đồ tổ chức (lát 2b). Màn đã đổi: /contracts/list, /contracts/c/$id (và form nháp dùng `FormBar`), /contracts/c/new, /contracts/approvals, /overview.

## Test tối thiểu
`bun test apps/workspace-web` (có `lead-items.test.ts`) · `tsc --noEmit -p apps/workspace-web` · biome · `check:ui-kit`.

## Quyết định trong lúc làm
- Danh sách HĐ: đầu trang vẽ hai bản (PageHeader `sm:hidden`, PageHead cũ `max-sm:hidden`) để desktop y nguyên; testid `add-deal` chỉ ở bản desktop.
- Danh sách HĐ desktop: bộ lọc cột/ngày/«Cột» nay đứng cùng hàng chip loại HĐ (trong `FilterBar`), ô tìm + số kết quả ở hàng dưới.
- Chi tiết HĐ: `MetaList` ép hiện nhãn ở desktop (`sm:[&_dt]:not-sr-only`) để giữ CR-168 «Số HĐ 1 · Loại Bán…»; thêm nhãn «Hồ sơ tệp» (`contracts.review.lead.record`); nhãn «Phụ trách» lấy từ MetaList (bỏ nhãn riêng trong `OwnerRow`).
- Tên HĐ ở đầu chi tiết cắt 2 dòng ở mọi cỡ màn hình (kit `TruncText lines=2`).
- Tổng quan: bộ chọn kỳ nằm dưới tiêu đề (PageHeader `children`) ở mọi cỡ màn hình.
- Chưa có `e2e/contracts-web/mobile-rules.cw.ts` trên nhánh này; kịch bản dưới đây dùng unit test + cập nhật e2e `doc-frame.cw.ts` (đổi `doc-file-line` ⇒ `detail-lead`, «File ký:» ⇒ «File ký»).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-16 (đợt cr177-180)

### ADDED web/mobile.md
#### Yêu cầu: Trang hợp đồng theo luật Mobile (≤ 640px)
Danh sách, chi tiết, tạo HĐ, Việc của tôi, Tổng quan dùng PageHeader / FilterBar / MetaList; mọi vùng bấm ≥ 44px; không còn dấu «·» lơ lửng ở dòng thông tin chi tiết HĐ.
- Kịch bản: khi dòng thông tin chi tiết HĐ có mục «File ký» thì nhãn không mang dấu «:» đuôi (điện thoại tự thêm), HĐ nguyên tắc không có mục «File ký» nếu chưa có tệp [test: apps/workspace-web/src/features/contract-review/lib/lead-items.test.ts » showFileItem: HĐ nguyên tắc không có mục File ký trừ khi đã có tệp]
- Kịch bản: khi xem chi tiết HĐ có chứng từ thì dòng thông tin hiện «File ký» [test: e2e/contracts-web/doc-frame.cw.ts » File ký]
- Kịch bản: khi xem danh sách HĐ ở 390px thì Xuất/Thêm giao dịch nằm trong «⋯», chip cuộn ngang, nút xem/xoá trong «⋯» của thẻ [test: thủ công — e2e mobile-rules của lát audit chưa có trên nhánh]

## Việc còn lại
Chạy e2e mobile-rules (lát audit) sau khi gộp; soát UI 390px thực tế (không chạy dev server ở lát này).
