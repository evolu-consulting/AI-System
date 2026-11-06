---
id: cr121-qc-uat-fixes2
lát: cr121-qc-uat-fixes2
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: F8–F18
---
## Plan (ngắn)
qc: sửa e2e theo UI đã đổi ở F8–F18 (UI CR-121 đóng băng).

## Làm
e2e: cr121-c-flows (F8 bỏ expect.soft, F15 "Xong" ở đáy, F16 nút mở, chờ ngăn đóng hẳn rồi mở lại; tạo nhóm tên {vi,en}), process-library, feature-ui, app-config, cr121-c14-tabs, cr112-wizard, cr121-c16-ai-tools…

## Test tối thiểu
Lượt 16:23: 320 pass / 1 fail (c-flows). Sau sửa: journey-approval-journey 20/20 xanh.

## Quyết định trong lúc làm
- Điều phối dừng agent qc lúc 16:46 (mỗi lượt chạy cả 320 ca ~14 phút, trái luật 5d) và tự chạy đúng job journey.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa e2e theo UI đã đổi ở CR-121 F8–F18).

## Việc còn lại
- Chốt chặn trong `deploy/evotest/run-tests.ps1` để lát không chạy cả bộ (lát tool riêng).
