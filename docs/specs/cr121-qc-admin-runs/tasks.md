---
id: cr121-qc-admin-runs
lát: cr121-qc-admin-runs
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
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: lát qc chỉ viết lại e2e P-a admin-runs theo luồng mới)

## Việc còn lại
- admin-runs.pa.ts còn đỏ: tenant_admin vào /processes/<def>/runs/<run> bị chuyển về Tổng quan; cần xác định đường vào trang lượt chạy hợp lệ cho tenant_admin.
