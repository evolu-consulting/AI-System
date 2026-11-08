---
id: tool-deployed-par
lát: tool-deployed-par
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Tách e2e triển khai thành project `ro` (6 file, 13 test, 4 worker) và `rw` (13 file, 61 test, 1 worker), hai lượt nối tiếp trong `e2e-deployed.ps1`.

## Test tối thiểu
`--list` từng project (ro 13/6, rw 61/13), typecheck. Không chạy prod.

## Việc cần qc relock
`e2e/deployed/deployed.config.ts` (file e2e khoá). Không đổi spec nào.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: chỉ đổi cách chạy bộ e2e triển khai, không đổi sản phẩm).

## Việc còn lại
Chạy thử trên prod do người dùng cho phép; cân nhắc làn `ai` (chat AI song song 2 worker) nếu cần nhanh hơn.
