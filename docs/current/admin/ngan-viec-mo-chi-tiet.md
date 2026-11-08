# Admin · Mọi việc có quy trình đều mở được trang chi tiết từ ngăn việc

Cập nhật: 2026-11-09 · Gộp từ: cr121-f16-drawer-open-copy (đợt cr125-wave).

## Yêu cầu: Mọi việc có quy trình đều mở được trang chi tiết từ ngăn việc (nguồn: cr121-f16-drawer-open-copy)
Ngăn việc luôn có một nút mở trang chi tiết: bản riêng của công ty mở để sửa, bản thư viện mở để xem; link mang công ty đang xem; khi không vẽ được các bước thì nói lý do và bước kế.
- Kịch bản: bản thư viện/bản riêng/đang tải quyết theo dữ liệu, không theo mã lỗi [test: apps/admin-web/src/features/tenants/flows/lib/def-kind.test.ts » CR-121 f16 · defView]
- Kịch bản: lỗi tải hoặc thiếu danh sách bước ⇒ lý do rõ [test: apps/admin-web/src/features/tenants/flows/lib/def-kind.test.ts » CR-121 f16 · stepsGap]
