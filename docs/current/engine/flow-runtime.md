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
- Kịch bản: khi cờ không bật thì runtime tắt [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts]
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

#### Yêu cầu: Gán flow có hiệu lực ngay
Sau khi gán và bật, sự kiện đầu tiên mở lượt ngay; thiếu tính năng thì làm mới catalog một lần rồi kiểm lại trước khi từ chối. Community coi bài cần duyệt khi cờ bật và có flow `post.created` đang bật.
- Kịch bản: gán + bật ⇒ sự kiện đầu tiên mở đúng 1 lượt [test: apps/hub-api/src/modules/processes/triggers/first-launch.int.test.ts]
- Kịch bản: flow duyệt bài đã gán ⇒ bài đối tác "Chờ duyệt" [test: apps/hub-api/src/modules/packs/community-flow.mount.int.test.ts]

#### Yêu cầu: Platform admin bật/tắt cờ "dùng quy trình mới" theo công ty
Cờ `flow_triggers` của công ty được đọc/đặt qua `GET/PUT /tenants/:tid/flow-settings`, chỉ platform_admin; tenant_admin và member nhận 403. Mỗi lần đổi giá trị ghi audit (người đổi, lúc đổi, giá trị cũ và mới); đặt lại đúng giá trị hiện tại không ghi audit. Tab Quy trình của công ty có công tắc cho platform_admin, bật thì hỏi xác nhận một câu.
- Kịch bản: khi platform_admin PUT `{flow_triggers:true}` rồi `false` thì GET trả đúng giá trị và audit có hai dòng (false→true, true→false); tenant_admin gọi nhận 403 [test: apps/hub-api/src/modules/processes/library/flow-settings.int.test.ts]

#### Yêu cầu: Thẻ duyệt HĐ khi công ty bật flow theo sự kiện
Công ty bật FLOW_TRIGGERS: HĐ vào bước duyệt ⇒ lượt duyệt chờ flow (máy cũ không còn duyệt/khoá HĐ); bộ điều phối mở lượt flow và gắn
vào thẻ duyệt cùng lúc tạo lượt; thẻ hiện các bước Duyệt của lượt flow. Công ty tắt cờ: giữ đường cũ.
- Kịch bản: gửi HĐ, một lượt điều phối ⇒ bước "Duyệt giá trị lớn" mở; duyệt kiểu cũ bị từ chối, HĐ không khoá [test: apps/hub-api/src/modules/processes/triggers/first-launch-contract.int.test.ts » level1 ⇒ chờ flow, một dispatchOnce ⇒ run gắn vào lượt + task 'Duyệt giá trị lớn' mở, máy cũ duyệt ⇒ APPROVAL_NOT_OPEN, HĐ không khoá]
- Kịch bản: công ty cờ tắt ⇒ máy cũ duyệt và khoá HĐ như trước [test: apps/hub-api/src/modules/processes/triggers/first-launch-contract.int.test.ts » công ty cờ TẮT: lượt giữ máy cũ (không chờ flow), duyệt máy cũ khoá HĐ như trước]
- Kịch bản: sự kiện tới task mở ≤ 5 s ở vòng thật [test: apps/hub-api/src/modules/processes/triggers/first-launch-contract.int.test.ts » perf · vòng thật: sự kiện → task Duyệt mở ≤ 5 s]
- Kịch bản: thẻ dựng bước từ lượt flow, chờ mở flow không báo kẹt [test: apps/hub-api/src/modules/packs/contracts/domain/approval-engine-card.flow.rules.test.ts » flow_steps rỗng ⇒ bước = stage Duyệt đã tới (s1 mở, s2 nhánh chưa tới bị ẩn), task + can_act theo stage mở]

#### Yêu cầu: Duyệt bài khi công ty bật flow theo sự kiện
Công ty bật FLOW_TRIGGERS và gán flow `post.created`: ngay khi bộ điều phối mở lượt, bài vào hàng "chờ người duyệt" (không đợi hết hạn
agent sàng lọc 2 phút); người duyệt duyệt được ngay. Chưa có lượt mở thì bài vẫn "đang xử lý".
- Kịch bản: đăng bài, một lượt điều phối ⇒ task Duyệt mở và người duyệt duyệt được [test: thủ công — test đã đổi tên/gộp sau lát, xem lịch sử git]
- Kịch bản: sự kiện tới task mở ≤ 5 s [test: thủ công — test đã đổi tên/gộp sau lát, xem lịch sử git]
- Kịch bản: bài chờ không screen (flow đã mở lượt) ⇒ chờ người duyệt ngay [test: apps/hub-api/src/modules/packs/community/domain/flow.rules.test.ts » CR-122 P13 · pending + không screen (flow đã mở lượt) ⇒ chờ người duyệt ngay, không đợi quá hạn]

#### Yêu cầu: Lượt duyệt chờ flow không kẹt khi không mở được quy trình
Công ty bật flow theo sự kiện: sự kiện gửi duyệt chốt mà không mở được lượt nào thì thẻ duyệt HĐ báo lý do nghiệp vụ kèm cách sửa và
cho chủ HĐ Mở lại (phát lại sự kiện mới); chờ mở quy trình quá 2 phút cũng báo kẹt; vừa gắn lượt thì thẻ hiện bước kế tiếp.
- Kịch bản: chưa gán quy trình ⇒ lý do FLOW_NOT_ASSIGNED, gán rồi Mở lại ⇒ lượt chạy [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » 0 flow khớp ⇒ lý do FLOW_NOT_ASSIGNED, gán flow + Mở lại (event_id mới) ⇒ run gắn vào lượt]
- Kịch bản: thiếu nhóm của quy trình ⇒ lý do nêu mã nhóm [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » flow cần nhóm công ty chưa có ⇒ lý do FLOW_GROUP_MISSING:<mã>]
- Kịch bản: chờ mở quy trình quá 2 phút ⇒ báo kẹt [test: apps/hub-api/src/modules/packs/contracts/domain/approval-engine-card.flow.rules.test.ts » P11b · FLOW_STARTING quá 2 phút ⇒ stalled (lý do FLOW_STARTING), còn mới ⇒ null]
- Kịch bản: vừa gắn lượt ⇒ thẻ hiện bước kế tiếp [test: apps/hub-api/src/modules/packs/contracts/domain/approval-engine-card.flow.rules.test.ts » P11b · vừa gắn run, chưa có bước mở ⇒ thẻ hiện bước kế tiếp đang chờ (không trống)]
- Kịch bản: mỗi lý do có câu riêng trên web [test: apps/workspace-web/src/features/contract-approval/lib/attention.flow.test.ts » mỗi mã có câu riêng (không rơi về câu chung)]

#### Yêu cầu: Mở lại lượt chờ flow không sinh lượt trùng
Mở lại chỉ chạy khi lượt duyệt đã kẹt thật; đang mở quy trình thì báo "Đang mở quy trình, thử lại sau ít phút". Bản ghi đã có lượt thì
lượt mới bị huỷ ngay trong lúc tạo (không có lượt mồ côi). Lỗi xử lý báo "không mở được" của một bản ghi không chặn các bản ghi khác.
- Kịch bản: bấm Mở lại hai lần cùng lúc ⇒ một lần chạy, một lần báo đang mở, đúng một lượt [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » Mở lại 2 lần song song ⇒ một 'ok' + một 409 (flow_starting), đúng 1 run]
- Kịch bản: Mở lại khi sự kiện đầu chưa xong ⇒ báo đang mở [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » Mở lại khi sự kiện đầu chưa xử lý xong ⇒ 409 (flow_starting), không phát thêm sự kiện]
- Kịch bản: bản ghi đã có lượt, sự kiện thứ hai ⇒ không tạo lượt thứ hai [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » lượt đã có run + sự kiện thứ hai tới ⇒ superseded: tx tạo run rollback, vẫn 1 run, sự kiện chốt không lỗi]
- Kịch bản: hook báo lỗi ở một bản ghi ⇒ bản ghi khác vẫn được xử lý [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » hook notLaunched ném ở một sự kiện ⇒ chỉ log, lô vẫn chốt các sự kiện khác]

#### Yêu cầu: Gửi duyệt HĐ khi công ty bật flow theo sự kiện bắt đầu lúc người dùng xác nhận
AI đọc xong (hoặc tạo tay) ⇒ HĐ là nháp chờ rà soát, vẫn có nút "Xác nhận và lưu"; chỉ khi người dùng xác nhận mới gửi sự kiện gửi duyệt
và mở quy trình; công ty tắt cờ giữ đường cũ.
- Kịch bản: nháp chờ rà soát chưa gửi sự kiện, xác nhận ⇒ một sự kiện, quy trình mở và bước Duyệt mở [test: apps/hub-api/src/modules/processes/triggers/first-launch-contract.int.test.ts » level1 ⇒ chờ flow, một dispatchOnce ⇒ run gắn vào lượt + task 'Duyệt giá trị lớn' mở, máy cũ duyệt ⇒ APPROVAL_NOT_OPEN, HĐ không khoá]
- Kịch bản: AI đọc xong khi cờ bật ⇒ không phát sự kiện [test: apps/hub-api/src/modules/packs/contracts/application/contract-flow.usecase.test.ts » cờ BẬT: AI đọc xong chưa phát (nháp chờ rà soát), không mở run cũ]
- Kịch bản: công ty cờ tắt ⇒ như cũ [test: apps/hub-api/src/modules/processes/triggers/first-launch-contract.int.test.ts » công ty cờ TẮT: lượt giữ máy cũ (không chờ flow), duyệt máy cũ khoá HĐ như trước]

#### Yêu cầu: Node Nếu của lượt mở từ sự kiện đọc dữ kiện bản ghi
Lượt flow mở từ sự kiện của app ghi lại sự kiện mở lượt, nên node Nếu đọc được dữ kiện hiện tại của bản ghi (vd giá trị HĐ) và rẽ đúng
nhánh.
- Kịch bản: HĐ 150 tr, điều kiện "lớn hơn 100 tr" ⇒ nhánh Đúng, mở "Duyệt giá trị lớn" [test: apps/hub-api/src/modules/processes/triggers/flow-branch-facts.int.test.ts » 150 tr ⇒ Nếu Đúng ⇒ 'Duyệt giá trị lớn' mở (stage 1), facts đọc 150000000]
- Kịch bản: HĐ 50 tr ⇒ nhánh Sai, mở "Duyệt giá trị nhỏ" [test: apps/hub-api/src/modules/processes/triggers/flow-branch-facts.int.test.ts » 50 tr ⇒ Nếu Sai ⇒ 'Duyệt giá trị nhỏ' mở (stage 2)]

#### Yêu cầu: Người duyệt quyết bước Duyệt của lượt flow theo sự kiện
Người duyệt thuộc phòng của bước (kể cả không thấy hợp đồng theo cây tổ chức) bấm Đạt trên thẻ duyệt thì bước được duyệt, quy trình
chạy tiếp tới Kết thúc và hợp đồng được khoá Đã duyệt.
- Kịch bản: người duyệt ngoài cây bấm Đạt ⇒ bước qua, HĐ khoá [test: apps/hub-api/src/modules/processes/triggers/flow-approve-act.int.test.ts » getApproval ⇒ bước mở + task, act approve (người duyệt) ⇒ passed ⇒ Kết thúc ⇒ HĐ khoá]

#### Yêu cầu: Một khoá bản ghi hợp đồng `contract_id` (CR-122 p17)
Mọi flow/mẫu Thư viện/input lượt của app Hợp đồng dùng một khoá `contract_id` (hub 0112 đổi dữ liệu đã lưu, không đụng snapshot lượt đang chạy). Cạnh nối hai node khớp khoá tuyệt đối: lệch khoá ⇒ báo thiếu và gợi ý cầu nối AI; snapshot lượt cũ khoá `contract-id` vẫn dựng được tham số.
- Kịch bản: khi chạy hub 0112 trên def nháp, đã xuất bản, bản công ty và release chứa `contract-id` thì khoá thành `contract_id`, snapshot lượt và def dlc không đổi, chạy lại vô hại [test: apps/hub-api/src/modules/processes/library/contract-id-key.int.test.ts » CR-122 p17 · hub 0112 contract-id → contract_id]
- Kịch bản: khi cạnh nối có khoá lệch (contract-id vs contract_id) thì edgeIssues báo thiếu [test: packages/contracts/src/app-manifest/nodes.rules.test.ts » FLOW2-FR-26 · edgeIssues]
- Kịch bản: khi snapshot lượt cũ khai contract-id mà input lượt là contract_id thì buildToolArgs vẫn dựng được [test: apps/hub-api/src/modules/processes/domain/tools/tool-input-key.test.ts » CR-122 · khoá input coi - và _ là một]

#### Yêu cầu: Khoá đầu vào cho phép `_` (CR-122 p17)
Khoá đầu vào quy trình/run (khai input, nguồn `input` của tool/Nếu/Chờ/Ghi giá trị) theo `^[a-z0-9_-]{2,32}$`; khoá nguồn tham chiếu vẫn `^[a-z0-9-]{2,32}$`.
- Kịch bản: khi khai input hoặc nguồn tham số tool khoá `contract_id` thì hợp lệ, khoá nguồn có `_` vẫn bị từ chối [test: packages/contracts/src/hub-admin/input-key.test.ts » CR-122 p17 · khoá đầu vào]

#### Yêu cầu: Output node Ghi giá trị tới bước tool kế (CR-122 p17)
Đầu vào của node tool (manifest) chưa có nguồn khai rõ và không có trong input lượt được tự nối với trường cùng khoá ở stage gần nhất phía trước; nhờ đó node Ghi giá trị do AI sinh (X → Y) làm bước tool nhận đúng giá trị lúc chạy.
- Kịch bản: khi lượt chỉ có input ma_hd, cầu nối AI ghi contract_id từ ma_hd, thì bước Ký số có args contract_id từ trường cầu nối và buildToolArgs ra đúng giá trị [test: apps/hub-api/src/modules/processes/adapters/tools/tool-auto-args.int.test.ts » cầu nối Ghi giá trị (dạng AI sinh) ⇒ bước Ký số nhận đúng giá trị qua buildToolArgs]

#### Yêu cầu: Bước tự động lỗi nói rõ vì sao và làm gì
Khi stage `tool` chuyển `needs_decision` vì `tool_failed`, engine ghi mã máy của lỗi vào `last_error_code` của stage (mã của tool, hoặc
`TOOL_OFF`, `NO_REAL_ACTION`, `INPUT_SCHEMA_INVALID`, `MISSING_ARG:<tên>`, `RESULT_TOO_LARGE`, `OUTPUT_REJECTED`, `TOOL_CRASH`) và log
cảnh báo kèm khoá tool + mã. Thẻ duyệt hợp đồng mang mã ở `attention.code` và hiện câu tiếng Việt/Anh nêu nguyên nhân và cách xử lý
(vd chưa bật ký số ⇒ vào Cài đặt › Ký số bật rồi Thử lại); mã lạ ⇒ câu chung kèm mã. Các nút quyết định giữ nguyên.
- Kịch bản: khi tool Ký số trả `ESIGN_DISABLED` thì stage `needs_decision`, `last_error_code = ESIGN_DISABLED` và thẻ duyệt có `attention.code` [test: apps/hub-api/src/modules/processes/adapters/tools/tool-fail-reason.int.test.ts » tool trả ESIGN_DISABLED ⇒ stage needs_decision, last_error_code, thẻ có code]
- Kịch bản: khi thiếu đầu vào của tool thì `last_error_code = MISSING_ARG:<tên>` [test: apps/hub-api/src/modules/processes/adapters/tools/tool-fail-reason.int.test.ts » thiếu đầu vào ⇒ MISSING_ARG:<tên>]
- Kịch bản: khi hiển thị thẻ với mã đã biết thì dùng câu riêng, mã lạ dùng câu chung kèm mã [test: apps/workspace-web/src/features/contract-approval/lib/attention.tool.test.ts » mã lạ ⇒ câu chung kèm mã, không mã ⇒ câu cũ]
- Kịch bản: khi tool Ký số ném lỗi nghiệp vụ thì kết quả có mã đó, không phải `UPSTREAM_ERROR` [test: apps/hub-api/src/modules/packs/contracts/adapters/intake.errors.test.ts » qua registry: mã nghiệp vụ giữ nguyên, lỗi mạng ⇒ UPSTREAM_ERROR]

#### Yêu cầu: Node Nếu không rẽ khi thiếu dữ kiện (CR-122 P18)
Điều kiện của node Nếu đọc dữ kiện app (`fact`) hoặc input run mà giá trị còn trống (null, "", danh sách rỗng; so số mà giá trị
không phải số) và kết quả phụ thuộc vào vế đó ⇒ engine KHÔNG chọn nhánh: stage Nếu và lượt chạy `needs_decision` với
`decision.reason = missing_fact`, `decision.missing` = khoá còn thiếu, lựa chọn Thử lại (`add_attempt`, xếp lại Nếu để đọc lại
dữ kiện hiện tại) hoặc Huỷ. Thẻ duyệt hợp đồng nêu nhãn trường ("Thiếu Giá trị hợp đồng — điền vào hợp đồng rồi bấm Thử lại")
và nút Thử lại cho chủ hợp đồng/quản trị gói.
- Kịch bản: Giá trị trống ⇒ Nếu + run needs_decision missing_fact, không ghi lần rẽ; điền giá trị + chạy lại Nếu ⇒ rẽ đúng nhánh [test: apps/hub-api/src/modules/processes/adapters/runs/flow-step.repo.int.test.ts » CR-122 P18 · trường trống ⇒ KHÔNG rẽ]
- Kịch bản: giá trị không phải số khi so số ⇒ cũng là thiếu [test: apps/hub-api/src/modules/processes/adapters/runs/flow-step.repo.int.test.ts » CR-122 P18 · số không hợp lệ]
- Kịch bản: AND có vế chắc Sai / OR có vế chắc Đúng ⇒ không dừng vì vế thiếu [test: apps/hub-api/src/modules/processes/domain/if/if.rules.test.ts » kết quả đã rõ]
- Kịch bản: thẻ duyệt nêu nhãn trường từ manifest, không lộ khoá [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-card.usecase.test.ts » CR-122 P18]
- Kịch bản: banner hiện câu "Thiếu <nhãn> — … Thử lại" [test: apps/workspace-web/src/features/contract-approval/lib/attention.test.ts » CR-122 P18]

#### Yêu cầu: Trigger DEFERRED của gói chạy dưới role gói
Trigger ràng buộc DEFERRED của gói chạy dưới role gói trong `withPackRoleInTx`, nên HĐ bán được duyệt qua flow sang hiệu lực không kẹt lúc COMMIT bằng `hub_api`.
- Kịch bản: khi HĐ bán được duyệt qua flow thì trigger DEFERRED chạy dưới role gói, không lỗi lúc COMMIT [test: apps/hub-api/src/modules/packs/kit/adapters/pack-role-in-tx.int.test.ts » CR-122 · trigger DEFERRED của gói (HĐ bán sang hiệu lực) chạy dưới role gói, không lỗi lúc COMMIT bằng hub_api]

## CR-124/125 · Delta gộp 2026-11-08 (đợt cr124-cr125)

#### Yêu cầu: Hộp thư liên công ty (CR-124 FLOW4-NFR-01/02/03) (nguồn: cr124-q1-mailbox)
Lần gửi HĐ giữa hai công ty là một dòng `hub.partner_mailbox` chỉ chứa bản chia sẻ; role gói và request người dùng không đọc/ghi thẳng bảng, chỉ qua `hub.partner_send` (bên gửi = tenant hiện tại), `hub.partner_reply` (bên nhận qua quy trình nhận, hoặc bên gửi ghi nhận thủ công) và `hub.partner_mailbox_mine` (chỉ cột trạng thái của dòng mình). Bộ chuyển theo lô (scope system, SKIP LOCKED, 3 câu SQL mỗi lô) phát `contract.received` vào tenant nhận và `partner.confirmed|returned|declined` vào tenant gửi, mỗi lần gửi đúng một sự kiện mỗi chiều.
- Kịch bản: khi role gói hoặc scope user đọc/ghi bảng hộp thư thì bị chặn [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » role gói và scope user không đọc/ghi thẳng bảng]
- Kịch bản: khi gửi với from_tenant khác tenant hiện tại thì lỗi 42501 [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » partner_send giả from_tenant / chưa đặt tenant ⇒ 42501]
- Kịch bản: khi trả lời từ tenant không phải bên nhận thì lỗi 42501, mỗi bên chỉ thấy dòng của mình [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » partner_reply sai tenant ⇒ 42501, mine chỉ thấy dòng của mình, không lộ from_ref cho bên nhận]
- Kịch bản: khi gửi qua nền tảng tới công ty chưa chấp nhận nối hoặc đã chặn thì lỗi 42501 [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » kênh nền tảng chỉ khi bên nhận đã chấp nhận nối (chưa nối / đã chặn ⇒ 42501)]
- Kịch bản: khi bên gửi ghi nhận thủ công kèm bằng chứng thì lần gửi thành đã trả lời, người ghi lấy từ phiên đăng nhập, bên nhận không ghi được [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » ghi nhận thủ công chỉ bởi bên gửi có người ghi, kênh manual cần 1–20 tệp bằng chứng, gọi lại cùng kết quả ⇒ false]
- Kịch bản: khi hai Hub cùng chạy bộ chuyển hoặc chạy lại thì chỉ một sự kiện nhận và một sự kiện kết quả [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » hai worker + chạy lại ⇒ đúng một contract.received (bên nhận) và một partner.returned (bên gửi)]
- Kịch bản: khi lô 5 hay 100 dòng thì số câu SQL như nhau [test: apps/hub-api/src/modules/partners/mailbox-mover.perf.int.test.ts » số câu SQL mỗi lô không phụ thuộc số dòng]

#### Yêu cầu: Khởi động dừng khi node khai đầu ra mà máy chủ không ghi (nguồn: cr125-m8-io-ports)
Binding khai các khoá đầu ra máy chủ thật sự ghi; khai báo và binding lệch (thiếu, thừa, hoặc còn đánh dấu chờ) ⇒ MOD_OUTPUT_UNBOUND, hub không lên, câu tiếng Việt nói node, cổng và file cần sửa. Bước Duyệt ghi thêm góp ý của người duyệt vào dữ liệu của bước.
- Kịch bản: binding không ghi đầu ra đã khai ⇒ «Khởi động dừng» kèm câu MOD_OUTPUT_UNBOUND [test: apps/hub-api/src/modules/packs/kit/adapters/module-registry.test.ts » MOD_OUTPUT_UNBOUND (CR-125 m8)]
- Kịch bản: sổ thật (core + Ký số + Gửi đối tác + Hiện bài) × binding thật ⇒ không lỗi đầu ra [test: apps/hub-api/src/modules/packs/packs.modules-outputs.test.ts » đầu ra khai báo × binding thật]
- Kịch bản: Duyệt ghi quyết định + người duyệt + góp ý (trống ⇒ không có khoá) [test: apps/hub-api/src/modules/processes/gates/approve-out.test.ts » approveFields (CR-125 m8 · đầu ra Duyệt)]
- Kịch bản: hub mount thật ⇒ verify 0 lỗi, binding Duyệt/Ký số/Gửi đối tác khai đúng đầu ra [test: apps/hub-api/src/modules/packs/packs.module-registry.int.test.ts » sổ module · mount thật]

#### Yêu cầu: Bước chờ sự kiện ghi dữ liệu kèm sự kiện vào đầu ra của bước (nguồn: cr125-m9-outputs-runstate)
Gói bắn sự kiện kèm dữ liệu (khoá snake_case, giá trị vô hướng); khi sự kiện đó thả bước chờ, dữ liệu vào đầu ra của bước trong cùng giao dịch, không ghi đè kết quả sự kiện, bắn lại không đổi gì; sự kiện khác thắng ⇒ không lẫn dữ liệu.
- Kịch bản: Ký số xong ⇒ bước chờ có thời điểm ký, người ký, mã phong bì; bắn lại không đổi; Thông báo sau đó hiện «Đã ký ngày {signed_at}» và ghi người nhận [test: tests/acceptance/CR-125/outputs-runstate.int.test.ts » Ký số xong ⇒ bước chờ có signed_at/signer/envelope_id · bắn lại không đổi · Thông báo sau đó dựng {signed_at} + ghi sent_to]
- Kịch bản: đối tác trả lại sửa ⇒ bước chờ có lần gửi + lý do; công ty khác bắn cùng bản ghi không thả [test: tests/acceptance/CR-125/outputs-runstate.int.test.ts » Gửi đối tác: trả lại sửa ⇒ bước chờ có round + partner_reason · dữ liệu của sự kiện khác không lẫn vào]
- Kịch bản: lọc dữ liệu kèm, chỉ áp cho sự kiện thắng [test: apps/hub-api/src/modules/processes/domain/timers/wait-event-data.rules.test.ts » đúng sự kiện thắng ⇒ gộp dữ liệu kèm, `event` không bị ghi đè]
- Kịch bản: phong bì trạng thái cuối ⇒ đầu ra Ký số [test: apps/hub-api/src/modules/packs/contracts/domain/esign-outputs.rules.test.ts]

#### Yêu cầu: Thông báo đọc đầu ra các bước trước (nguồn: cr125-m9-outputs-runstate)
Mẫu `{khoá}` của Thông báo lấy giá trị từ đầu ra các bước đứng trước và dữ liệu của lượt; Thông báo ghi người nhận (`sent_to`) vào đầu ra của bước.
- Kịch bản: `{signed_at}` lấy từ đầu ra Ký số, input thắng khi trùng khoá [test: apps/hub-api/src/modules/processes/nodes/notify/notify-vars.test.ts » `{signed_at}` lấy từ đầu ra bước Ký số · bước sau đè bước trước · input thắng khi trùng]

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Gửi form của bước chỉ do nhóm làm, lưu giá trị làm đầu ra, mở bước kế (nguồn: cr125-form-step-card)
Gửi form (`POST /review-tasks/:id/form`) từ thẻ HĐ: chỉ người thuộc nhóm làm của bước được gửi (người ngoài nhóm và người công ty khác nhận 404); giá trị sai theo snapshot run ⇒ 422 `FORM_VALUES_INVALID` và bước vẫn mở; đúng ⇒ giá trị lưu ở đầu ra của bước, bước kế mở, người xem sau thấy giá trị đã gửi trên thẻ; gửi lại cùng giá trị không lỗi.
- Kịch bản: khi người ngoài nhóm làm hoặc người công ty khác gửi form thì 404 và bước vẫn mở [test: apps/hub-api/src/modules/processes/triggers/flow-form-step-card.int.test.ts » quyền: người ngoài nhóm làm ⇒ 404]
- Kịch bản: khi giá trị đúng thì đầu ra lưu đúng, bước Duyệt mở và thẻ người sau có giá trị [test: apps/hub-api/src/modules/processes/triggers/flow-form-step-card.int.test.ts » giá trị sai ⇒ 422 FORM_VALUES_INVALID, bước vẫn mở]
- Kịch bản: khi Phần 1 «Mua hàng» chạy từ đầu tới PO thì mọi bước form điền được bằng giao diện kèm tệp [test: e2e/journey-approval/cr125-form-step-card.spec.ts » Phần 1 «Mua hàng»: mọi bước điền thông tin + đính kèm tệp làm trên giao diện, tới Kết thúc]

#### Yêu cầu: Nhãn chờ duyệt thống nhất (nguồn: cr125-g2-wait-labels)
Trạng thái run, ghi chú bước và dòng thời gian cùng dùng một nhãn "Đang chờ người duyệt"; admin-web dịch trạng thái `waiting_review` bằng khoá i18n.
- Kịch bản: khi run ở waiting_review thì nhãn trạng thái và ghi chú bước giống nhau [test: apps/hub-api/src/modules/processes/domain/runs/run-log-text.rules.test.ts » CR-125 G2 · một nhãn chờ duyệt]
- Kịch bản: khi admin xem run waiting_review thì dòng trạng thái lấy từ khoá i18n [test: apps/admin-web/src/features/processes/lib/run-detail-view.test.ts » runStatusLine (CR-125 G2)]

#### Yêu cầu: Tệp đính kèm của lượt mở được bởi người xem lượt (nguồn: cr125-run-attachments)
Tệp người điền ở phiếu «Tạo yêu cầu» hoặc bước form được liên kết vào lượt; mọi người xem được lượt (người tạo, người được giao, quản trị công ty) mở tệp qua `/attachments/:id/content`; người khác cùng công ty và công ty khác nhận 404. Lượt con nhận tệp được truyền qua `input_map`.
- Kịch bản: khi người bước form tải tệp và gửi thì người duyệt bước sau mở được tệp, người ngoài cùng công ty và công ty khác nhận 404 [test: apps/hub-api/src/modules/processes/triggers/flow-form-step-card.int.test.ts » tệp bước form]
- Kịch bản: khi lượt cha truyền tệp qua input_map thì lượt con kế thừa liên kết, tệp không truyền thì không [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » tệp truyền qua input_map]



## Delta gộp 2026-11-09 (đợt cr125-wave)
Mục dưới thắng nội dung cũ cùng chủ đề ở trên (lát: cr121-q1-app-filter-contract-label).

#### Yêu cầu: Nhãn hợp đồng thật ở trang chi tiết lượt chạy (nguồn: cr121-q1-app-filter-contract-label)
Nguồn gắn lượt hiển thị mã HĐ thật và tên HĐ do gói contracts đặt (một câu theo tập id, dưới RLS tenant của lượt); không có nhãn thì giữ "HĐ <8 ký tự id>".
- Kịch bản: khi lượt gắn một HĐ có số HD-Q1-001 thì nguồn hiện "HĐ HD-Q1-001 · Thuê kho Q1" [test: apps/hub-api/src/modules/processes/runs/run-detail.int.test.ts » R-4 · nguồn hợp đồng và lượt đã chạy lại]
- Kịch bản: khi gói không trả nhãn thì giữ nhãn cũ theo id [test: apps/hub-api/src/modules/processes/runs/run-detail.map.test.ts » gói hợp đồng ⇒ kind contract + nhãn HĐ + app_key]
## CR-120/121 · Delta gộp 2026-11-09 (đợt cr125-wave)

#### Yêu cầu: Flow runtime mặc định bật, `HUB_FLOW_RUNTIME=off` tắt (FLOW-FR-06) (nguồn: cr120-runtime-on, cr121-a1-drop-legacy-view)
Route flow chung của kit gắn mặc định; chỉ `HUB_FLOW_RUNTIME=off` tắt (route 404, `/pack/me.flags["flow.runtime"]=false`); seam test thắng env. Deploy kit prod đặt mặc định `on`. Từ CR-121 không còn đường rollback ở web: `FlowRuntime.act` luôn gọi route flow (`legacy-act` và endpoint approvals cũ làm đường dự phòng đã gỡ), tắt runtime ⇒ lỗi 404 hiện cho người dùng. Code: `packs/kit/application/flow.ports.ts` (`flowRuntimeOn`).

#### Yêu cầu: Hành động qua FlowRuntime idempotent, quyền như đường cũ (FLOW-FR-06) (nguồn: cr120-runtime-on)
Hành động `contracts.approval` qua flow gọi CÙNG use case thẻ duyệt, kèm `expect {taskId, step}`; use case kiểm lại (trong khoá HĐ) nên bấm lại hoặc hai người đua cùng task chỉ quyết một lần (bấm lại ⇒ 409, bước kế vẫn mở). Quyền, mã lỗi (thiếu lý do…) như đường cũ; không vai ⇒ 403; đối tác 403; tenant khác 403/404, không đổi trạng thái.

#### Yêu cầu: Rẽ theo dữ kiện hiện tại của HĐ (nguồn: cr121-d1-facts)
Tool `contracts-route`/`contracts-finalize` xét điều kiện bước trên loại HĐ, giá trị, phòng ban người bắt đầu lượt (gồm phòng cha, `creator_department in [...]`) và đối tác mới (HĐ chưa gắn đối tác hoặc chưa có HĐ duyệt cùng đối tác ⇒ mới), đọc lại mỗi lần rẽ (sửa giá trị giữa lượt có hiệu lực ở lần rẽ sau); thiếu dữ liệu ⇒ bước chạy; không đọc dữ liệu tenant khác. `contracts-finalize` kiểm lại cùng dữ kiện. Code: `packs/contracts/adapters/flow-facts.repo`.

#### Yêu cầu: Lượt quá hạn hết hạn ở lượt quét kế dù tin thread đang đăng (nguồn: cr126-expire-race)
Lượt quá hạn (`expires_at` đã qua) chỉ được để lượt sau khi một thao tác đang đổi trạng thái lượt giữ nó (`claimExpired` khoá `FOR NO KEY UPDATE SKIP LOCKED`); việc đăng tin thread hay chèn dữ liệu con của lượt (`lockEventRun` khoá `FOR KEY SHARE`) không làm lượt quét hết hạn bỏ qua lượt đó.
- Kịch bản: khi bước vừa xong chuyển lượt quá hạn sang chờ duyệt (tin thread đang đăng) thì lượt quét kế đặt lượt thành hết hạn [test: tests/acceptance/P-a/pf1/lock-order.int.test.ts » P1-48e · ×20: job stage xong (apply) ∥ sweepOnce (hết hạn) ⇒ cuối cùng expired]
