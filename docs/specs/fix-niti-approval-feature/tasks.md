---
id: fix-niti-approval-feature
lát: fix-niti-approval-feature
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
seed-niti không cấp feature công ty `contracts-approval-engine` ⇒ HĐ không vào luồng duyệt. Sửa: seed cấp qua service Admin (idempotent); ops-watch `flow_coverage` bắt ca lệch.

## Làm
- tools/scripts/src/seed-niti.ts: `ensureEngine` (grantEntitlement của admin-api; dry-run in "sẽ cấp").
- flow-coverage.check.ts: thêm `engineOffQuery` + `engine_off` ⇒ crit nêu tên tenant.
- Seed khác (seed-demo-v2, seed-community-demo, seed-flow-showcase, seed-cr113-samples): không tạo luật/gán quy trình `contracts.approval` ⇒ không cùng lỗi (demo được migration 0026 cấp sẵn; fixture hub-dev/seed.tenant-fixtures đã cấp FIXTURE/DEMO_FEATURES).

## Không làm / Chạm
Không migration; không đổi engine.

## Test tối thiểu
unit flow-coverage.check.test.ts; int seed-niti.int.test.ts, ops.flow-coverage.int.test.ts.

## Quyết định trong lúc làm
Check mới gộp vào `flow_coverage` (cùng key), tenant active có luật hoặc process_tenant_defs cho `contracts.approval`, feature `status<>'off'`, entitlement chưa thu hồi.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED ops/ops-watch-flow-coverage.md
#### Yêu cầu: Check flow_coverage bắt tenant thiếu feature engine duyệt
Tenant có luật định tuyến hoặc quy trình đã gán cho khe `contracts.approval` mà không có entitlement `contracts-approval-engine` còn hiệu lực ⇒ crit, nêu tên tenant.
- Kịch bản: khi tenant có luật/quy trình duyệt nhưng thiếu feature thì check crit nêu tên, cấp feature xong thì ok [test: apps/hub-api/src/modules/ops/ops.flow-coverage.int.test.ts » tenant có luật/quy trình contracts.approval nhưng thiếu feature contracts-approval-engine ⇒ crit nêu tên, cấp feature ⇒ ok]

### ADDED tools/seed-niti.md
#### Yêu cầu: seed-niti cấp feature duyệt HĐ
`seed-niti --apply` cấp feature công ty `contracts-approval-engine` cho tenant (idempotent, qua service Admin); chạy thử chỉ in "sẽ cấp".
- Kịch bản: khi --apply thì tenant có entitlement còn hiệu lực, chạy lại không đổi [test: tools/scripts/src/seed-niti.int.test.ts » --apply tạo đủ và mật khẩu chỉ ở file, không ở log]

## Việc còn lại
Chạy seed-niti --apply trên tenant NiTi thật (người dùng quyết) hoặc bật tay ở Admin.