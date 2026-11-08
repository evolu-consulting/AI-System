# Admin · Bản riêng luôn ghi nguồn thư viện

Cập nhật: 2026-11-09 · Gộp từ: cr121-f2-copy-source (đợt cr125-wave).

## Yêu cầu: Bản riêng luôn ghi nguồn thư viện (CR-121 R8) (nguồn: cr121-f2-copy-source)
Bản riêng của công ty luôn ghi "Sao từ thư viện: <gốc> · vN", công ty lấy từ chính bản riêng (không phụ thuộc đường dẫn mở); tenant_admin mở thẳng quy trình thư viện cũng vào được trang chỉ-xem.
- Kịch bản: công ty của dòng nguồn lấy từ tenant_id của bản riêng; tenant_admin dùng công ty của phiên [test: apps/admin-web/src/features/processes/lib/company-copy.test.ts » CR-121 f2 · công ty của dòng 'Sao từ thư viện' lấy từ chính def]
