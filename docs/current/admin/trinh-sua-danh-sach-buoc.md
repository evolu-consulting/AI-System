# Admin · Trình sửa quy trình có chế độ Sơ đồ và Danh sách bước dùng chung một lựa chọn

Cập nhật: 2026-11-09 · Gộp từ: cr121-c17b-editor-steps (đợt cr125-wave).

## Yêu cầu: Trình sửa quy trình có chế độ Sơ đồ và Danh sách bước dùng chung một lựa chọn (CR-121 R8) (nguồn: cr121-c17b-editor-steps)
Trình sửa quy trình thư viện mở ở Sơ đồ (canvas) mặc định; "Danh sách" là bước dọc có "Chỉ chạy khi", bộ đếm n/20 và chặn bước thứ 21 kèm lý do; lựa chọn được nhớ theo người dùng. Thư viện hiện "Xuất bản vN+1" và "X công ty đang dùng vN"; bản riêng của công ty ghi rõ lưu là áp dụng ngay cho lượt chạy mới (không có Xuất bản); trang chỉ-xem có tab Lượt chạy của công ty.
- Kịch bản: bộ đếm n/20 và bước thứ 21 bị chặn [test: apps/admin-web/src/features/processes/lib/step-limit.test.ts » CR-121 c17b · n/20 và chặn bước thứ 21]
- Kịch bản: xuất bản vN+1 và Danh sách ứng với Form [test: apps/admin-web/src/features/processes/lib/step-limit.test.ts » CR-121 c17b · xuất bản vN+1, chế độ xem]
- Kịch bản: bản riêng của công ty dùng cùng Form bước dọc khi Hub trả slot_body, lượt chạy hiện nhãn hồ sơ [test: apps/admin-web/src/features/processes/lib/company-copy.test.ts » CR-121 c17b · bản riêng dùng Form bước dọc chung]
- Kịch bản: tenant_admin xem trước bằng HĐ mẫu CHÍNH bản riêng của công ty mình, bản riêng công ty khác 404 [test: apps/hub-api/src/modules/processes/library/clone-for-company.int.test.ts » CR-121 c17b · bản riêng: Form bước dọc + xem trước bằng HĐ mẫu]
