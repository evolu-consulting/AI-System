---
id: cr112-e2e-fix2
lát: cr112-e2e-fix2
cr: CR-112
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
3 e2e CR-112 đỏ trên evotest (cr112-wizard, feature-ui, tenant-packs): fake `/packs` của e2e lỗi thời so với commit 7b4087e1.

## Làm
- `e2e/support/fake-packs.ts`: route khớp cả query `?level=` (trước đây `$` không khớp ⇒ request lọt ra server thật ⇒ 500 "Internal server error"); đọc `level`, truyền cho `sync`.
- `tenant-packs.spec.ts`, `cr112-wizard.spec.ts`: `sync` cấp entitlement chỉ tới mức `level` (đúng hành vi server mới).

## Không làm / Chạm
Không đổi code app.

## Test tối thiểu
Chạy trên evotest: `run-tests.ps1 -Step e2e -Filter root-1`.

## Quyết định trong lúc làm
Lỗi do test/fake lỗi thời, không phải lỗi app.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa fake/e2e cho khớp hành vi đã có của CR-112 review-fix)

## Việc còn lại
