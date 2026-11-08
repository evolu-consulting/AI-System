---
id: cr125-fix-ms-harness
lát: cr125-fix-ms-harness
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Nguyên nhân: -ms/-fsc không có trong META ⇒ fallbackMeta (DB chung, không Redis, cổng 3440 như việc journey gốc). Thêm META riêng + test + README.

## Làm

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: chỉ sửa harness e2e - META của test:e2e:par cho journey-ms/-fsc: DB, Redis DB, dịch cổng riêng; không đổi code sản phẩm).
