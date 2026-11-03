---
id: fix114-sweep
lát: fix114-sweep
cr: CR-114
làn: nhanh
migration: không
phụ thuộc: hub-ha-sweeps
---
## Plan (ngắn)
Sửa review CR-114 (Thấp): (1) vòng nhắc không cho câu của nhiều bước xen kẽ trên cùng tx; (2) runbook deploy CR-114.

## Làm
- [x] `remind-tasks.usecase.ts`: chỉ pipeline hai câu đơn độc lập (`markRemindedMany` ∥ `notifyMany`, mỗi hàm một câu);
  `escalateBatch` (nhiều câu) chạy sau, tuần tự.
- [x] `deploy/prod-sohoptac2/README.md` mục "Deploy CR-114": giờ vắng + đếm trước (0082 khoá bảng lúc dựng index), dừng
  hết bản cũ rồi chạy bản mới, bật OTEL sau cùng (`JobPayload extra=forbid`), `when` > 1802600000000 cho migration sau.

## Không làm / Chạm

## Test tối thiểu
Có sẵn: PD-P13 (`tests/acceptance/P-d/perf/background.perf.int.test.ts`), PD-P10/P11/P15 (`tests/acceptance/P-d/d1`).

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đổi thứ tự gửi câu trong tx lô nhắc, cùng tập câu và kết quả; tài liệu deploy).

## Việc còn lại
