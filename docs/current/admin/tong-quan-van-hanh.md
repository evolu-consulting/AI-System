# Admin · Câu rỗng của biểu đồ cột không mâu thuẫn với số trên ô

Cập nhật: 2026-11-09 · Gộp từ: cr121-r9-runs-tile-copy (đợt cr125-wave).

## Yêu cầu: Câu rỗng của biểu đồ cột không mâu thuẫn với số trên ô (nguồn: cr121-r9-runs-tile-copy)
Biểu đồ cột "Lượt theo giờ" chỉ đếm lượt đã xong hoặc lỗi. Khi chưa có cột nào mà còn lượt đang chạy, câu rỗng nói đúng điều đó và nêu số lượt đang chạy; chỉ khi không có lượt đang chạy mới nói "chưa có lượt chạy nào".
- Kịch bản: khi không có lượt xong/lỗi và 3 lượt đang chạy thì câu rỗng là "hourlyEmptyRunning" [test: apps/admin-web/src/features/overview/lib/ops-overview.test.ts » hourlyEmptyKey: câu rỗng không mâu thuẫn với số đang chạy]
- Kịch bản: khi không có lượt nào thì câu rỗng là "hourlyEmpty" [test: apps/admin-web/src/features/overview/lib/ops-overview.test.ts » hourlyEmptyKey: câu rỗng không mâu thuẫn với số đang chạy]
