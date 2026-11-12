# Admin · Thư viện quy trình không gán trực tiếp cho công ty

> **CR-127 (2026-11-11) — phần Thư viện/khe/sao chép/mẫu/máy duyệt cũ trong file này ĐÃ THAY THẾ:** xem [engine/quy-trinh-cr127.md](../engine/quy-trinh-cr127.md). Giữ làm lịch sử; chỗ mâu thuẫn thì file CR-127 thắng.

Cập nhật: 2026-11-09 · Gộp từ: cr121-r1-processes (đợt cr125-wave).

## Yêu cầu: Thư viện quy trình không gán trực tiếp cho công ty (CR-121 R5/R7) (nguồn: cr121-r1-processes)
Trình sửa quy trình thư viện không còn nút gán cho công ty; chỉ ghi "Công ty gán quy trình này ở trang Công ty › Quy trình" kèm link tới danh sách công ty. Việc gán duy nhất nằm ở Công ty › Quy trình.
- Kịch bản: các khe của công ty rút từ năng lực app, bỏ trùng [test: apps/admin-web/src/features/processes/lib/caps-slots.test.ts » slotsOfCaps]
- Kịch bản: nhãn hồ sơ lượt chạy dùng một hàm [test: apps/admin-web/src/features/processes/lib/run-label.test.ts » run-label]
