---
id: cr121-r9-runs-tile-copy
lát: cr121-r9-runs-tile-copy
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

## Làm

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/tong-quan-van-hanh.md
#### Yêu cầu: Câu rỗng của biểu đồ cột không mâu thuẫn với số trên ô
Biểu đồ cột "Lượt theo giờ" chỉ đếm lượt đã xong hoặc lỗi. Khi chưa có cột nào mà còn lượt đang chạy, câu rỗng nói đúng điều đó và nêu số lượt đang chạy; chỉ khi không có lượt đang chạy mới nói "chưa có lượt chạy nào".
- Kịch bản: khi không có lượt xong/lỗi và 3 lượt đang chạy thì câu rỗng là "hourlyEmptyRunning" [test: apps/admin-web/src/features/overview/lib/ops-overview.test.ts » hourlyEmptyKey: câu rỗng không mâu thuẫn với số đang chạy]
- Kịch bản: khi không có lượt nào thì câu rỗng là "hourlyEmpty" [test: apps/admin-web/src/features/overview/lib/ops-overview.test.ts » hourlyEmptyKey: câu rỗng không mâu thuẫn với số đang chạy]

## Việc còn lại
