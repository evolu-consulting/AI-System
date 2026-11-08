---
id: cr125-contract-from-step
lát: cr125-contract-from-step
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-purchase-parent (Phần 2 chạy làm lượt con; cùng sửa purchase-templates)
---
## Plan (ngắn)
Lượt bắt đầu từ phiếu / chạy làm Quy trình con không có hợp đồng ⇒ bước Ký số của Phần 2 «Cần xử lý». Thêm node `contracts.create-from-step`
«Tạo hợp đồng từ hồ sơ»: sau bước Soạn thảo, tạo HĐ trong Sổ Hợp Tác từ tệp đã đính kèm, gắn vào lượt, trả `contract_id` cho Ký số.

## Làm
- `packages/contracts/src/modules/contracts/create-from-step/{config,node}.ts` + `node.test.ts`: khai báo node, cổng zod (file_id/title/counterparty/amount),
  luật thuần `planCreateFromStep`, mã lỗi. Đăng ký trong `contracts/module.ts` + `modules/index.ts`; `modules.rules.test.ts` cập nhật.
- Tool `contracts-create-from-step` (`adapters/create-from-step.tool.ts`), binding `nodes/create-from-step/binding.ts`, mount `create-from-step.mount.ts` (từ `intake.mount`).
- Đường ghi MỘT: `createUploadContract` thêm `prefill` (trường điền sẵn ⇒ `needs_review`, không lượt duyệt, không AI trích); `upload.mount.ts` tách
  `uploadContractFor` (route tải lên và tool dùng chung; tool tắt `contract.uploaded`).
- Gắn lượt ↔ HĐ: `PackRunsPort.recordOf/linkOnce` (`processes/runs/pack-run-record.ts`; chỉ gắn khi lượt chưa có bản ghi). Idempotent theo lượt.
- Đọc tệp bước trước: `attachments/attachment-bytes.ts` (đúng `tenant_id`), nối ở `app.ts` → `PacksMountDeps.attachmentBytes`.
- Ký số: `lockForSign(id, by, viaRun)` khoá khi `run_id is not null` HOẶC `viaRun`; tool esign-send bắt buộc có lượt và HĐ phải là bản ghi của lượt (`recordOfRun`), nếu không `ESIGN_CONTRACT_NOT_IN_RUN` (HĐ tải lên chưa gửi duyệt không ký được). Ký số nhận `contract_id` qua nguồn «từ bước» (field).
- Review Opus: tệp chỉ đọc được khi đã liên kết với lượt (`attachmentBytesOf(tenant, run, id)` join `hub.process_run_files`); `PackRunsPort.linkOnce` khoá hàng lượt FOR UPDATE quanh «đã gắn? → tạo → gắn» (hai lời gọi đồng thời ⇒ một HĐ; lỗi ⇒ rollback, lượt không bị gắn).
- Seed Phần 2 (`purchase-templates.data.ts`): chèn bước sau «Soạn thảo» (form thêm «Giá trị hợp đồng»; tệp + nhà cung cấp bắt buộc), đánh số lại, `ky-so`
  đọc `contract_id` từ bước mới, đầu vào `contract_id` không bắt buộc.
- i18n vi/en + `attention.ts`: `CONTRACT_STEP_FILE_MISSING` («Chưa có file hợp đồng ở bước Soạn thảo»; cũng cho `MISSING_ARG:file_id`), `_UPLOAD`, `_STORAGE_OFF`, `_NO_RUN`.

## Không làm / Chạm
Không migration, không UI mới. Chạm: use case tải lên (thêm `prefill`), `esign.repo.lockForSign`.

## Test tối thiểu
- unit: `create-from-step/node.test.ts` (ánh xạ args), `modules.rules.test.ts`.
- int evotest -Dirty: `create-from-step.int.test.ts` (form-file → HĐ ở công ty của lượt → Ký số selfsign tạo phong bì; công ty khác không thấy; không tệp ⇒ mã lỗi; thử lại không tạo đôi) + `seed-cr125-config.int.test.ts` + `packs.module-registry.int.test.ts`: 11 pass; sau review: `create-from-step.int.test.ts` 5 pass (đồng thời, tệp chưa liên kết, esign từ chối HĐ không thuộc lượt, `attachmentBytesOf`) + esign-node/tool-auto-args/module-registry xanh.

## Quyết định trong lúc làm
- Giá trị form gồm cả `gia_tri_hop_dong`; mọi ô nguồn là bắt buộc vì engine không gọi tool khi một nguồn vắng (`MISSING_ARG`).
- Tool không `side_effect` (bản ghi nội bộ, chưa gửi ra ngoài) ⇒ không đòi bước duyệt ngay trước; chống tạo đôi bằng `recordOf`.
- Sửa dữ liệu seed thẳng ở `purchase-templates.data.ts` (bản xuất UI); cần ghi lại vào `tools/demo/purchase-*` nếu xuất lại từ giao diện.

## Việc còn lại
- Int chưa chạy tới «đã ký xong» (mới tới phong bì selfsign tạo ra); chưa có int đầy đủ qua engine (form thật → run → tool qua `packRuns`), `attachmentBytesOf` chưa có int riêng.
- Gộp với `cr125-purchase-parent`: cả hai sửa Phần 2 / `purchase-templates` (mergeParallel đánh số lại bước SAU khi có bước mới; kiểm lại `back_to_steps`).
- `core.subprocess` làm hỏng `nodes.rules.test.ts` (có sẵn, không do lát này).
- e2e chưa chạy (theo luật).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Node «Tạo hợp đồng từ hồ sơ»
Sau bước Soạn thảo (có tệp), node tạo một hợp đồng trong Sổ Hợp Tác của công ty của lượt từ tệp đó (tên, đối tác, giá trị lấy từ ô của bước), gắn lượt với hợp đồng và trả mã hợp đồng cho bước Ký số. Không có tệp thì báo «Chưa có file hợp đồng ở bước Soạn thảo» và không tạo gì; chạy lại cùng lượt không tạo hợp đồng thứ hai.
- Kịch bản: khi tệp của bước Soạn thảo có và công ty của lượt đúng thì hợp đồng được tạo ở công ty đó (chờ xác nhận, có tệp), lượt gắn hợp đồng và Ký số gửi ký đúng hợp đồng ấy [test: apps/hub-api/src/modules/packs/create-from-step.int.test.ts » tệp bước Soạn thảo → HĐ của công ty lượt, lượt gắn HĐ → Ký số (selfsign) ký đúng HĐ đó]
- Kịch bản: khi không có tệp hoặc tệp thuộc công ty khác thì lỗi CONTRACT_STEP_FILE_MISSING và không tạo hợp đồng [test: apps/hub-api/src/modules/packs/create-from-step.int.test.ts » không có tệp / tệp chưa liên kết với lượt / công ty khác ⇒ CONTRACT_STEP_FILE_MISSING, không tạo gì]
- Kịch bản: khi hai lời gọi cùng lượt chạy đồng thời thì chỉ tạo một hợp đồng [test: apps/hub-api/src/modules/packs/create-from-step.int.test.ts » hai lời gọi đồng thời cùng lượt ⇒ MỘT hợp đồng]
- Kịch bản: khi hợp đồng không phải bản ghi của lượt (vd tải lên chưa gửi duyệt) thì bước Ký số từ chối, không khoá, không tạo phong bì [test: apps/hub-api/src/modules/packs/create-from-step.int.test.ts » Ký số từ chối HĐ không phải bản ghi của lượt (không bỏ qua duyệt): HĐ tải lên chưa gửi duyệt không bị khoá/ký]
- Kịch bản: khi ánh xạ ô bước thành tên, đối tác, giá trị thì chuẩn hoá và mặc định tên khi trống [test: packages/contracts/src/modules/contracts/create-from-step/node.test.ts » planCreateFromStep · ánh xạ input_map]
