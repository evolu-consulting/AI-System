# Admin · Tổng quan platform dạng bento, mỗi ô có số hoặc lý do

Cập nhật: 2026-11-09 · Gộp từ: cr121-c3b-dashboard-bento (đợt cr125-wave).

## Yêu cầu: Tổng quan platform dạng bento, mỗi ô có số hoặc lý do (nguồn: cr121-c3b-dashboard-bento)
platform_admin mở `/` thấy ô lớn lượt chạy 24 giờ, 5 ô số liệu, "Cần xử lý ngay" và "Sức khoẻ hệ thống" từ `GET /ops/overview`; ô đang tải/lỗi/chưa có dữ liệu nói rõ lý do và bước tiếp theo; màn nhỏ co về một cột.
- Kịch bản: khi platform_admin mở Tổng quan thì thấy đủ 8 ô và không còn các ô cũ [test: e2e/cr121-overview-bento.spec.ts » CR-121 · platform_admin thấy đủ các ô bento, mỗi ô có nội dung (số hoặc lý do), không còn các ô cũ]
- Kịch bản: khi màn hình nhỏ thì các ô xếp một cột và không tràn ngang [test: e2e/cr121-overview-bento.spec.ts » CR-121 · màn nhỏ co về một cột không tràn ngang, ô Sức khoẻ dẫn tới trang Hệ thống]
- Kịch bản: khi tỷ lệ/xu hướng chưa có số thì hiện "—" hoặc "chưa đủ dữ liệu" thay vì 0 [test: apps/admin-web/src/features/overview/lib/ops-overview.test.ts » sparkPoints: ít hơn 2 điểm có số thì rỗng, bỏ qua null, chuỗi phẳng ở giữa]
- Kịch bản: khi một mục "Cần xử lý ngay" có link tới trang chưa tồn tại thì chỉ hiện số [test: apps/admin-web/src/features/overview/lib/ops-overview.test.ts » resolveLink: chỉ link tới trang đã có, trang chưa có thì null]

## Yêu cầu: tenant_admin không thấy ô vận hành toàn nền tảng (nguồn: cr121-c3b-dashboard-bento)
tenant_admin ở `/` chỉ thấy bản công ty; các ô vận hành toàn nền tảng không hiện.
- Kịch bản: khi tenant_admin mở `/` thì không có ô "Lượt chạy 24 giờ", "Cần xử lý ngay", "Sức khoẻ hệ thống" [test: e2e/cr121-overview-bento.spec.ts » CR-121 · tenant_admin ở '/' chỉ thấy bản công ty, không có ô vận hành toàn nền tảng]
