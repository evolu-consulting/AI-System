---
id: cr118-form-node
lát: cr118-form-node
cr: CR-118
làn: đầy đủ (trạng thái run)
migration: không
phụ thuộc: cr118-flow-contract (song song; FormField định nghĩa ở đây, điều phối gộp)
---
## Plan (ngắn)
Node `form` (họ work) theo registry: stage chạy như `set` + `after: review` — launcher ghi output "chờ điền" ⇒ `waiting_review`
+ task cho Group của bước (luật người làm = cổng kiểm: Group/Group chuyển cấp/trưởng phòng/also, exclude_starter). Người
điền gửi `POST /review-tasks/:id/form {values}` ⇒ `GateService.formSubmit`: khoá run, kiểm theo trường form của SNAPSHOT,
ghi field vào output hiện hành + audit + Đạt (đóng task, chuyển bước) trong CÙNG tx. Gửi lại cùng giá trị ⇒ 200 cùng thẻ.

## Làm
- [x] Contract `packages/contracts/src/hub-admin/process-form.ts`: `FormFieldSchema` (text, textarea, number, money, date,
  select, checkbox, file_ref; ≤ 20 trường; nhãn văn bản thuần), `FormExecutorSchema`, `FormSubmitRequestSchema`,
  `PROCESS_FORM_ERRORS.FORM_VALUES_INVALID` (422 {paths}); `EXECUTOR_KINDS`/`NODE_FAMILY_OF`/`NODE_PRODUCES` + `FORM_INVALID`.
- [x] Hub `nodes/form/{node,launch}.ts` + đăng ký registry; `domain/form/form.rules.ts` (kiểm thuần); `gates/form-out.ts`
  (chặn đối tác, kiểm snapshot, ghi output, audit, gửi lại); `GateService.formSubmit` + route `POST /review-tasks/:id/form`.
- [x] admin-web: mục registry stub (giữ `fields` qua Canvas/Form; nhãn i18n). Khối sửa trường ⇒ lát editor (flow-admin/Sonnet).
- [x] `docs/platform/modules.md` ghi phần mở khoá có giới hạn.

## Không làm / Chạm
Không route chat-web, không DLC, không đường batch CR-115 (chỉ thêm 1 dòng kiểu `SnapStage` ở `runs/launcher-prompt.ts`).
Không migration (giá trị lưu ở `process_outputs.fields` + `review_tasks.answer` sẵn có; audit `review`/`review_task` sẵn có).

## Test tối thiểu
- unit `apps/hub-api/src/modules/processes/domain/form/form.rules.test.ts` (giới hạn từng loại, trường lạ, def).
- int `tests/acceptance/cr118/form-node.int.test.ts` (ma trận người làm, 422, idempotent + audit, If đọc field, snapshot).

## Quyết định trong lúc làm
- Tập trường = hợp spec (§5: money) + brief (file_ref) ⇒ 8 loại; `file_ref` chỉ kiểm dạng uuid (quyền đọc tệp theo kênh đính kèm).
- Trường lạ bị BỎ (spec "strict, bỏ trường lạ"), không 422; checkbox lưu `"true"|"false"` (field output chỉ string|number|date).
- Đối tác (`userKind=external`) ở run `pack_key='contracts'` ⇒ 404 (câu 17); gói khác theo luật Group như cổng kiểm.
- Task form CHỈ quyết qua `/form`: `/decision` trên stage form ⇒ 409 TASK_KIND_MISMATCH (tránh Đạt không có giá trị).
- Idempotent: khoá run trước khi đọc trạng thái task; task đã đóng + `answer` = chuỗi canonical cùng giá trị ⇒ 200 thẻ task,
  không ghi lại; khác ⇒ 409 REVIEW_TASK_CLOSED. Audit chỉ ghi key (không giá trị).
- Ở `HUB_PROCESS_ROUTES=admin` route `/form` chịu `requireAdminRole` như `/decision`; người dùng nghiệp vụ đi qua kit flow
  (`cr118-flow-api` gọi `GateService.formSubmit`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Node form — người điền form ở một bước
Loại node `form` (họ work, produces = các trường form) chờ một thành viên Group của bước (luật như cổng kiểm) gửi giá trị
cho tập trường cố định (≤ 20; text, textarea, number, money, date, select, checkbox, file_ref; không HTML/biểu thức). Hub kiểm
theo form trong snapshot run, bỏ trường lạ, ghi field vào output stage và Đạt trong cùng transaction; If/bước sau đọc được.
- Kịch bản: khi giá trị vượt giới hạn/ sai loại/ thiếu bắt buộc thì từ chối theo key trường [test: apps/hub-api/src/modules/processes/domain/form/form.rules.test.ts » giới hạn từng loại]
- Kịch bản: khi người gửi ngoài Group, khác tenant hoặc là đối tác ở run gói contracts thì 404; thành viên Group thì 200 [test: tests/acceptance/cr118/form-node.int.test.ts » ma trận người làm: member ngoài Group / tenant khác / đối tác (run gói contracts) ⇒ 404; thành viên Group ⇒ 200]
- Kịch bản: khi giá trị sai thì 422 FORM_VALUES_INVALID và task vẫn mở [test: tests/acceptance/cr118/form-node.int.test.ts » giá trị sai ⇒ 422 FORM_VALUES_INVALID {paths}; task vẫn mở, output không đổi]
- Kịch bản: khi gửi hai lần cùng giá trị thì một kết quả, một audit; giá trị khác sau khi đóng thì 409 [test: tests/acceptance/cr118/form-node.int.test.ts » idempotent: gửi 2 lần cùng giá trị ⇒ 200 cả hai, một output, một audit; giá trị khác sau khi đóng ⇒ 409]
- Kịch bản: khi bước sau là If trên field form thì rẽ theo giá trị đã gửi [test: tests/acceptance/cr118/form-node.int.test.ts » If bước sau đọc field form: so_tien > 100 ⇒ nhảy bước 3 (bước 2 skipped), run done]
- Kịch bản: khi def đổi trường sau khi run bắt đầu thì run cũ vẫn kiểm theo snapshot [test: tests/acceptance/cr118/form-node.int.test.ts » snapshot: def sửa sau khi run bắt đầu (đổi trường) ⇒ run cũ vẫn kiểm theo form lúc bắt đầu]

## Việc còn lại
- Editor trường form ở admin-web (lát flow-admin/Sonnet) + renderer web (`platform/flow/form`, lát flow-web).
- Điều phối: gộp `FormField` với `FlowFormSchema` của cr118-flow-contract; kit flow gọi `GateService.formSubmit`.
- `test:frozen` + `dlc:check` chạy một lần cuối đợt (điều phối).
