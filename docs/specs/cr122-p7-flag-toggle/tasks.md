---
id: cr122-p7-flag-toggle
lát: cr122-p7-flag-toggle
cr: CR-122
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Cờ chuyển công ty sang flow mới (`hub.tenant_flow_settings.flow_triggers`) chưa có API/UI, chỉ ghi DB (trái Luật GỐC 3, D7). Thêm API
`GET/PUT /tenants/:tid/flow-settings` (chỉ platform_admin, kiểm ở service, ghi bằng `setFlowTriggers`, audit cũ → mới) và công tắc ở tab
Quy trình của công ty.

## Làm
- Hub: `library/flow-settings.service.ts` + 2 route trong `company-flows.routes.ts`; audit qua `withConfigWrite` (action `update`, entity
  `process_def`, entity_name `flow_triggers`, before/after `{flow_triggers}`); đặt lại đúng giá trị ⇒ không ghi.
- admin-web: `flows/flow-settings-api.ts`, `flows/components/FlowSwitch.tsx` (đầu `CompanyFlowList`, chỉ platform_admin), i18n vi/en
  `tenants.companyFlows.newFlow.*`. testid: `flow-switch`, `flow-switch-status`, `flow-switch-toggle`, `flow-switch-confirm`, `flow-switch-confirm-ok`.

## Không làm / Chạm
Không migration (dùng action/entity audit có sẵn), không đổi bộ điều phối/`flags.ts`. Không unit riêng cho component (không có logic).

## Test tối thiểu
`library/flow-settings.int.test.ts` (evotest -Dirty).

## Quyết định trong lúc làm
- Tắt không cần xác nhận (về cách cũ an toàn); chỉ bật hỏi một câu.
- GET cũng chỉ platform_admin (UI chỉ hiện cho platform_admin).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Platform admin bật/tắt cờ "dùng quy trình mới" theo công ty
Cờ `flow_triggers` của công ty được đọc/đặt qua `GET/PUT /tenants/:tid/flow-settings`, chỉ platform_admin; tenant_admin và member nhận 403. Mỗi lần đổi giá trị ghi audit (người đổi, lúc đổi, giá trị cũ và mới); đặt lại đúng giá trị hiện tại không ghi audit. Tab Quy trình của công ty có công tắc cho platform_admin, bật thì hỏi xác nhận một câu.
- Kịch bản: khi platform_admin PUT `{flow_triggers:true}` rồi `false` thì GET trả đúng giá trị và audit có hai dòng (false→true, true→false); tenant_admin gọi nhận 403 [test: apps/hub-api/src/modules/processes/library/flow-settings.int.test.ts » platform_admin bật/tắt, tenant_admin 403, audit ghi cũ và mới]

## Việc còn lại
- qc: e2e hành trình bật công tắc trên UI (viết ở đợt e2e cuối CR, testid trong mục Làm).
