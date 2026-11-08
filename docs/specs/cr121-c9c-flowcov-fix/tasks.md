---
id: cr121-c9c-flowcov-fix
lát: cr121-c9c-flowcov-fix
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c9b
---
## Plan (ngắn)
Ca int c9b "luật trỏ bản riêng của công ty KHÁC ⇒ crit" đỏ khi chạy cả thư mục ops: nhận "ok", kỳ vọng "crit".

## Làm
Nguyên nhân: sau khi gộp c18, ca "feature thiếu app" của c18 cũng dùng mốc giờ giả `round(124)`/`round(155)` trong cùng file; `runChecksOnce` bỏ qua lượt khi chưa đến hạn (`isDue`, `every_min` tính từ `last_round_at`) nên lượt của ca c9b không chạy và `row()` vẫn là kết quả cũ "ok". Code check đúng — chỉ đổi mốc giờ ca c9b sang `round(186)`/`round(217)` (mỗi ca một mốc cách nhau ≥ 31 phút, tăng dần).

## Không làm / Chạm
Không đổi code check; chỉ `apps/hub-api/src/modules/ops/ops.flow-coverage.int.test.ts`.

## Test tối thiểu
evotest int cả thư mục `apps/hub-api/src/modules/ops`.

## Quyết định trong lúc làm
Mốc giờ giả trong file này phải duy nhất và tăng dần giữa các ca (ghi chú tại ca).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: chỉ sửa mốc giờ giả của một ca test để không trùng với ca c18)

## Việc còn lại
Không.