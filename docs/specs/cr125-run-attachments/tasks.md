---
id: cr125-run-attachments
lát: cr125-run-attachments
cr: CR-125
làn: đầy đủ (quyền đọc tệp)
migration: 0130_process_run_files
phụ thuộc: cr125-form-step-card
---
## Plan (ngắn)
Tệp người điền (ô «Tệp đính kèm» của phiếu «Tạo yêu cầu», ô `file_ref` của bước form) thuộc NGƯỜI TẢI ⇒ người bước sau không mở được, và tệp phiếu không tới lượt con. Thêm bảng nối `hub.process_run_files (process_run_id, attachment_id)`; quyền đọc tệp = quyền xem lượt (`hub.process_run_viewer`), qua `GET /attachments/:id(/content)` có JWT sẵn có.

## Làm
- Migration 0130 `hub.process_run_files` (FK lượt `(id, tenant_id)` + tệp, CASCADE; RLS tenant; GRANT SELECT/INSERT). Sweeper «chưa gắn quá 24 h» bỏ qua tệp có liên kết.
- `attachments/run-links.ts`: `linkRunFiles` (chỉ tệp `upload` của CHÍNH người thao tác; id của người khác bị bỏ lặng lẽ), `inheritRunFiles` (lượt con kế thừa CHỈ tệp đã liên kết với cha), `readableRunFile` (nhánh đọc thêm: scope user hỏi definer `process_run_viewer`, rồi scope system đọc hàng tệp theo tenant). `AttachmentService.#readable`: chủ → tự sửa → liên kết lượt.
- Ghi: phiếu `processes/start` (cùng tx tạo lượt, qua `onCreated`), `writeFormOutput` (bước form), launcher Quy trình con (trong savepoint tạo lượt con, id tệp trong giá trị `input_map`).
- workspace-web: `FileName` thành liên kết tải (Bearer), lỗi không mở được ⇒ câu báo; trang yêu cầu liệt kê tên tệp (trước: «n tệp»).

## Không làm / Chạm
Không đổi contract, engine máy trạng thái, URL công khai. Không truy cập chéo công ty. `GET /attachments/:id` giữ nguyên chữ ký.

## Test tối thiểu
- unit: `run-links.rules.test.ts`, `start-files.rules.test.ts`, `form.rules.test.ts` (+fileRefIds), `workspace-web components/shared/attachments.test.ts` (fileIdsOf).
- int (evotest -Dirty xanh): `flow-form-step-card.int.test.ts` (+1: Kế toán/người tạo mở được, người ngoài cùng công ty 404, công ty khác 404, kéo tệp người khác ⇒ 0 liên kết), `subprocess.int.test.ts` (+1: tệp trong input_map ⇒ con kế thừa, tệp không truyền thì không), `attachments-review.int.test.ts` xanh (sweeper).

## Quyết định trong lúc làm
- Bảng nối thay vì thêm cột/đổi RLS `attachments` (RLS chủ-sở-hữu giữ nguyên; giống mẫu `autofix_results` PC-R14).
- Id tệp không thuộc người thao tác ⇒ bỏ lặng lẽ (không 422) để không đổi hành vi phiếu/form cũ và không lộ tồn tại.
- Con kế thừa chỉ tệp đã ở cha: không cần kiểm chủ sở hữu lần hai.
- `?tenant_id` của platform_admin KHÔNG áp cho nhánh này (không truy cập chéo công ty).
- Ô `file` của lượt con vẫn không nhận input (như cũ); chỉ liên kết tệp.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Tệp đính kèm của lượt mở được bởi người xem lượt
Tệp người điền ở phiếu «Tạo yêu cầu» hoặc bước form được liên kết vào lượt; mọi người xem được lượt (người tạo, người được giao, quản trị công ty) mở tệp qua `/attachments/:id/content`; người khác cùng công ty và công ty khác nhận 404. Lượt con nhận tệp được truyền qua `input_map`.
- Kịch bản: khi người bước form tải tệp và gửi thì người duyệt bước sau mở được tệp, người ngoài cùng công ty và công ty khác nhận 404 [test: apps/hub-api/src/modules/processes/triggers/flow-form-step-card.int.test.ts » tệp bước form]
- Kịch bản: khi lượt cha truyền tệp qua input_map thì lượt con kế thừa liên kết, tệp không truyền thì không [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » tệp truyền qua input_map]

### MODIFIED engine/flow-web.md
#### Yêu cầu: Tên tệp đã điền là liên kết mở tệp
Giá trị «Đã điền» của thẻ và trang yêu cầu hiện tên tệp dạng liên kết; không mở được (không có quyền / đã xoá) ⇒ câu báo lỗi.
- Kịch bản: khi trang yêu cầu có ô tệp "id1, id2" thì tách thành từng liên kết [test: apps/workspace-web/src/components/shared/attachments.test.ts » phiếu «Tạo yêu cầu»]

## Việc còn lại
- `packages/db` `migrate-hub.int.test.ts` + `hub-rls.int.test.ts` đỏ trên evotest (lỗi FK `feature_entitlements_tenant_id_tenants_id_fk` ở dữ liệu test, không liên quan 0130) — chạy thêm lúc chạy mốc; cần xác nhận đỏ có sẵn ở base (T2).
- Chưa có test int riêng cho đường «Tạo yêu cầu» (`processes/start` + `fileIds`); logic chỉ gọi cùng `linkRunFiles` đã test qua bước form/con.
- `workspace-web` typecheck có lỗi có sẵn `contracts-list/lib/date-filter.test.ts`.
