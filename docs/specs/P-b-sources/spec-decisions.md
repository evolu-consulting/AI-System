# P-b-sources · Quyết định lúc làm + Tranh chấp test

Tách khỏi `spec.md` §9 để spec gọn dưới trần 25KB (log này tăng dần mỗi lát BUILD). Quyết định Gate + bảng chốt C1–C23 vẫn ở `spec.md` §9 (canonical).

## Quyết định trong lúc làm (agent tự quyết theo Luật 2 — một dòng/quyết định)
- **S4/#134** · `mapTeamError`→`sources.rules.ts` (tối thiểu); `closeMemberRun` msg/hint từ `runErrorText`; `not_configured`⇒decision `agent_failed`, `hub.runs` giữ `NOT_CONFIGURED`; `runMember` try/catch+`!direct`⇒`not_configured`; `drive` catch `failStuckRun`⇒`toDecision` (TM-11).
- **S4/#133** · `persistState` advance ghim `current_output_id=outputId` (gốc: trước dùng `hasOutput` stage kế ⇒ O0 không ghim ⇒ `priorFiles` rỗng); nháp `persistDraft` thành `hub.attachments` thật; guard `runScopedFileIds`@`priorFiles` (PB-R18).
- **S1 · VALIDATION_ERROR=400** · giữ map 400 của `common.ts` (spec/C11/C12 ghi 422); `vcode` test nhận cả 400/422 ⇒ xanh. docs-architect sửa tham chiếu spec khi đóng mốc (QC bàn giao #2).
- **S1 · last_pin** · DDL §5 không có cột ⇒ thêm `hub.sources.last_pin jsonb` + `last_pin_at` (QC #6); route `/sources-resolved` ghi pin đầy đủ, đọc strip theo quyền (C1).
- **S1 · seam check** · `createApp` nhận `sourceCheckTimeoutMs` qua `AppDeps` (test truyền cả cfg lẫn deps; dùng deps). Mặc định 60000.
- **S1 · chờ check đồng bộ** · `CheckWaiters` in-memory theo `job_id` (không Redis); route `/internal/jobs/:id/sources-resolved` đánh thức; timeout⇒422 SOURCE_UNRESOLVABLE (C13/K-04).
- **S1 · hub.jobs job source.resolve** · 0021 bỏ NOT NULL `run_id/step_id/conversation_id/provider_key`, nới `jobs_agent_ck` (agent_id null cho source.resolve) vì job check không gắn run/agent/provider. Giữ dữ liệu cũ (chỉ bỏ ràng buộc).
- **S1 · jobs_type_ck** · 0021 DROP `jobs_type_check`(0002)+`jobs_type_ck` rồi ADD `jobs_type_ck` gồm cả 4 type (D-08 đòi tên `jobs_type_ck`).
- **S1 · library byte serving (resolve)** · S1 chưa phục vụ byte library cho job `source.resolve`; `/internal/jobs/:id/attachments/:id` chỉ nhường cho job `agent.cli` đang chạy (H2c), còn lại 401 (ID-07/PB-R18). Phục vụ byte library = S2/C15.
- **S1 · mount order** · `mountSources` gọi trong `mountProtected` TRƯỚC `processHooks` để `/process-runs/sources` không bị `/process-runs/:id` nuốt; route guard attachments đăng ký trước mount H2c ⇒ `next()` fall-through (xác minh H2c internal-download 10/10 xanh).
- **S1 · process_defs sources/inputs CHECK** · dùng `jsonb_typeof(CASE string THEN decode ELSE col END)='array'` (không `='array'` trực tiếp) vì D-07 ghi qua `$1::jsonb`+`JSON.stringify` ⇒ jsonb-STRING; app (drizzle) ghi mảng thật vẫn hợp lệ.
- **S1 · library-documents (C3)** · route `GET /admin/sources/library-documents` HOÃN (frontend P-b1, không có ca pfs1); thêm ở lát kế.

## Tranh chấp test
- **C-17 (`sources-crud.int`)** · `resetPfs1` (`_local.ts`, khoá) chỉ `delete process_defs where key like 'pbx-%'`, nhưng C-16 tạo def key **`p-src`** và không dọn ⇒ C-17 `POST /process-defs p-src` gặp def cũ ⇒ 409 PROCESS_KEY_TAKEN (test đòi 201). C-17 **XANH khi chạy cô lập** (`-t "used_by = "`) ⇒ backend đúng; lỗi do khoá dọn thiếu `p-src`. KHÔNG sửa test. Đề xuất qc: `delete ... where key like 'pbx-%' or key in ('p-src','p-auto')` hoặc C-16/C-17 dùng key `pbx-*`.
- **C-17 · ĐÃ XỬ (qc)** · kết luận: test (helper) sai, code đúng. `resetPfs1` nay dọn `key like 'pbx-%' or key = 'p-src'`; kỳ vọng C-17 (201 + used_by) không đổi. pfs1 85/85 xanh, rules 25/25; lock cập nhật.

## Quyết định trong lúc làm — frontend admin (FS-1…FS-5)
- **FS · validate không dùng zod** · `lib/schemas.ts` là hàm thuần `validateSourceForm` + resolver RHF tự viết (luật phụ thuộc `kind` + vai; câu lỗi là key i18n); hằng số lấy từ contract (`SOURCE_KEY_RE`…).
- **FS · platform_admin luôn kèm `tenant_id`** · server `readTenant/writeTenant` đòi `tenant_id` cho platform (vắng ⇒ 404/422) ⇒ trang yêu cầu chọn công ty (`?tenant=`) trước khi gọi API; "Thêm nguồn" khoá tới lúc chọn; drawer `new` của platform hiện `combobox "Công ty"` cho MỌI loại (plan chỉ nêu local_path), mặc định = công ty đang xem.
- **FS · ô tìm `q` lọc phía client** · `SourceListQuerySchema` không có `q` ⇒ lọc theo ký hiệu trên các trang đã tải (trang 100 dòng) + "Tải thêm".
- **FS · nhãn i18n** · khoá lồng nên đổi `field.key.hint`→`field.keyHint`, `field.document.version`→`field.documentVersion`; thêm `needTenant`, `field.document{Placeholder,Search,Empty,Error}`, `field.tenantPlaceholder`, `field.descCount`, `apiError.{TIMEOUT,GENERIC,SOURCE_IN_USE}`, `usedBy.none`/`count_one|other`, `delete.ref`. `inputs` giữ `field.sourcePlaceholder`/`branchPlaceholder`, `ask.chipTitle`; phần `run.reason.*` thuộc FS-10.
- **FS · `ensureProcessLocale` nạp thêm `sources`** (admin: common+admin+sources); `inputs` chỉ chat-web nạp (loadProcessLocale mặc định tất cả phần).
- **FS · menu dòng local_path của tenant_admin chỉ có `Xem`** (E-PB3); câu `row.checkForbidden` hiện trong drawer Xem thay cho tooltip. Drawer `Xem` không nhận prop đường dẫn nào.
- **FS · menu "Kiểm tra kết nối" mở drawer `edit` và tự chạy kiểm tra** (nút trong drawer vẫn có); kết quả `status`/`alert` hiện trong drawer.
- **FS · cảnh báo "chỉ kho công khai" dùng `role="note"`** (không phải `alert`) để `getByRole("alert")` của e2e chỉ khớp cảnh báo local_path / lỗi.
- **FS · link xoá-bị-chặn trỏ `/processes`** · `SourceInUseRef` chỉ có `process_key`, còn route sửa dùng id ⇒ không tạo được `/processes/<id>`; hiển thị `{process_key} · giai đoạn {stage_key}` là link về danh sách quy trình.
- **FS · xoá nguồn có `used_by`** · lấy bản mới (`GET :key`) rồi `DELETE` để Hub trả `details.refs` (plan chỉ có `used_by` = process_key, thiếu stage).
- **FS · ConflictDialog** · thêm `ConflictEntity "source"` + `conflict.entity.source`; Hub `VERSION_CONFLICT` của nguồn chưa kèm `details.current` ⇒ FE tự `GET` bản mới để dựng hộp xung đột (đề xuất backend-lead bổ sung `details`).
- **FS · `TenantPicker` thêm prop `label`/`allLabel`** (additive) để nhãn `combobox "Công ty"` và mục "Chọn công ty".
- **FS · TODO library-documents** · `useLibraryDocs` gọi `GET /admin/sources/library-documents` theo contract; route backend HOÃN (S3) ⇒ picker hiện câu lỗi `documentError` tới lúc đó.
