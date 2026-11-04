---
id: cr118-flow-admin
lát: cr118-flow-admin
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: cr118-flow-contract, cr118-form-node (đã gộp vào platform/gd0)
---
## Plan (ngắn)
(1) MỘT schema trường form: `hub-admin/process-form.ts` (`FormFieldSchema`/`FormFieldsSchema`) là nguồn; `flow/form.ts` chỉ
đặt tên miền flow (`FlowFormFieldSchema = FormFieldSchema`, `FlowFormSchema = {fields: FormFieldsSchema}`) + dựng validator giá trị
từ snapshot. (2) admin-web: editor trường cho bước `form` ở `StageForm` (dùng chung Canvas + Danh sách): thêm/xoá/đổi chỗ, loại
(8), nhãn, mã tự sinh từ nhãn, gợi ý, bắt buộc, giới hạn theo loại, lựa chọn của select; mọi thay đổi đi qua `formPatch` nên
`output.fields` luôn khớp (Hub: lệch ⇒ FORM_INVALID); `normalizeForm` ép lại khi gửi/validate. (3) Ô chọn khe trên thẻ app công ty
(cr118-app-config) giữ nguyên — không đụng `features/apps`.

## Làm
- [x] Contract: `field-key.ts` (FIELD_KEY_RE dùng chung, tránh import vòng), `FormHelpSchema`, `FormFieldsSchema` (luật chéo khoá trùng /
  min > max / option trùng), `flow/form.ts` dùng lại; validator giá trị: money + file_ref (uuid đơn) + checkbox bắt buộc = true như Hub.
- [x] admin-web: `lib/form-fields.ts` (draft ↔ contract, validate tiếng Việt, normalize), `StageFormFields.tsx` + `FormFieldRow.tsx`,
  registry `form`, `StageGate` (bước form chỉ "Duyệt bởi Group", không Hành động thật), ẩn ngân sách/nguồn/tự sửa/người trả lời như `set`.
- [x] i18n vi + en `process.admin.editor.stage.form.*`; luật Hub `FORM_INVALID` có câu riêng.

## Không làm / Chạm
Không `DlcStageForm`/`SlotStageForm` (DLC của Rowan), không `features/apps`, không Hub (engine đóng băng), không migration.

## Test tối thiểu
- unit `packages/contracts/src/flow/flow.test.ts` (một schema, 8 loại, money/file_ref) + `apps/admin-web/src/features/processes/lib/form-fields.test.ts`
  (vòng def→draft→input, output.fields đồng bộ, normalize, câu lỗi).
- e2e `e2e/fnr-showcase/form-editor.fnr.ts` (tạo bước form ở Canvas → Lưu → Bật; sửa trường ở Danh sách).

## Quyết định trong lúc làm
- Nguồn duy nhất = schema của Hub (engine đã kiểm theo nó). Các thuộc tính chỉ có ở FlowFormField cũ mà Hub KHÔNG kiểm thì bỏ để
  không hứa suông: date min/max, select `multiple`, file_ref `max_files`/`accept`. Giữ `help` (thêm vào schema chung). Flow-web phải
  dùng `string` (uuid) cho file_ref và `string` cho select — không còn mảng.
- Mã khoá trường của flow siết từ 40 → 32 ký tự (khớp Hub `FIELD_KEY_RE`).
- Lỗi form tính live (như lỗi tool/rẽ nhánh), không đợi Lưu.
- Draft giữ chuỗi nhập tay (`FormFieldDraft`), chuyển sang `FormField` khi gửi; giá trị hỏng đã bị chặn bởi validate trước đó.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Một định nghĩa trường form cho Hub, flow và editor
Trường của node `form` có MỘT định nghĩa (8 loại: text, textarea, number, money, date, select, checkbox, file_ref; ≤ 20 trường;
nhãn/gợi ý văn bản thuần). Def của quy trình (executor `form`) và form trong view flow dùng đúng schema này; validator giá trị dựng
từ form của snapshot giống luật Hub (money nguyên ≥ 0, file_ref là uuid, checkbox bắt buộc phải đánh dấu).
- Kịch bản: khi hai nơi dùng cùng danh sách trường thì cùng chấp nhận/từ chối, kể cả khoá trùng và nhỏ nhất > lớn nhất [test: packages/contracts/src/flow/flow.test.ts » MỘT schema trường: flow dùng đúng FormFieldSchema của hub-admin (8 loại, money + file_ref)]
- Kịch bản: khi kiểm giá trị theo form snapshot thì money sai/uuid sai/trường lạ bị từ chối [test: packages/contracts/src/flow/flow.test.ts » validator từ form snapshot: strict, giới hạn, bắt buộc]

#### Yêu cầu: Editor trường của bước form và đồng bộ kết quả
Editor quy trình (Canvas và Danh sách) cho thêm/xoá/đổi chỗ trường, chọn loại, nhãn, mã, gợi ý, bắt buộc, giới hạn và lựa chọn của
select. `output.fields` của bước luôn được dựng lại từ trường form (key + kiểu) nên bước "Nếu"/bước sau đọc được và Hub không từ chối
FORM_INVALID. Bước form luôn chờ người điền (Duyệt bởi Group), không Hành động thật. Lỗi nhập hiện ngay bằng tiếng Việt.
- Kịch bản: khi thêm/xoá/đổi loại/đổi chỗ trường thì output.fields khớp trường form [test: apps/admin-web/src/features/processes/lib/form-fields.test.ts » output.fields khớp trường form (key + kiểu) sau khi thêm / xoá / đổi loại / đổi chỗ]
- Kịch bản: khi nạp def có đủ 8 loại rồi gửi lại thì không mất gì [test: apps/admin-web/src/features/processes/lib/form-fields.test.ts » 8 loại trường đi vòng def → draft → input không mất gì]
- Kịch bản: khi nhãn/mã/giới hạn/lựa chọn sai thì có câu lỗi tiếng Việt theo ô [test: apps/admin-web/src/features/processes/lib/form-fields.test.ts » giới hạn: độ dài, số, tiền, min > max]
- Kịch bản: khi tạo bước form ở Canvas rồi Lưu và Bật thì Hub lưu trường và output.fields khớp, tải lại còn [test: e2e/fnr-showcase/form-editor.fnr.ts » Canvas: thêm bước form + trường ⇒ Lưu 200 ⇒ Bật ⇒ tải lại còn, output.fields khớp trường]
- Kịch bản: khi sửa trường ở view Danh sách thì Lưu 200 và output.fields đồng bộ [test: e2e/fnr-showcase/form-editor.fnr.ts » Danh sách: sửa trường của bước form có sẵn ⇒ output.fields đồng bộ ⇒ Lưu 200]

## Việc còn lại
- e2e `form-editor.fnr.ts` chạy trên evotest một lần (job admin, -Filter) — xem báo cáo.
- flow-web (renderer form) phải theo schema chung: file_ref/select là chuỗi, không `multiple`/`max_files`/`accept`.
