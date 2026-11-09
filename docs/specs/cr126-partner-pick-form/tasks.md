---
id: cr126-partner-pick-form
lát: cr126-partner-pick-form
cr: CR-126
làn: nhanh
migration: không
phụ thuộc: cr126-partner-pick-engine (kiểu `flow/form-prefill.ts`; node + nhóm phụ trách + payload prefill)
---
## Plan (ngắn)
Bước người «Chọn đối tác & người nhận» của node «Gửi đối tác xác nhận» dùng MỘT FormStep chung: đối tác + email điền sẵn từ hợp đồng, sửa được, rồi «Gửi».
Phần chung (contract form + renderer + ô chọn nhóm của editor + e2e); engine/payload là lát cr126-partner-pick-engine.

## Làm
- `hub-admin/process-form.ts`: trường `default` (chuỗi), `format: "email"` (ô chữ), `options_from: "company_partners"` (ô chọn; `options` được trống, trần 200 thay vì 30 chỉ cho `options_from`). Form cũ giữ nguyên.
- `flow/form.ts`: `flowFormValuesSchema` hiểu `options_from` (chuỗi khác rỗng, máy chủ kiểm đối tác) và email sai dạng. `flow/view.ts`: `FlowTask.prefill` (tuỳ chọn, kiểu `FormPrefill` của engine).
- `workspace-web/platform/flow`: `initialDraft` (prefill > default), `selectOptions`, `filterOptions`, mã lỗi `email`; `FormSearchSelect` (ô tìm + danh sách "tên · MST"); `FormStep` dùng chung cho «Việc của tôi», trang yêu cầu, thẻ HĐ.
- `hub-api/.../approval-flow-view.rules.ts`: `prefillOf` kiểm schema rồi chuyển `prefill` từ form/task của stage sang `FlowTask` (sai dạng thì bỏ).
- `modules/types.ts`: widget `group`; admin-web `fields.ts` map `group` → ô chọn nhóm của panel chung (cùng `department`). Nhãn «Nhóm phụ trách gửi đối tác» lấy từ `.describe()` ở decl node (lát engine).
- i18n `contracts.flowPanel.form.{search,choose,noMatch,error.email}` vi/en.
- e2e: `_partner-pick.ts` + sửa `cr124-q6-partner-journey`, `cr125-ux-s7-partner-enable` (node có `assignee_group`, bước chọn ở «Việc của tôi», email chọn → hộp thư đi). VIẾT, chưa chạy.

## Không làm / Chạm
Không sửa engine/assignment của hub-api, tool partner-send, `ContractApprovalSchema` (engine thêm `prefill` vào form của card step nếu đi đường thẻ HĐ).

## Test tối thiểu
Unit: `process-form-prefill.test.ts`, `form-prefill.test.ts`, `approval-flow-view.prefill.test.ts`, `fields.group.test.ts`.

## Quyết định trong lúc làm
- Email là ô `text` + `format: "email"` (không thêm loại trường mới ⇒ không đụng các switch theo loại).
- Danh sách chọn do máy chủ cấp nằm ở `FlowTask.prefill.field_options`, không nhét vào `options` của form (form là bản chụp trong snapshot, danh sách đối tác đổi theo công ty).
- Ô tìm + `<select>` gốc (truy cập được, e2e `selectOption`), không dựng combobox riêng.
- Thư tới email đã chọn kiểm ở `hub.partner_mailbox.to_email` (stack e2e không có SMTP).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Bước form hiển thị và gửi qua đường review-tasks sẵn có (nguồn: cr118-flow-web)
Người có task đang mở ở bước `form` thấy form theo định nghĩa trong snapshot (≤ 20 trường; nhãn/gợi ý là text thuần) và gửi bằng
`POST /review-tasks/:id/form`. Trường có thể có giá trị điền sẵn (`default` của form, hoặc giá trị máy chủ tính trong `prefill` của task — thắng `default`);
ô chữ `format: email` nhập email và báo "Nhập dạng ten@congty.vn" khi sai; ô chọn có `options_from: company_partners` hiện danh sách do máy chủ cấp
("tên · MST", tới 200 mục) kèm ô tìm không phân biệt hoa thường và dấu. Form cũ không có các khoá này vẫn chạy như trước. Một FormStep dùng chung cho thẻ HĐ,
trang yêu cầu và «Việc của tôi».
- Kịch bản: khi form có giá trị máy chủ điền sẵn thì nháp lấy giá trị đó, không có thì lấy `default` hoặc để trống [test: apps/workspace-web/src/platform/flow/lib/form-prefill.test.ts » giá trị máy chủ tính thắng default của trường, không prefill thì dùng default hoặc trống]
- Kịch bản: khi gõ vào ô tìm đối tác thì lọc theo tên hoặc MST, giữ mục đang chọn [test: apps/workspace-web/src/platform/flow/lib/form-prefill.test.ts » lọc theo tên hoặc MST, không phân biệt dấu hoa thường, giữ mục đang chọn]
- Kịch bản: khi email sai dạng thì lỗi nằm đúng ô email và sửa lại thì gửi được [test: apps/workspace-web/src/platform/flow/lib/form-prefill.test.ts » email sai dạng thì mã email nằm trên đúng trường, sửa lại thì gửi được]
- Kịch bản: khi form cũ không có `default`/`options_from` thì vẫn hợp lệ [test: packages/contracts/src/hub-admin/process-form-prefill.test.ts » form cũ (không default/options_from) vẫn hợp lệ]
- Kịch bản: khi danh sách gõ tay vượt 30 thì bị từ chối, danh sách `options_from` được tới 200 [test: packages/contracts/src/hub-admin/process-form-prefill.test.ts » trần 30 lựa chọn giữ nguyên cho danh sách gõ tay, nâng lên 200 chỉ cho options_from]
- Kịch bản: khi task form có `prefill` đúng dạng thì chuyển vào FlowTask, sai dạng thì bỏ [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-view.prefill.test.ts » vắng / sai dạng ⇒ undefined (không ném)]
- Kịch bản: khi gửi hợp đồng cho đối tác thì người của nhóm phụ trách chọn đối tác + email ở «Việc của tôi» rồi thư đi đúng email đã chọn [test: thủ công — e2e hành trình chạy một lần sau khi gộp engine (cr124-q6-partner-journey, cr125-ux-s7-partner-enable)]

### MODIFIED engine/flow-web.md
#### Yêu cầu: Panel chung của node chọn nhóm phụ trách bằng ô chọn nhóm có sẵn
Cổng cấu hình có widget `group` (vd «Nhóm phụ trách gửi đối tác») hiện CÙNG ô chọn nhóm với widget `department`; không có ô riêng thứ hai.
- Kịch bản: khi cổng khai widget `group` thì panel chung dựng ô chọn nhóm với nhãn từ mô tả [test: apps/admin-web/src/features/processes/modules/generic/fields.group.test.ts » assignee_group ⇒ ô chọn nhóm (kind department), nhãn từ describe, không bắt buộc]

## Việc còn lại
- Chạy e2e q6 + s7 sau khi gộp cả hai lát; chỉnh khoá ô (`PICK` trong `_partner-pick.ts`), giá trị `assignee_group` (id nhóm) và nơi ghi email nếu engine khác giả định.
- Engine: `.describe("Nhóm phụ trách gửi đối tác")` + `widgets: { assignee_group: "group" }` ở decl node; thêm `prefill` vào `form` của card step (`ContractApprovalSchema`) nếu thẻ HĐ đi đường card; trùng tên `FORM_OPTIONS_SOURCES` (form-prefill) với `FORM_OPTIONS_FROM` (process-form) — nên một nguồn.
- `FormValues` (xem lại giá trị đã gửi) hiện mã đối tác thô cho ô `options_from`; cần nhãn nếu muốn đẹp.
