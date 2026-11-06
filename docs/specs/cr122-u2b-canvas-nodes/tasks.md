---
id: cr122-u2b-canvas-nodes
lát: cr122-u2b-canvas-nodes
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: cr122-u2-editor-list
---
## Plan (ngắn)
Phần UI còn lại của CR-122: đích bước ổn định khi đổi thứ tự, Nếu theo dữ kiện/field `event`, ô Gộp tới + kết quả chờ, gán flow Thư viện cho công ty, gỡ màn "Việc/Luật" cũ, gợi ý cầu nối theo hợp đồng N2.

## Làm
- `lib/step-refs.ts` (+ hook trong `use-draft.update`): mọi đích bước (hub nhận SỐ BƯỚC 0-based: `goto_step`, `then/else_step`, `reject/return_step`, `next_step`, `wait_event.branches[].goto_step`) được đánh lại khi chèn/kéo/xoá bước; đích bị xoá ⇒ về "chưa chọn". `backTo` vẫn do `normalizeSteps`.
- Nếu: nguồn `fact|<khoá>` từ `AppEventDecl.facts` + field `event` của bước chờ (`if-form.ts`, `StageIf`). `StageLinks`: "Gộp tới" (`next_step`) và kết quả chờ (đã ký/từ chối/huỷ/hết hạn → bước đích); `timed-wait-form` giữ `also_events` + `branches`.
- `AssignFlow` (platform_admin gán flow Thư viện, POST company-flows) trong `CompanyFlowList`.
- Gỡ file chết của màn cũ: `SlotRouting`, `RoutingRules`, `DrawerAssign`, `RulesSection`, `FlowDrawer`, `DrawerRunning`, `DrawerSteps`, `use-slot-routing`, `use-flow-assign`, `slot-candidates`.
- `bridge-suggest` theo hợp đồng N2: gửi `{def, from, to}` (khoá stage), nhận `{ok, stage, explain_vi/en}`; Nhận ⇒ `stageToDraft` + `insertStepAfter`.

## Không làm / Chạm (cho R1 và đợt sau)
- Trigger/Kết thúc vẫn là thẻ phía trên canvas (cột bố cục `@ai/flow-canvas` cố định) — CHƯA thành node thật.
- Chưa chụp màn hình/soát căn mép: chưa dựng được stack có hub + def có trigger.
- Còn đường cũ cho R1: `use-company-flows.ts` + `lib/flow-rows.ts` + `JobRow` (tab Ứng dụng/Tính năng của công ty vẫn đọc "việc" theo khe), `api-routing.ts` (`useTenantRouting`), `routing-current.ts` ở web-kit, chữ "khe" trong `tenants.flows.*` và `tenants.slots.*`.
- Import schema bridge từ contracts khi N2 gộp (hiện kiểu khai báo tay ở `palette-api.ts`).

## Test tối thiểu
`bun test apps/admin-web/src/features/processes apps/admin-web/src/features/tenants` → 446 xanh (mới `step-refs.test.ts`: chèn giữa dời +1, xoá đích về chưa chọn, không đổi giữ nguyên mảng). e2e qc: chèn bước giữa flow có Duyệt/Nếu/chờ ký rồi lưu (đích đúng); Nếu theo dữ kiện; gán flow cho công ty.

## Quyết định trong lúc làm
- Đích lưu theo số bước (hub chỉ nhận số), UI giữ đúng bằng remap theo `uid` stage trước/sau mỗi thay đổi bản nháp.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED platform/dich-buoc-flow.md
#### Yêu cầu: Đích bước giữ đúng khi đổi thứ tự (FLOW2-FR-12)
Chèn, kéo hoặc xoá bước thì mọi đích (Từ chối/Trả lại của Duyệt, Gộp tới, Nếu, kết quả chờ) được cập nhật; đích bị xoá về chưa chọn.
- Kịch bản: khi chèn bước ở giữa thì đích sau đó dời một bước [test: apps/admin-web/src/features/processes/lib/step-refs.test.ts » chèn bước ở giữa ⇒ mọi đích tới bước sau đó dời +1, đích trước đó giữ]
- Kịch bản: khi xoá bước đích thì đích về chưa chọn [test: apps/admin-web/src/features/processes/lib/step-refs.test.ts » xoá bước đích ⇒ đích về chưa chọn (không trỏ sai)]

## Việc còn lại
Xem "Không làm".
