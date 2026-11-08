# Admin · Trang danh sách dùng khung chung

Cập nhật: 2026-11-09 · Gộp từ: cr121-c1b-list-drawer (đợt cr125-wave).

## Yêu cầu: Trang danh sách dùng khung chung (nguồn: cr121-c1b-list-drawer)
Bộ lọc là nút phễu chỉ icon; mỗi nhóm lọc là một control; giá trị đang lọc hiện thành chip có nút xoá; có dòng "n / tổng"; lọc không khớp hiện "Không có … khớp bộ lọc" kèm "Bỏ lọc".
- Kịch bản: khi chọn lọc Trạng thái "Tắt" ở /commands thì hiện chip và dòng "2 / 5" [test: apps/admin-web/src/components/shared/list/list-filter.test.ts » list-filter]
- Kịch bản: khi bấm hàng thì mở ngăn chi tiết và Esc đóng ngăn [test: e2e/cr121-list.spec.ts]
