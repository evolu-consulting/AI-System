# Admin · platform_admin mở được bản riêng và lượt chạy của công ty từ mọi lối vào

Cập nhật: 2026-11-09 · Gộp từ: cr121-f14-platform-company-open (đợt cr125-wave).

## Yêu cầu: platform_admin mở được bản riêng và lượt chạy của công ty từ mọi lối vào (CR-121 R3/R8) (nguồn: cr121-f14-platform-company-open)
Mọi link từ Công ty › Quy trình tới trình sửa bản riêng và trang lượt chạy mang theo công ty đang xem; platform_admin mở được, tenant_admin không cần tham số. Cột "Dùng bởi" ngắn gọn ("—" hoặc viên Mặc định), chip bước không bị cắt giữa chữ, công tắc Sơ đồ/Danh sách có nhãn chữ.
- Kịch bản: link mang công ty; platform đọc theo ?company= còn tenant_admin giữ nguyên [test: apps/admin-web/src/features/processes/lib/company-copy.test.ts » CR-121 f14 · platform mở bản riêng/lượt chạy của công ty]
- Kịch bản: chip gộp nguyên chip vào +N theo ngân sách ký tự [test: apps/admin-web/src/features/processes/lib/step-chips.test.ts » splitChips · ngân sách ký tự (không cắt giữa chữ)]
