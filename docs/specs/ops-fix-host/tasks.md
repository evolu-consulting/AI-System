---
id: ops-fix-host
lát: ops-fix-host
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
OPS_PUBLIC_URLS chỉ ở chế độ domain (gen-env); rsync lỗi => ok=true,offsite_ok=false,exit 1; S2_DIR theo vị trí script; every_min=30; sửa fence README.

## Làm

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa lỗi review CR-104)

## Việc còn lại
