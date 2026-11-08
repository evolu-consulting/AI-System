---
id: cr125-form-step-card
lát: cr125-form-step-card
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-purchase-templates (gap «Việc còn lại» 1), cr125-manual-start-ui (đã vào gd0)
---
## Plan (ngắn)
Bước «Điền thông tin» (form/work) của lượt flow hiện trên thẻ HĐ Sổ Hợp Tác như một bước form thật: ô theo loại + ô tải tệp + «Gửi»; giá trị đã gửi chỉ đọc ở các bước sau. KHÔNG đường ghi mới: «Gửi» = `POST /review-tasks/:id/form` (`GateService.formSubmit`, kiểm theo snapshot run, ghi `process_outputs.fields` + đóng task + mở bước kế cùng tx).

## Làm
- Hub: `stepsView` (kit `PackStepView.form`) kèm trường của snapshot + giá trị đã gửi (`process_outputs.fields` của output hiện hành, chỉ khi task đã Đạt) · thẻ `CardStep.kind = "form"` + `form` + `values` · `flowViewOfCard` chiếu `kind: "form"` (+ nhóm làm) và task `kind: "form"` với MỘT hành động «Gửi» (không Duyệt/Trả lại/Từ chối) · contract `ApprovalCardStep.form/values`, `FlowStepView(form).values`.
- workspace-web: `FormStep` (platform/flow) dùng ô tệp `FileUploadField` (tải `POST /attachments`, giá trị = id tệp) + `FormValuesView` (chỉ đọc: tiền, ngày, ô tick, lựa chọn, tên tệp); nhãn bước «Đã điền»; thẻ HĐ không hiện Duyệt/Trả lại/Từ chối ở đầu trang khi bước mở là form; gửi xong tải lại thẻ + số «Chờ tôi duyệt».
- Hộp «Chờ tôi duyệt» (`/contracts/approvals`) vẫn là danh sách dẫn vào thẻ HĐ — form điền ngay trên thẻ (không thêm màn riêng).
- `tools/demo/purchase-templates.run.ts`: bước form chạy bằng UI (điền ô + tải tệp + «Gửi»), bỏ gửi bằng API.

## Không làm / Chạm
Không đụng engine (máy trạng thái run), DLC, migration. Không `slice:merge`. Ô «ghi chú kèm Gửi» KHÔNG làm: `FormSubmitRequest` chỉ có `values` (strict), thêm ghi chú = đổi contract + lịch sử task.

## Test tối thiểu
- unit hub: `approval-flow-view.form.test.ts` (3) · unit web: `engine-card.form.test.ts` (2), `flow-ui.test.tsx` (+2).
- int: `apps/hub-api/src/modules/processes/triggers/flow-form-step-card.int.test.ts` (3, evotest xanh): thẻ chiếu form + task chỉ cho nhóm làm; người ngoài nhóm 404, công ty khác 404; sai giá trị 422 `FORM_VALUES_INVALID`; đúng ⇒ output lưu đúng, bước Duyệt mở, thẻ người sau có giá trị; gửi lại cùng giá trị idempotent.
- e2e hành trình thật: `e2e/journey-approval/cr125-form-step-card.spec.ts` (việc `playwright.journey-fsc.config.ts`, evotest `-Dirty` xanh 72 s): Phần 1 «Mua hàng» (đúng các bước mẫu Thư viện) — nhân viên điền «Đề xuất» + tệp ⇒ Trưởng bộ phận duyệt ⇒ Mua hàng báo giá + tệp ⇒ … ⇒ «Tạo PO» + tệp ⇒ TBP duyệt PO ⇒ xong, tất cả bằng giao diện.

## Quyết định trong lúc làm
- Một component dùng lại: không dựng form thứ hai. `FormStep` (CR-118) đã có sẵn ở platform/flow nhưng thẻ HĐ chưa nhận `kind: "form"` từ Hub ⇒ chiếu `form` ở Hub là đủ để thẻ vẽ form. Ô tệp tách thành `components/shared/FileUploadField.tsx` + `attachments.ts` (tải/đọc tệp).
- **Đối chiếu với cr125-manual-start-ui (đã vào gd0)**: `features/requests/components/RequestField.tsx` (phiếu «Tạo yêu cầu») có `Files` + `uploadAttachment` riêng, trường theo mô hình phiếu (`longtext/people/department/attachments`) KHÁC mô hình trường của node form (`text/textarea/number/money/date/select/checkbox/file_ref`) ⇒ hai bộ ô chưa gộp. Việc gộp (không làm ở lát này): `RequestField.Files` và `requests/api.ts#uploadAttachment` đổi sang import `~/components/shared/FileUploadField` / `attachments`; ô `people`/`department` của phiếu chưa có ở node form (chưa có loại trường tương ứng trong `FORM_FIELD_TYPES`).
- Nhóm làm bước form chỉ có thể «Gửi» (không Từ chối) — luật engine: stage `form` chỉ quyết qua gửi form (409 `TASK_KIND_MISMATCH` nếu Duyệt/Từ chối).
- `workspace-web` cần proxy `/review-tasks` + `/attachments` (rsbuild + nginx) — đã có từ cr125-manual-start-ui; lát này dựa vào đó (rebase gd0).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### MODIFIED engine/flow-web.md
#### Yêu cầu: Thẻ hợp đồng vẽ bước «Điền thông tin» (form) với ô nhập, tệp đính kèm và «Gửi»
Bước form của lượt flow hiện trên thẻ HĐ như bước form thật: người thuộc nhóm làm thấy các ô theo loại (chữ, số, tiền, ngày, chọn, tick, tệp) và nút «Gửi» (không có Duyệt/Trả lại/Từ chối); «Gửi» ghi giá trị + tệp làm đầu ra của bước qua đường gửi form sẵn có và bước kế mở. Người ngoài nhóm không thấy ô nhập; bước đã gửi hiện giá trị chỉ đọc cho mọi người xem thẻ.
- Kịch bản: khi bước form mở thì thẻ chiếu bước `form` kèm trường + nhóm làm và task «Gửi» chỉ cho người của nhóm làm [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-view.form.test.ts » form đang mở, người xem thuộc nhóm làm ⇒ step form + task «Gửi» mang cả form (không Duyệt/Từ chối)]
- Kịch bản: khi bước form đã gửi thì giá trị hiện chỉ đọc ở bước đó và bước duyệt kế vẫn có Duyệt/Trả lại [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-view.form.test.ts » form đã gửi ⇒ giá trị chỉ đọc ở bước form]
- Kịch bản: khi bước mở là form thì đầu trang thẻ không có nút Duyệt/Trả lại/Từ chối [test: apps/workspace-web/src/features/contract-approval/lib/engine-card.form.test.ts » người làm (can_act) ⇒ không nút Duyệt/Trả lại/Từ chối ở đầu trang]
- Kịch bản: khi bước form đã xong thì thẻ hiện nhãn «Đã điền» và giá trị theo loại (tiền, ngày, ô tick, lựa chọn) [test: apps/workspace-web/src/platform/flow/ui/flow-ui.test.tsx » bước đã xong ⇒ nhãn «Đã điền» + giá trị theo loại (tiền, ngày, ô tick, lựa chọn), không form]
- Kịch bản: khi trường là tệp thì ô là ô chọn tệp (tải ngay), không phải ô chữ [test: apps/workspace-web/src/platform/flow/ui/flow-ui.test.tsx » trường file_ref khi điền ⇒ ô chọn tệp (data-testid flow-file-<khoá>), không ô chữ]

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Gửi form của bước chỉ do nhóm làm, lưu giá trị làm đầu ra, mở bước kế
Gửi form (`POST /review-tasks/:id/form`) từ thẻ HĐ: chỉ người thuộc nhóm làm của bước được gửi (người ngoài nhóm và người công ty khác nhận 404); giá trị sai theo snapshot run ⇒ 422 `FORM_VALUES_INVALID` và bước vẫn mở; đúng ⇒ giá trị lưu ở đầu ra của bước, bước kế mở, người xem sau thấy giá trị đã gửi trên thẻ; gửi lại cùng giá trị không lỗi.
- Kịch bản: khi người ngoài nhóm làm hoặc người công ty khác gửi form thì 404 và bước vẫn mở [test: apps/hub-api/src/modules/processes/triggers/flow-form-step-card.int.test.ts » quyền: người ngoài nhóm làm ⇒ 404]
- Kịch bản: khi giá trị đúng thì đầu ra lưu đúng, bước Duyệt mở và thẻ người sau có giá trị [test: apps/hub-api/src/modules/processes/triggers/flow-form-step-card.int.test.ts » giá trị sai ⇒ 422 FORM_VALUES_INVALID, bước vẫn mở]
- Kịch bản: khi Phần 1 «Mua hàng» chạy từ đầu tới PO thì mọi bước form điền được bằng giao diện kèm tệp [test: e2e/journey-approval/cr125-form-step-card.spec.ts » Phần 1 «Mua hàng»: mọi bước điền thông tin + đính kèm tệp làm trên giao diện, tới Kết thúc]

## Việc còn lại
1. **Người khác không mở được tệp đã đính kèm**: ô tệp tải qua `POST /attachments` (đường chat, tệp thuộc NGƯỜI TẢI) ⇒ người ở bước sau chỉ thấy «Tệp đính kèm» (không tên, không tải về) vì `GET /attachments/:id` theo người tải. Cần nơi lưu tệp dùng chung của HĐ/lượt chạy (FileBox của gói) + liên kết tải; đổi ở `FileUploadField`/`attachments.ts` là đủ phía web.
2. Gộp `RequestField.Files` + `requests/api.ts#uploadAttachment` về `components/shared/FileUploadField` + `attachments` (xem Quyết định).
3. Ghi chú kèm «Gửi» chưa làm (cần đổi `FormSubmitRequest`).
4. `FormStep` chưa có ô `people`/`department` (chỉ có trong phiếu «Tạo yêu cầu»).
