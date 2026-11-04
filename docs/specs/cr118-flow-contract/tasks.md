---
id: cr118-flow-contract
lát: cr118-flow-contract
cr: CR-118
làn: đầy đủ (contract nhiều lát dựa vào + quyền/tenant + đường nóng summary)
migration: không
phụ thuộc: đợt 1 CR-118
---
## Plan (ngắn)
Nguồn: intake CR-118 PHẦN B (câu 13 = mức 2, câu 14 = chỉ `contracts.approval`, câu 17 = người làm node `form` theo phòng ban, đối tác không bao giờ). ADR-0035.
1. Contract `@ai/contracts/flow`: FlowView / FlowStepKind (review|dify|esign|form|wait|system) / FlowForm (tập con) / FlowActionRequest/Result / FlowSummary (≤ 100).
2. Kit: `FlowSlotAdapter` + `flowRuntime` + route view/act/summary sau packGuard, cờ `HUB_FLOW_RUNTIME` (mặc định tắt).
3. Adapter `contracts.approval` bọc `getApproval`/`actApproval` (không đổi hành vi) + chiếu thẻ ⇒ FlowView (luật thuần) + repo summary 1 câu SQL.
4. Test trước: round-trip contract, tương đương thẻ↔FlowView, đếm SQL, int đường chính + chéo tenant + đối tác, perf summary.

## Làm
- [x] `packages/contracts/src/flow/{form,view,index}.ts` (+ export gốc và `@ai/contracts/flow`)
- [x] `hub-api packs/kit/application/flow.ports.ts`, `kit/adapters/flow.routes.ts`
- [x] `contracts/domain/approval-flow-view.rules.ts`, `application/approval-flow-slot.usecase.ts`, `adapters/approval-flow-summary.repo.ts`, `flow.mount.ts`; nối trong `extraction.mount.ts` (approvalModule)
- [x] ADR-0035

## Không làm / Chạm
Không web (lát `cr118-flow-web`), không executor `form` (lát `cr118-node-form`), không đổi trạng thái run/engine, không route đóng băng `processes`, không migration, không DLC.

## Test tối thiểu
- unit: `packages/contracts/src/flow/flow.test.ts`, `contracts/domain/approval-flow-view.rules.test.ts`, `contracts/application/approval-flow-slot.usecase.test.ts`
- int (evotest): `tests/acceptance/CR118/approval-flow-runtime.int.test.ts`; perf: `tests/acceptance/CR118/approval-flow-summary.perf.int.test.ts`

## Quyết định trong lúc làm
- Tên schema có tiền tố `Flow*View`/`FlowForm*` để không trùng `FlowStepSchema` (luồng duyệt HĐ) đã có ở gốc `@ai/contracts`.
- Mốc giờ trong FlowView là chuỗi ≤ 40 (không `z.iso.datetime()`): thẻ Ký số trả ISO có thể kèm offset.
- `snapshot_version` = `contracts.approvals.flow_version` (phiên bản def engine chụp khi mở run); máy cũ ⇒ null. View thêm đúng 1 câu SQL (dùng chung repo summary).
- Huy hiệu summary chỉ từ dữ liệu gói (1 câu): `attention` = lượt engine kẹt chưa có run hoặc Ký số cần quyết; lý do chi tiết (run `needs_decision`/kết thúc bất thường) chỉ ở `view` (cần engine — tránh N+1).
- Hành động: task id phải khớp task đang mở của người xem (bấm trên view cũ ⇒ 409 `APPROVAL_NOT_OPEN`); `values` (form) ở khe approval ⇒ 422 `FLOW_INPUT_INVALID`; `extension` = `contracts.product-links` chỉ cho Duyệt.
- Đối tác: chặn ở `flowRuntime` (trước gói) ngoài tường lửa sẵn có ⇒ 403.
- Test int đặt ở `tests/acceptance/CR118/` (dùng hạ tầng CF; `tsconfig` của hub-api không có lib DOM cho helper acceptance) ⇒ cần qc ghi lock.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/flow-runtime.md
#### Yêu cầu: Contract view model flow tại khe (UW-FR-10, UW-FR-12)
`@ai/contracts/flow` mô tả FlowView (khe, ref, lượt + snapshot_version, trạng thái chung, bước theo loại review|dify|esign|form|wait|system, task đang mở + hành động có đầu vào định kiểu), FlowForm (tập con cố định ≤ 20 trường, nhãn text thuần, không HTML/biểu thức), FlowActionRequest/Result, FlowSummary (lô ≤ 100). Map renderer thiếu một loại bước là lỗi typecheck.
- Kịch bản: khi FlowView có đủ mọi loại bước và mọi kiểu đầu vào hành động đi qua JSON thì parse lại ra y hệt [test: packages/contracts/src/flow/flow.test.ts » FlowView round-trip]
- Kịch bản: khi form có nhãn HTML, trường lạ, khoá trùng hoặc > 20 trường thì bị từ chối [test: packages/contracts/src/flow/flow.test.ts » form: nhãn HTML]
- Kịch bản: khi giá trị gửi lên có trường ngoài form snapshot, vượt giới hạn hoặc thiếu bắt buộc thì validator từ form từ chối [test: packages/contracts/src/flow/flow.test.ts » validator từ form snapshot]
- Kịch bản: khi map renderer thiếu một loại bước thì typecheck báo lỗi [test: packages/contracts/src/flow/flow.test.ts » renderer map exhaustive]
#### Yêu cầu: Endpoint flow chung của kit (UW-FR-11, UW-FR-14)
`GET /pack/:k/flow/:slot/:ref`, `POST /pack/:k/flow/:slot/:ref/tasks/:id/actions/:action`, `POST /pack/:k/flow/:slot/summary` sau packGuard (read/write), bật bằng `HUB_FLOW_RUNTIME=on` (mặc định tắt ⇒ 404). Gói cung cấp FlowSlotAdapter; ref tra trong tx tenant của gói (không thấy ⇒ vắng/404). Đối tác bị chặn (403). Summary: số câu SQL cố định mỗi lô, p95 ≤ 50 ms lô 100.
- Kịch bản: khi cờ không bật thì runtime tắt [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts » cờ: mặc định TẮT]
- Kịch bản: khi đối tác gọi view/act/summary thì bị chặn trước khi gói được gọi [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts » runtime: đối tác ⇒ forbidden; tests/acceptance/CR118/approval-flow-runtime.int.test.ts » đối tác (user ngoài acme)]
- Kịch bản: khi người tenant khác gọi view/act/summary HĐ acme thì 403/404, không lộ dữ liệu [test: tests/acceptance/CR118/approval-flow-runtime.int.test.ts » tenant khác (Db, beta)]
- Kịch bản: khi summary lô 100 có ref tenant khác/không tồn tại thì chỉ trả HĐ thấy được; lô 101 ⇒ 400 [test: tests/acceptance/CR118/approval-flow-runtime.int.test.ts » summary lô 100]
- Kịch bản: khi summary lô 1 hay 100 thì đúng một câu SQL [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts » repo summary: số câu SQL cố định]
- Kịch bản: khi summary lô 100 HĐ có lượt duyệt qua HTTP thì p95 ≤ 50 ms [test: tests/acceptance/CR118/approval-flow-summary.perf.int.test.ts » summary lô 100 HĐ có lượt duyệt]
#### Yêu cầu: Khe contracts.approval qua FlowRuntime (UW-FR-13)
Adapter bọc thẻ duyệt hiện có: FlowView = chiếu của thẻ (`GET …/approval`) cho cùng người xem; hành động qua flow = hành động thẻ (quyền bước do engine/máy trạng thái); task id không khớp task đang mở ⇒ 409.
- Kịch bản: khi chiếu các thẻ mẫu CF (engine 2 bước, Dify, Ký số, duyệt cuối, kẹt, máy cũ) thì mọi trường thẻ có mặt ở FlowView [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-view.rules.test.ts » tương đương]
- Kịch bản: khi A/B/H xem HĐ đang duyệt trên engine thì GET flow == chiếu thẻ duyệt của chính họ [test: tests/acceptance/CR118/approval-flow-runtime.int.test.ts » GET FlowView == chiếu thẻ]
- Kịch bản: khi bấm với task cũ thì 409; Duyệt đúng task thì bước kế mở [test: tests/acceptance/CR118/approval-flow-runtime.int.test.ts » act qua flow; apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts » act: task cũ]

## Kết quả đo
- evotest int `tests/acceptance/CR118/approval-flow-runtime.int.test.ts`: 5 pass / 0 fail.
- evotest perf summary lô 100 (HTTP, có lượt duyệt): p50 7.9 ms · p95 27.7 ms · max 27.9 ms (ngưỡng p95 ≤ 50 ms).

## Việc còn lại
- qc: ghi lock cho `tests/acceptance/CR118/*` (`bun run test:lock:write`).
- Lát `cr118-flow-web` dùng `@ai/contracts/flow`; `cr118-node-form` thêm executor `form` (contract đã có).
