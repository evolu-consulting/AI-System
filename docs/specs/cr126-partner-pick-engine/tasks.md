---
id: cr126-partner-pick-engine
lát: cr126-partner-pick-engine
cr: CR-126
làn: nhanh
migration: không
phụ thuộc: cr126-partner-pick-form (đã gộp d244a75f1)
---
## Plan (ngắn)
Node «Gửi đối tác xác nhận» = [form «Chọn đối tác & người nhận»] → tool gửi → chờ. Engine: nhóm phụ trách của node module (một cơ chế),
điền sẵn form (`FormPrefill`), chặn gửi cho đối tác không thuộc công ty.

## Làm
- `packages/contracts/src/flow/form-prefill.ts`: `FormPrefill { field_defaults, field_options }` (trần = `FORM_OPTIONS_FROM_MAX`).
- `modules/node-assignee.ts`: `assignee_group` (args hằng của stage tool trong cụm) ⇒ `after.group_id` (uuid) / `after.group_key` (mã) của stage
  `form` trong cụm, tính lại mỗi lần lưu (`bindIfCompany` → `withNodeAssignee`); `nodeAssigneeNeeds` ⇒ readiness `READINESS_ASSIGNEE_MISSING`.
- `NODE_EXECUTORS` + `form`; partner-send: config `assignee_group` (widget `group`), 3 stage, đầu vào `partner_tax_code`/`partner_email`.
- `kit/adapters/form-prefill-registry.ts` (theo khoá node) ⇒ `stepsView` gắn `form.prefill` cho bước form đang mở (sau tx engine, uow gói);
  `collapseModuleSteps`: cụm có stage người làm đang mở ⇒ dòng node mang task + form; thẻ HĐ giữ `form.prefill` (approval.ts).
- `partner-send.tool`: `PARTNER_NOT_IN_COMPANY` (MST chọn không có ở `partner_roles` của công ty), `PARTNER_EMAIL_INVALID`; repo `isPartner`/`partners`.

## Không làm / Chạm
Không sửa process-form.ts / FormStep / inbox UI (lát form). Không migration. Lock order, đường giao task cũ giữ nguyên.
Perf: `stepsView` +1 lời gọi resolver chỉ khi có bước form mở trong node có resolver (3 câu cố định); danh sách đối tác 1 câu `limit 200`.

## Test tối thiểu
- unit `packages/contracts/src/modules/node-assignee.test.ts` (a, d), `partner-send/node.test.ts`.
- int `apps/hub-api/src/modules/packs/contracts/partner-pick.int.test.ts` (b, c, điền sẵn).

## Quyết định trong lúc làm
- Nguồn nhóm = cấu hình node; `after.group_*` của stage form là bản dẫn xuất ghi lại mỗi lần lưu (không hai control).
- (a) kiểm ở mức luật thuần: engine giao task theo `after.group_id` như mọi bước duyệt (đường cũ, không đổi).
- Prefill tính lúc ĐỌC (không cột mới); đối tác = `contracts.partner_roles` khoá `tax:%` (RLS gói theo người xem).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/gui-doi-tac-xac-nhan.md
#### Yêu cầu: Chọn đối tác & người nhận trước khi gửi
Node «Gửi đối tác xác nhận» có bước người làm «Chọn đối tác & người nhận» trước khi gửi; nhóm làm là «Nhóm phụ trách gửi đối tác» chọn ở cấu hình
node; form điền sẵn đối tác + email liên hệ của HĐ, danh sách chọn là đối tác của chính công ty; gửi dùng người nhận đã chọn.
- Kịch bản: khi cấu hình node có nhóm phụ trách thì bước chọn người nhận giao cho đúng nhóm đó [test: packages/contracts/src/modules/node-assignee.test.ts » (a) nhóm cấu hình ở node]
- Kịch bản: khi chưa chọn nhóm phụ trách thì quy trình chưa sẵn sàng với lý do chọn nhóm phụ trách gửi đối tác [test: packages/contracts/src/modules/node-assignee.test.ts » (d) chưa chọn nhóm]
- Kịch bản: khi mở bước chọn thì máy chủ điền sẵn MST và email của HĐ, danh sách chỉ gồm đối tác của công ty [test: apps/hub-api/src/modules/packs/contracts/partner-pick.int.test.ts » điền sẵn]
- Kịch bản: khi người làm chọn người nhận khác thì lần gửi dùng email đã chọn [test: apps/hub-api/src/modules/packs/contracts/partner-pick.int.test.ts » (b) gửi dùng người nhận ĐÃ CHỌN]
- Kịch bản: khi chọn đối tác không thuộc công ty hoặc email sai dạng thì bước gửi lỗi nghiệp vụ và không gửi gì [test: apps/hub-api/src/modules/packs/contracts/partner-pick.int.test.ts » (c) chọn đối tác của công ty khác]

## Việc còn lại
- Panel cấu hình node vẫn hiện ô `partner_tax_code`/`partner_email` cũ (args hằng) — trùng với form; nên ẩn ở panel (lát UI).
- e2e q6/s7 (journey-approval) chạy ở lượt e2e.
