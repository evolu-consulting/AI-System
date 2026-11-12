---
id: cr133-attach
lát: cr133-attach
cr: CR-133
làn: nhanh
migration: 0106_cr133_contract_files (migrations-pack-contracts, journal idx 102, when 1807000216000)
phụ thuộc:
---
## Plan (ngắn)
Khối «Tài liệu kèm» trên chi tiết HĐ: MỘT chỗ cho mọi tệp của HĐ ngoài file chính. Nhóm 1 = tệp gắn thẳng vào HĐ (thêm/gỡ/xem-tải, bảng mới
`contracts.contract_files`); nhóm 2 = tệp kèm các bước duyệt của HĐ (hub `process_run_files`, chỉ đọc). File chính + luật PDF khi bật ký số giữ nguyên.
- API (pack contracts): `GET /contracts/:id/files` · `POST /contracts/:id/files` (multipart) · `DELETE /contracts/:id/files/:fileId` · `GET /contracts/:id/files/:fileId/link`.
- Nhóm 2 qua `attachments/public.ts` → `recordRunFiles` (2 câu SQL cố định: liên kết ⋈ lượt đã qua `process_run_viewer`, rồi tên tệp theo mảng id).
- Web: `features/contract-files/` + một dòng trong `ContractBody.tsx` (sau `VersionsPanels`). i18n `contracts.cfiles.*` (vi/en, trong `docframe.*.json`).

## Làm
migration 0106 · domain/application/adapters/mount của `packs/contracts` (contract-files.*) · `recordRunFiles` · DTO zod `pack-contracts/contract-files.ts` · UI + i18n · 1 e2e (viết, không chạy).

## Không làm / Chạm
Không đổi `ATTACH_ALLOWED` (cả bản sao `extras-chat.rules.ts`), `pdf-gate.ts`, sweeper, đường `POST /attachments`. Chạm: `attachments/public.ts` + `run-links.ts` (thêm hàm), `packs.mount.ts` (gắn route), `packages/contracts` (DTO mới).

## Test tối thiểu
unit: `domain/contract-files.rules.test.ts`, `contract-files/lib/files-view.test.ts` · int: `adapters/contract-files.int.test.ts` (đường chính + 415/quyền/trần + chặn đọc chéo công ty) · e2e (không chạy): `e2e/contract-files/contract-files.spec.ts`.

## Quyết định trong lúc làm
- Kho tệp: dùng `contracts.files` + FileBox org `t_<tenant>` (cùng kho file chính; gói không FK sang `hub.*` — D-06), KHÔNG dùng `POST /attachments` của hub: vì vậy sweeper `attachments/sweeper.ts` không phải sửa (không có hàng `hub.attachments` nào cho tệp này). Danh sách đuôi vẫn lấy từ `ATTACH_ALLOWED` (nguồn duy nhất), MIME suy từ đuôi (không tin MIME khai báo).
- FK `contract_files` → `contracts` ON DELETE CASCADE (hàm `contracts.delete_contract` không phải sửa); → `files` RESTRICT; gỡ = xoá liên kết + `files.deleted_at` (kit không DELETE `files`).
- Quyền: xem/tải = thấy HĐ (RLS) + guard `read`; gắn = quyền sửa HĐ (quản trị gói, hoặc quyền ghi + người tạo/phụ trách — cùng khuôn `canDeleteContract`); gỡ = quyền sửa HĐ hoặc người đã gắn tệp (cần quyền ghi gói). DTO trả `can_add` / `can_remove` để UI ẩn nút kèm lý do.
- Trần 20 tệp/HĐ (`MAX_CONTRACT_FILES`) kiểm 2 lần (trước khi đưa lên FileBox; và trong câu INSERT để chống đua) ⇒ 409 `CONTRACT_FILES_FULL`. Quá trần byte ⇒ 413 `FILE_TOO_LARGE` (cùng `CONTRACTS_MAX_MB`, ≤ 20 MiB).
- Đuôi ngoài danh sách ⇒ 415 `FILE_TYPE` kèm câu liệt kê định dạng nhận được; tệp rỗng ⇒ 415. Không sniff magic bytes (tệp chỉ lưu/tải, không đọc nội dung).
- Nhóm 2: DB chỉ có `source` (start/form/subprocess), không có id bước ⇒ hiện nhãn nguồn («Khi gửi duyệt», «Điền ở bước duyệt», «Từ quy trình con») thay tên bước. Chỉ liệt kê tệp của lượt mà người xem XEM ĐƯỢC (cùng luật `readableRunFile`) để bấm tải luôn được; tải qua `GET /attachments/:id/content` hiện có.
- Chỉ HĐ bản đang xem (theo `pack_record_id`), không gộp tệp của các phiên bản khác trong chuỗi.
- Xoá HĐ ⇒ liên kết mất theo CASCADE, hàng `contracts.files` còn lại không đánh dấu xoá (nợ nhỏ, không lộ ra UI).
- Review cuối đợt (fix-cr133): `contract-files.mount.ts` không import module hub nữa — `stepFiles` (`recordRunFiles`) tiêm từ `packs.mount.ts` như `filebox` (luật `pack-no-hub-modules-any-layer`), gỡ dòng khỏi baseline depcruise. UI: đang tải ⇒ khung xương, lỗi tải ⇒ câu + nút «Thử lại», «Gỡ» ⇒ hộp xác nhận (`confirmDialog`).
- FileBox vắng ⇒ không gắn route (404), giống khối tải lên dùng FileBox; UI hiện câu lỗi chung khi tải danh sách lỗi.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-12 (đợt cr132-wave)
### ADDED pack-contracts/tai-lieu-kem.md
#### Yêu cầu: Trang chi tiết hợp đồng có một khối «Tài liệu kèm» cho mọi tệp của hợp đồng ngoài file chính (nguồn: CR-133)
Khối gồm hai nhóm trong cùng một chỗ: tệp gắn thẳng vào hợp đồng (Word, Excel, ảnh… theo danh sách định dạng nhận được; thêm, gỡ, xem hoặc tải) và tệp kèm các bước duyệt của hợp đồng (chỉ đọc, ghi rõ khi nào được kèm). Các tệp này không đem đi ký; file chính vẫn theo luật PDF khi công ty bật ký số.
- Kịch bản: người phụ trách thêm tệp .docx vào hợp đồng, tệp hiện trong khối, lấy được link tải, rồi gỡ [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-files.int.test.ts » thêm → liệt kê hai nhóm → link tải → gỡ]
- Kịch bản: gom hai nhóm tệp thành một khối và tính quyền gỡ từng dòng [test: apps/hub-api/src/modules/packs/contracts/domain/contract-files.rules.test.ts » hai nhóm trong một khối]
- Kịch bản: người dùng thêm tệp .docx vào hợp đồng, thấy trong khối «Tài liệu kèm» và tải được [test: thủ công — e2e/contract-files/contract-files.spec.ts viết sẵn, chạy một lần cuối đợt]
#### Yêu cầu: Ai thêm và gỡ được tệp kèm; định dạng và số lượng được nói rõ khi bị từ chối (nguồn: CR-133)
Xem được tệp kèm = xem được hợp đồng. Thêm tệp = người có quyền sửa hợp đồng (quản trị, hoặc người tạo/phụ trách có quyền ghi). Gỡ = người có quyền sửa hoặc chính người đã thêm tệp đó. Định dạng ngoài danh sách bị từ chối bằng câu nêu rõ các định dạng nhận được; mỗi hợp đồng tối đa 20 tệp kèm.
- Kịch bản: định dạng lạ bị từ chối, người không có quyền sửa không thêm được, đủ 20 tệp thì từ chối [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-files.int.test.ts » đuôi lạ ⇒ file_type]
- Kịch bản: đuôi .doc bị từ chối còn .docx được nhận [test: apps/hub-api/src/modules/packs/contracts/domain/contract-files.rules.test.ts » mimeByName]
#### Yêu cầu: Tệp kèm của công ty này không thấy được từ công ty khác (nguồn: CR-133)
Người của công ty khác không xem, thêm, gỡ hay lấy link tải được tệp kèm của hợp đồng; bảng tệp kèm chặn đọc chéo công ty bằng RLS.
- Kịch bản: công ty khác không thấy hợp đồng, thêm/gỡ bị từ chối, đếm bảng bằng 0 [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-files.int.test.ts » chặn đọc chéo công ty]

## Việc còn lại
Chạy e2e `e2e/contract-files/contract-files.spec.ts` một lần cuối đợt. Điều phối: gộp migration 0106 (journal idx 102 / when 1807000216000) tuần tự với lát khác chạm `migrations-pack-contracts`; `bun run test:lock:verify` nếu e2e mới nằm dưới khoá.
