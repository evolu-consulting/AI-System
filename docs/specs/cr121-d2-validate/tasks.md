---
id: cr121-d2-validate
lát: cr121-d2-validate
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-d0, cr121-d1
---
## Plan (ngắn)
Spec `docs/specs/cr121-d/spec.md` R5 / D-2: kiểm khi xuất bản và khi gán ⇒ 422 kèm {bước, trường, câu sửa vi/en}; API xem trước nhận đủ 4 dữ kiện.

## Làm
- `approval-flow-stages.rules.ts`: `validateApprovalBody` (loại bước ngoài danh mục, điều kiện dùng trường/toán tử/giá trị ngoài `APPROVAL_SLOT_FIELDS`, lồng quá một cấp) + `conditionDepartmentKeys` + `previewPath` trả `state: run|skip|no_data` (dùng `condHasData`).
- `approval.mount.ts`: `validate` = `validateApprovalBody`; `groupKeys` gồm mã phòng trong điều kiện (cùng MỘT câu SQL `firstMiss` ⇒ kiểm tenant khi gán không thêm truy vấn theo bước); `preview` nhận 4 dữ kiện.
- `slot.ports.ts`: `SlotPreviewInput`/`SlotPreviewStep` (chỉ phần preview).
- `library-publish.messages.ts` (mới): câu tiếng Việt/Anh nói cách sửa; `library.service.ts` `#b2` trả `details.issues[]` = `{path, rule, step, field, message, message_en}` cho `PROCESS_PUBLISH_INVALID` và `SLOT_GROUPS_MISSING` (thêm `issues`, giữ `keys`).
- `preview.routes.ts`: `contract_type|value|creator_departments|new_partner` đều tuỳ chọn; trả thêm `state`.
- `library-publish.rules.ts`: `whenSatisfiable` bỏ qua điều kiện phòng ban/đối tác mới (luôn có thể đúng).

## Không làm / Chạm
Không sửa admin-web, `packages/contracts/src/hub-admin/process-library.ts` (D-3), `library-draft.ts` (422 khi lưu nháp vẫn mã thô).

## Test tối thiểu
- unit: `library-publish.messages.test.ts`, `approval-flow-validate.rules.test.ts`.
- int: `library-validate.int.test.ts` (xuất bản 422, gán 422), `library-preview.int.test.ts` (no_data).

## Quyết định trong lúc làm
- Câu lỗi nằm trong code (vi+en cùng cặp) để không đụng `packages/i18n/.../process/admin.*.json` của D-3.
- Perf: kiểm hợp lệ thuần + đúng một câu SQL (`firstMiss`) cho mọi mã phòng/người dùng của mọi tenant bị ảnh hưởng.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Kiểm hợp lệ khi xuất bản và gán nói rõ cách sửa
Xuất bản/gán quy trình thư viện trả 422 kèm danh sách lỗi `{bước, trường, câu tiếng Việt/Anh}`: loại bước app không hỗ trợ, điều kiện dùng trường chưa khai báo, quá 20 bước, ký số không ở cuối, bước duyệt thiếu phòng ban, mã phòng ban (kể cả trong điều kiện) không có ở công ty được gán.
- Kịch bản: khi xuất bản quy trình có điều kiện dùng trường không khai báo thì 422 `PROCESS_PUBLISH_INVALID` kèm bước và câu sửa tiếng Việt [test: apps/hub-api/src/modules/processes/library/library-validate.int.test.ts » xuất bản: điều kiện dùng trường chưa khai báo ⇒ 422 kèm bước + câu sửa tiếng Việt]
- Kịch bản: khi gán cho công ty thiếu mã phòng ban dùng trong điều kiện thì 422 `SLOT_GROUPS_MISSING` kèm câu "Bước N: phòng ban '…' không có ở công ty …" [test: apps/hub-api/src/modules/processes/library/library-validate.int.test.ts » gán: mã phòng ban trong điều kiện không có ở công ty ⇒ 422 nói bước + công ty + cách sửa]
- Kịch bản: khi lỗi có mã luật thì câu sửa tiếng Việt/Anh đúng bước, đúng trường [test: apps/hub-api/src/modules/processes/library/library-publish.messages.test.ts » explainIssue]

#### Yêu cầu: Xem trước đường đi theo dữ kiện mẫu
Xem trước nhận loại HĐ, giá trị, phòng ban người gửi duyệt, đối tác mới; bước có điều kiện thiếu dữ kiện ghi `no_data` ("chưa có dữ liệu", vẫn chạy).
- Kịch bản: khi xem trước không có dữ kiện thì bước có điều kiện trả `no_data`; có dữ kiện thì `run`/`skip` [test: apps/hub-api/src/modules/processes/library/library-preview.int.test.ts » xem trước theo phòng ban/đối tác mới, thiếu dữ liệu ⇒ no_data]
- Kịch bản: khi thiếu phòng ban người gửi thì bước điều kiện phòng ban là `no_data` [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-validate.rules.test.ts » previewPath · chưa có dữ liệu]

## Việc còn lại
- D-3: editor hiển thị `details.issues[].message` theo ngôn ngữ; lưu nháp (`SLOT_BODY_INVALID`) chưa dùng câu sửa.
