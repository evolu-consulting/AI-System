# Admin · Cột Các bước của Thư viện một kiểu hiển thị

> **CR-127 (2026-11-11) — phần Thư viện/khe/sao chép/mẫu/máy duyệt cũ trong file này ĐÃ THAY THẾ:** xem [engine/quy-trinh-cr127.md](../engine/quy-trinh-cr127.md). Giữ làm lịch sử; chỗ mâu thuẫn thì file CR-127 thắng.

Cập nhật: 2026-11-09 · Gộp từ: cr121-f17-library-steps-cell (đợt cr125-wave).

## Yêu cầu: Cột Các bước của Thư viện một kiểu hiển thị (CR-121 UAT) (nguồn: cr121-f17-library-steps-cell)
Cột Các bước hiện chip tên bước; khi quy trình không có tên bước thì hiện viên trung tính "N bước" cùng kiểu chip, không bao giờ số trơn.
- Kịch bản: có tên ⇒ chip, không tên ⇒ viên đếm, không có ⇒ trống [test: apps/admin-web/src/features/processes/lib/step-chips.test.ts » CR-121 f17 · cột Các bước một kiểu]
