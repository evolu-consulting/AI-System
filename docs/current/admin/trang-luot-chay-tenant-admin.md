# Admin · tenant_admin vào được trang lượt chạy và trình sửa của công ty mình

Cập nhật: 2026-11-09 · Gộp từ: cr121-f3-tenant-run-route (đợt cr125-wave).

## Yêu cầu: tenant_admin vào được trang lượt chạy và trình sửa của công ty mình (CR-121 R3/R4) (nguồn: cr121-f3-tenant-run-route)
Chỉ danh sách `/processes` chuyển tenant_admin tới Công ty › Quy trình; `/processes/$id` và `/processes/$id/runs/$runId` vào được khi thuộc công ty của họ, 404 hiện "Không tìm thấy" kèm nút về công ty mình. Khối "Đang chạy" của Công ty › Quy trình mở trang lượt chạy.
- Kịch bản: chuyển hướng danh sách không áp cho trang con; nút quay lại theo vai [test: apps/admin-web/src/features/processes/lib/route-guard.test.ts » CR-121 f3 · chỉ danh sách /processes bị chuyển hướng]
