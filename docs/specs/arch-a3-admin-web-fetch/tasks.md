---
id: arch-a3-admin-web-fetch
lát: arch-a3-admin-web-fetch
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Tách gọi API khỏi component admin-web/studio-web sang hooks (cổng re-export) và transport.

## Làm
hooks/*, lib/api-error.ts, shell/transport.ts; gỡ 24 entry component-no-fetch khỏi baseline.

## Không làm / Chạm
processes, partners, hub-api, admin-api.

## Test tối thiểu
unit admin-web, depcruise, build, check:bundle.

## Quyết định trong lúc làm
Không.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt CR-125 cuoi dot)

Không thay đổi hành vi (lý do: tách gọi API khỏi component)
