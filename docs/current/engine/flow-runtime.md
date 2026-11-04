# Engine · FlowRuntime của kit (contract + endpoint chung)

Cập nhật: 2026-11-04 · Nguồn: CR-118 (cr118-flow-contract). Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Contract view model flow tại khe (UW-FR-10, UW-FR-12) (nguồn: cr118-flow-contract)
`@ai/contracts/flow` mô tả FlowView (khe, ref, lượt + snapshot_version, trạng thái chung, bước theo loại review|dify|esign|form|wait|system, task đang mở + hành động có đầu vào định kiểu), FlowForm (tập con cố định ≤ 20 trường, nhãn text thuần, không HTML/biểu thức), FlowActionRequest/Result, FlowSummary (lô ≤ 100). Map renderer thiếu một loại bước là lỗi typecheck.
- Kịch bản: khi FlowView có đủ mọi loại bước và mọi kiểu đầu vào hành động đi qua JSON thì parse lại ra y hệt [test: packages/contracts/src/flow/flow.test.ts » FlowView round-trip]
- Kịch bản: khi form có nhãn HTML, trường lạ, khoá trùng hoặc > 20 trường thì bị từ chối [test: packages/contracts/src/flow/flow.test.ts » form: nhãn HTML]
- Kịch bản: khi giá trị gửi lên có trường ngoài form snapshot, vượt giới hạn hoặc thiếu bắt buộc thì validator từ form từ chối [test: packages/contracts/src/flow/flow.test.ts » validator từ form snapshot]
- Kịch bản: khi map renderer thiếu một loại bước thì typecheck báo lỗi [test: packages/contracts/src/flow/flow.test.ts » renderer map exhaustive]
#### Yêu cầu: Endpoint flow chung của kit (UW-FR-11, UW-FR-14) (nguồn: cr118-flow-contract)
`GET /pack/:k/flow/:slot/:ref`, `POST /pack/:k/flow/:slot/:ref/tasks/:id/actions/:action`, `POST /pack/:k/flow/:slot/summary` sau packGuard (read/write), bật bằng `HUB_FLOW_RUNTIME=on` (mặc định tắt ⇒ 404). Gói cung cấp FlowSlotAdapter; ref tra trong tx tenant của gói (không thấy ⇒ vắng/404). Đối tác bị chặn (403). Summary: số câu SQL cố định mỗi lô, p95 ≤ 50 ms lô 100.
- Kịch bản: khi cờ không bật thì runtime tắt [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts » cờ: mặc định TẮT]
- Kịch bản: khi đối tác gọi view/act/summary thì bị chặn trước khi gói được gọi [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts » runtime: đối tác ⇒ forbidden; tests/acceptance/CR118/approval-flow-runtime.int.test.ts » đối tác (user ngoài acme)]
- Kịch bản: khi người tenant khác gọi view/act/summary HĐ acme thì 403/404, không lộ dữ liệu [test: tests/acceptance/CR118/approval-flow-runtime.int.test.ts » tenant khác (Db, beta)]
- Kịch bản: khi summary lô 100 có ref tenant khác/không tồn tại thì chỉ trả HĐ thấy được; lô 101 ⇒ 400 [test: tests/acceptance/CR118/approval-flow-runtime.int.test.ts » summary lô 100]
- Kịch bản: khi summary lô 1 hay 100 thì đúng một câu SQL [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts » repo summary: số câu SQL cố định]
- Kịch bản: khi summary lô 100 HĐ có lượt duyệt qua HTTP thì p95 ≤ 50 ms [test: tests/acceptance/CR118/approval-flow-summary.perf.int.test.ts » summary lô 100 HĐ có lượt duyệt]
#### Yêu cầu: Khe contracts.approval qua FlowRuntime (UW-FR-13) (nguồn: cr118-flow-contract)
Adapter bọc thẻ duyệt hiện có: FlowView = chiếu của thẻ (`GET …/approval`) cho cùng người xem; hành động qua flow = hành động thẻ (quyền bước do engine/máy trạng thái); task id không khớp task đang mở ⇒ 409.
- Kịch bản: khi chiếu các thẻ mẫu CF (engine 2 bước, Dify, Ký số, duyệt cuối, kẹt, máy cũ) thì mọi trường thẻ có mặt ở FlowView [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-view.rules.test.ts » tương đương]
- Kịch bản: khi A/B/H xem HĐ đang duyệt trên engine thì GET flow == chiếu thẻ duyệt của chính họ [test: tests/acceptance/CR118/approval-flow-runtime.int.test.ts » GET FlowView == chiếu thẻ]
- Kịch bản: khi bấm với task cũ thì 409; Duyệt đúng task thì bước kế mở [test: tests/acceptance/CR118/approval-flow-runtime.int.test.ts » act qua flow; apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts » act: task cũ]
