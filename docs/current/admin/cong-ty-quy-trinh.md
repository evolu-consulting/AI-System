# Admin · Tab Quy trình của công ty là nơi duy nhất gán quy trình

> **CR-127 (2026-11-11) — phần Thư viện/khe/sao chép/mẫu/máy duyệt cũ trong file này ĐÃ THAY THẾ:** xem [engine/quy-trinh-cr127.md](../engine/quy-trinh-cr127.md). Giữ làm lịch sử; chỗ mâu thuẫn thì file CR-127 thắng.

Cập nhật: 2026-11-09 · Gộp từ: cr121-c11-company-flows (đợt cr125-wave).

## Yêu cầu: Tab Quy trình của công ty là nơi duy nhất gán quy trình (nguồn: cr121-c11-company-flows)
Trang công ty có tab "Quy trình" liệt kê theo ứng dụng → việc → quy trình đang gán (chip bước, Đang bật/Đang tắt kèm lý do, số luật, nút Đổi/Gán); việc chưa gán hiện "Đang tắt · chưa gán quy trình"; gán xong là "Đang bật" ngay, không công tắc nào khác. Quản trị nền tảng và quản trị công ty (công ty mình) đều thấy tab.
- Kịch bản: việc chưa gán ⇒ Đang tắt kèm lý do chưa gán quy trình; có quy trình ⇒ Đang bật; mặc định đã xoá/chưa xuất bản ⇒ tắt với lý do tương ứng [test: apps/admin-web/src/features/tenants/flows/lib/flow-rows.test.ts » jobOf]
- Kịch bản: việc xếp theo ứng dụng (Hợp đồng trước), số luật không tính Mặc định, tóm tắt "x/y việc có quy trình" [test: apps/admin-web/src/features/tenants/flows/lib/flow-rows.test.ts » groupJobs / summaryOf]
- Kịch bản: quản trị công ty đổi quy trình mặc định trong tập quy trình công ty, luật điều kiện giữ nguyên [test: apps/admin-web/src/features/tenants/flows/lib/flow-rows.test.ts » withDefault (tenant_admin đổi quy trình)]
- Kịch bản: tab `processes` có cho platform_admin và tenant_admin [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts]
- Kịch bản: platform_admin gán từ đầu rồi tenant_admin Sao chép + Đổi (hành trình thật) [test: thủ công — test đã đổi tên/gộp sau lát, xem lịch sử git]

## Yêu cầu: Xem quy trình mặc định dạng sơ đồ và nhớ lựa chọn (nguồn: cr121-c11-company-flows)
Chỗ xem quy trình mở ở chế độ sơ đồ (canvas); danh sách bước là chế độ phụ, nhớ theo trình duyệt; không đọc được bộ nhớ thì về sơ đồ.
- Kịch bản: chưa lưu/giá trị lạ/lỗi lưu trữ ⇒ canvas; chọn danh sách ⇒ đọc lại ra danh sách [test: apps/admin-web/src/features/processes/lib/view-mode.test.ts » nhớ lựa chọn danh sách rồi đọc lại]
