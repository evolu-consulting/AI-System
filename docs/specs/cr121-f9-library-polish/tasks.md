---
id: cr121-f9-library-polish
lát: cr121-f9-library-polish
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: c15, c17b
---
## Plan (ngắn)
UAT lượt 1 (L2, L5, tab Mẫu): chỉnh bảng Thư viện cho vừa 1440px, một nhãn Sơ đồ/Danh sách, tab "Mẫu · chạy thử" theo khuôn Thư viện.

## Làm
- L2: hành động dòng Thư viện gom vào menu "⋯" (`LibraryRowMenu`: Sửa · Nhân bản · Xoá khoá + lý do) như các bảng khác của admin; bảng không còn cột nút. Bấm cả dòng vẫn mở trình sửa; menu chặn nổi bọt để không mở nhầm.
- L5: bàn làm việc giai đoạn (`/processes/new` và trình sửa def thường) bỏ tab "Canvas/Danh sách" riêng, dùng `ViewModeToggle` chung (Sơ đồ / Danh sách bước), nhớ lựa chọn qua `view-mode.ts` (màn nhỏ vẫn mặc định danh sách). Các câu hiển thị "Canvas"/"Form" trong i18n vi (+en) đổi thành "Sơ đồ"/"Danh sách"; GIỮ `canvas.title` ("Canvas quy trình") và "Điều khiển canvas" vì là nhãn trợ năng mà nhiều e2e dò theo tên.
- Tab "Mẫu · chạy thử": là KHÁI NIỆM KHÁC (mẫu để chạy thử, có nút Chạy/bật-tắt, def không khe nên không có chip bước) ⇒ giữ tab, dùng CHUNG `DataTable`/ô/nút của Thư viện, bỏ cột kỹ thuật "Ký hiệu", đổi "Giai đoạn" thành "Số bước". Lý do chọn: phương án nhỏ nhất; gộp vào bảng Thư viện cần dữ liệu bước mà API mẫu không có.

## Test
unit: bộ unit `features/processes` (307 pass) + tsc + i18n:check; logic mới là bố cục (menu, toggle) dùng lại hàm đã có test (`deleteLock`, `view-mode`). Perf: không chạm.

## e2e cần đổi (qc giữ, KHÔNG sửa ở đây)
- `e2e/P-a/pf4/process-library.pa.ts`: nút "Nhân bản"/"Xoá" trên dòng nay nằm trong menu `data-testid="library-row-menu"` (mở menu rồi bấm mục "Nhân bản"/"Xoá"); `delete-locked` giờ là mục menu bị khoá.
- Ca nào dò tab "Canvas"/"Danh sách" ở editor def thường: nay là nút "Sơ đồ"/"Danh sách bước" (`flows-view-canvas|list`), không còn role tab.
- Bảng tab "Mẫu · chạy thử": không còn cột "Ký hiệu"; cột "Giai đoạn" đổi tên "Số bước".

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/thu-vien-bang-gon.md
#### Yêu cầu: Bảng Thư viện gọn và một nhãn Sơ đồ/Danh sách (CR-121 UAT)
Hành động của dòng Thư viện nằm trong menu "⋯" nên bảng không tràn ở 1440px; mọi chỗ chọn cách xem quy trình dùng cùng công tắc Sơ đồ/Danh sách bước và nhớ lựa chọn; tab Mẫu · chạy thử dùng chung khuôn bảng, không lộ ký hiệu kỹ thuật.
- Kịch bản: xoá bị khoá khi là mặc định hoặc đang có công ty dùng, kèm lý do [test: apps/admin-web/src/features/processes/lib/library-view.test.ts » deleteLock]
- Kịch bản: mặc định Sơ đồ, nhớ lựa chọn Danh sách [test: apps/admin-web/src/features/processes/lib/view-mode.test.ts » CR-121 c11 · view-mode (Q11)]