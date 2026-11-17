---
id: s10-sign-record
lát: s10-sign-record
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s6-sign-db, s8-sign-api
---
## Plan (ngắn)
Hồ sơ duyệt (JSON + PDF) có hình chữ ký, loại chữ ký, số tệp ký, danh sách tệp + sha256 + mã kiểm tra; PDF tự lập + lưu khi HĐ vào DONE; web hiện thẳng ảnh chữ ký.

## Làm
- [x] Contract: `ApprovalRecord` thêm `items[].sign`, `signs[]`, `files[]` (optional, tương thích ngược) — `packages/contracts/src/pack-contracts/approval.ts`.
- [x] Luật thuần `buildSignInfo`/`checkCode` + `buildApprovalRecord(..., signRows)` — `domain/approval-record.rules.ts`.
- [x] SQL một câu `signsOfQ`, `savedRecordQ` — `adapters/approval-record-signs.repo.ts`; ảnh in: `stampPngOf` (hub, `= any(array)`) ở `packs.tenant-config.ts`.
- [x] Route ảnh chữ ký in `GET /contracts/:id/approval-record/stamps/:stampId` (guard `read`, chỉ id thuộc bản không huỷ của HĐ).
- [x] PDF: nhúng ảnh (pdf-lib), «Loại chữ ký · Số tệp đã ký», cuối hồ sơ «Tệp và dấu vân tay» (sha256 + mã 8 ký tự).
- [x] Tự lập + lưu khi HĐ DONE: hook DONE → `pg_notify` → LISTEN → FileBox + `contracts.files` + sự kiện `approval_record_saved` (`approval-record-save.mount.ts`); route tải trả bản lưu cho người đọc được nội dung.
- [x] Web: `SignImg` trong `ApprovalRecord.tsx`, link «Xem bản đã ký» → `/contracts/signed/:id` (thẻ `<a>`, route do s14).
- [x] Test: unit rules + PDF + web; int `approval-record-sign.int.test.ts` (X2, sha256, lưu PDF).

## Không làm / Chạm
Không làm trang Xem bản đã ký, màn ký, kiểm tra tệp. Chạm hub-api `packs/contracts` + `packs.mount/tenant-config`, contracts, workspace-web `contract-approval`, i18n `contracts/work`.

## Test tối thiểu
unit: rules + PDF + web SignImg; int evotest: X2, sha256 bản cuối, PDF lưu một bản.

## Quyết định trong lúc làm
- Không migration: tham chiếu bản lưu = sự kiện `contract_events.type='approval_record_saved'` (`data.file_id` → `contracts.files.id`); 0122 chưa dùng.
- Bản lưu đủ nội dung (ý kiến/tệp) ⇒ CHỈ trả cho người đọc được nội dung (BR-X2/BR-26); người chỉ xem luôn nhận bản lập ngay đã lọc.
- Kích hoạt lưu bằng NOTIFY trong tx DONE (không ghi FileBox trong tx, không poll); nhiều instance: khoá advisory + «chưa có sự kiện», bản dư xoá ở FileBox.
- Soát Opus (CHANGES REQUESTED) đã sửa: «lập khi cần» là đường chính (route PDF + khối hồ sơ: DONE + chưa có bản lưu hợp lệ ⇒ lập + lưu, `pg_try_advisory_xact_lock` trước khi lập); NOTIFY chỉ là đường nhanh. Bản lưu khoá theo tập id bản ký cuối chưa huỷ (`data.versions` = md5): huỷ → ký lại ⇒ lập mới. Người lập = bản lưu đủ nội dung (`full`), không phụ thuộc quyền một người (thiếu `created_by` ⇒ UUID hệ thống); `rec` null ⇒ log.
- sha256 của BẢN GỐC để null (hồ sơ chưa tính; bản đã ký cuối có sha256 từ `sign_versions`).
- Ảnh trên web: bằng chứng duyệt (chỉ khi đọc được) ưu tiên, không có thì ảnh in; tải bằng blob kèm Bearer.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Hồ sơ duyệt có hình chữ ký
Mỗi bước ghi người làm, bước, lúc, quyết định, ý kiến, hình chữ ký, loại chữ ký, số tệp đã ký, duyệt thay; cuối hồ sơ là danh sách tệp kèm dấu vân tay và mã kiểm tra. Hình chữ ký ai xem HĐ cũng thấy; ý kiến và tệp đính kèm chỉ người trong quy trình.
- Kịch bản: khi người xem HĐ ngoài quy trình mở hồ sơ thì thấy hình chữ ký nhưng không thấy ý kiến [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-record-sign.int.test.ts » người xem HĐ ngoài quy trình thấy hình chữ ký nhưng KHÔNG thấy ý kiến (BR-X2)]
- Kịch bản: khi HĐ có bản đã ký thì hồ sơ ghi sha256 và mã kiểm tra của bản cuối [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-record-sign.int.test.ts » hồ sơ có sha256 của bản cuối + mã kiểm tra]
- Kịch bản: khi PDF hồ sơ dựng thì có ảnh chữ ký nhúng và mã kiểm tra [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-record.sign.pdf.test.ts » dựng PDF có XObject ảnh và mã kiểm tra, loại chữ ký, số tệp]
- Kịch bản: khi trang HĐ hiện hồ sơ duyệt thì ảnh chữ ký hiện thẳng trong dòng [test: apps/workspace-web/src/features/contract-approval/components/ApprovalRecord.sign.test.tsx » hiện ảnh chữ ký đã in ngay trong dòng của người ký]

#### Yêu cầu: Tự lập và lưu PDF hồ sơ duyệt khi HĐ ký đủ
- Kịch bản: khi HĐ ký đủ mà lưu lỗi lần đầu thì lần tải sau tự lưu được và người chỉ xem luôn nhận bản lập ngay [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-record-sign.int.test.ts » HĐ ký đủ: lưu lỗi lần đầu thì lần tải sau tự lưu được, người chỉ xem luôn nhận bản lập ngay]
- Kịch bản: khi huỷ bản ký rồi ký lại thì lập bản lưu mới với sha256 mới [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-record-sign.int.test.ts » huỷ bản ký rồi ký lại: lập bản lưu mới với sha256 mới (khoá theo tập bản cuối)]
- Kịch bản: khi bước là Toàn quyền duyệt thay thì hồ sơ ghi duyệt thay [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-record-sign.int.test.ts » hồ sơ có sha256 của bản cuối + mã kiểm tra, và bước duyệt thay ghi override]

## Việc còn lại
- sha256 của bản gốc (null). Tên người ký không có bước duyệt tra qua `userNames` (chưa có test riêng).
