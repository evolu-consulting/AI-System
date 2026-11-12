# Admin · Quy trình thư viện mở từ Công ty chỉ xem, sao chép thành bản riêng sửa được

> **CR-127 (2026-11-11) — phần Thư viện/khe/sao chép/mẫu/máy duyệt cũ trong file này ĐÃ THAY THẾ:** xem [engine/quy-trinh-cr127.md](../engine/quy-trinh-cr127.md). Giữ làm lịch sử; chỗ mâu thuẫn thì file CR-127 thắng.

Cập nhật: 2026-11-09 · Gộp từ: cr121-c17-editor (đợt cr125-wave).

## Yêu cầu: Quy trình thư viện mở từ Công ty chỉ xem, sao chép thành bản riêng sửa được (CR-121 R8) (nguồn: cr121-c17-editor)
Mở quy trình thư viện từ Công ty › Quy trình hiện "Quy trình dùng chung — chỉ xem." với sơ đồ (mặc định) hoặc danh sách bước, không có sửa/Xuất bản, và nút "Sao chép cho công ty này" tạo bản riêng tự gán thay bản cũ; bấm lần hai mở lại cùng bản. Bản riêng ghi "Sao từ thư viện: <gốc> · vN" và lưu theo đường khe (bước được giữ để chạy). Lỗi sao chép nói lý do bằng ngôn ngữ nghiệp vụ.
- Kịch bản: sửa bản riêng rồi lưu thì `slot_body` được dựng lại và giữ, khe vẫn null [test: apps/hub-api/src/modules/processes/library/clone-for-company.int.test.ts » CR-121 c17 · sửa bản riêng lưu theo đường khe]
- Kịch bản: NOT_LIBRARY_DEF và SLOT_GONE có câu riêng [test: apps/admin-web/src/features/processes/lib/errors.test.ts » CR-121 c17 · mã lỗi Sao chép cho công ty này]
- Kịch bản: mặc định canvas, nhớ lựa chọn danh sách, lỗi storage về canvas [test: apps/admin-web/src/features/processes/lib/view-mode.test.ts » mặc định canvas khi chưa lưu, không có kho, hoặc giá trị lạ]
