# Admin · Bảng Thư viện quy trình theo artboard Library

Cập nhật: 2026-11-09 · Gộp từ: cr121-c15-library (đợt cr125-wave).

## Yêu cầu: Bảng Thư viện quy trình theo artboard Library (CR-121 R5) (nguồn: cr121-c15-library)
`/processes` (platform_admin) là Thư viện quy trình, bảng có 5 cột Quy trình · Các bước · Dùng bởi · Trạng thái · Cập nhật; "Các bước" là chip TÊN bước (tối đa 4 rồi "+N"), "Dùng bởi" là số công ty ("Chưa công ty nào dùng" khi 0); ô tìm khớp tên quy trình, tên bước và tên việc; bấm một dòng mở trình sửa ở chế độ canvas mặc định. Bộ lọc "Dùng bởi" dùng tham số `?usedBy=`; `?tenant=<id>` chỉ là URL cũ chuyển tới Công ty › Quy trình.
- Kịch bản: chip chỉ hiện tối đa 4 tên bước, phần còn lại là "+N" [test: apps/admin-web/src/features/processes/lib/step-chips.test.ts » splitChips]
- Kịch bản: tìm khớp tên bước, bỏ dấu, không phân biệt hoa thường [test: apps/admin-web/src/features/processes/lib/library-filter.test.ts » CR-121 c15 · ô tìm]
- Kịch bản: `?tenant=` không còn là bộ lọc, `?usedBy=` là bộ lọc [test: apps/admin-web/src/features/processes/lib/library-filter.test.ts » CR-121 c15 · ?tenant= không còn là bộ lọc (đã đổi thành usedBy)]
- Kịch bản: `/processes?tenant=<id>` kể cả kèm bộ lọc chuyển tới Công ty › Quy trình [test: apps/admin-web/src/features/tenants/lib/legacy-redirect.test.ts » CR-121 c13 · /processes?tenant= chuyển tới Công ty › Quy trình]
- Kịch bản: danh sách thư viện của Hub trả tên bước theo thứ tự [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » cờ has_unpublished_changes: xuất bản ⇒ false, sửa nháp ⇒ true, xuất bản lại ⇒ false]
- Kịch bản: bảng có đủ 5 cột và bấm dòng vào trình sửa canvas [test: thủ công — e2e/P-a/pf4/admin-processes.pa.ts viết, chạy một lần cuối đợt]
