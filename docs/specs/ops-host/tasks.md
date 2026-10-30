---
id: ops-host
lát: ops-host
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
backup.sh ghi ops-status/backup.json; ops-host-status.sh ghi host.json; compose mount ro vào hub-api; README + cron.

## Làm

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: script vận hành CR-104, yêu cầu ở ops-watch)

## Việc còn lại
