---
id: fix-checkfn-wave
lát: fix-checkfn-wave
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Dọn vi phạm check:fn mới của đợt CR-187/188/189/190/191/192: tách hàm, gom tham số thành object.

## Làm

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm
- Hàm describe/it trong test (> 50 dòng) và helper test `signed` (5-6 tham số) không đụng — nợ test, ngoài phạm vi.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: tách hàm theo giới hạn check:fn)

## Việc còn lại
- org-dept.routes.int.test.ts (xoá phòng ⇒ 500) đỏ sẵn trên staging 8613b05be, không do lát này.
