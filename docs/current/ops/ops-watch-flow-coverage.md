# Ops · Ops-watch · check engine duyệt (flow_coverage)

Cập nhật: 2026-11-09 · Gộp từ: fix-niti-approval-feature (đợt cr125-wave).

## Yêu cầu: Check flow_coverage bắt tenant thiếu feature engine duyệt (nguồn: fix-niti-approval-feature)
Tenant có luật định tuyến hoặc quy trình đã gán cho khe `contracts.approval` mà không có entitlement `contracts-approval-engine` còn hiệu lực ⇒ crit, nêu tên tenant.
- Kịch bản: khi tenant có luật/quy trình duyệt nhưng thiếu feature thì check crit nêu tên, cấp feature xong thì ok [test: apps/hub-api/src/modules/ops/ops.flow-coverage.int.test.ts]
