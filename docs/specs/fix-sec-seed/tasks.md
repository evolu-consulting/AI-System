---
id: fix-sec-seed
title: Sau SEC 0140 — seed CR-113 dùng tệp của người duyệt thay; lỗi tệp không của mình ra 422 có mã
lane: nhanh (sửa sau sec-fix-1112)
---
# fix-sec-seed

## Plan (ngắn)
| # | Vấn đề | Sửa |
|---|---|---|
| a | `seed-cr113-samples.ts` duyệt thay HĐ 2 gắn tệp mẫu của `creatorId` ⇒ `record_evidence` (0140) từ chối ⇒ stack e2e `pm-checklist-pm` không dựng được | `sampleFile(d, userId)`: tệp mẫu của người vừa Nhận việc (`claim.by.id` = chủ gói duyệt thay). Grep seed/fixture khác gọi `record_evidence` kèm tệp: không còn chỗ nào (int test tự tạo tệp của chính người ghi). |
| b | Tệp không do mình tải lên ⇒ 500 (RAISE 42501 câu tiếng Việt, đường cổng duyệt không map) | hub `0141_sec_evidence_owner_code.sql`: kiểm «của chính bạn» TRƯỚC, RAISE SQLSTATE `EK422` message `EVIDENCE_FILE_NOT_OWNED` ⇒ `mapError` (dbGuardCode EK422, khuôn CR-101) trả 422 có mã ở MỌI route ghi bằng chứng. Mã khai ở `CHAT_CLAIM_ERRORS` (422) + câu EN `CLAIM_MESSAGES`; i18n `contracts.work.*.err.EVIDENCE_FILE_NOT_OWNED` (vi/en, cả khối u4 và u5). |

## Quyết định trong lúc làm
- Dùng cơ chế EK422 sẵn có (message = mã) thay vì bắt lỗi ở từng repo — một chỗ, mọi route (thẻ HĐ, cổng duyệt, mốc, phạt, yêu cầu thực hiện).
- Kiểm PNG/cỡ/đã dọn giữ câu 42501 cũ (đường pack `exec-errors` vẫn map `EVIDENCE_INVALID`).
- Seed không có int riêng; chạy thật ở lượt e2e `pm-checklist-pm` cuối đợt (điều phối).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-12 (đợt cr132-wave)

### MODIFIED engine/quy-trinh-cr127.md
#### Yêu cầu: Tệp bằng chứng không của mình báo lỗi rõ
Ghi bằng chứng kèm tệp hoặc chữ ký không do chính người ghi tải lên ⇒ 422 `EVIDENCE_FILE_NOT_OWNED` (không phải lỗi máy chủ), không ghi gì, việc vẫn mở.
- Kịch bản: khi A ghi bằng chứng bằng tệp hoặc chữ ký của B thì bị từ chối với mã EVIDENCE_FILE_NOT_OWNED [test: apps/hub-api/src/modules/processes/gates/evidence-owner.int.test.ts » A gắn tệp / chữ ký của B]
- Kịch bản: khi duyệt qua cổng duyệt kèm tệp của người khác thì 422 EVIDENCE_FILE_NOT_OWNED và việc vẫn mở [test: apps/hub-api/src/modules/processes/gates/evidence-owner.int.test.ts » duyệt qua cổng duyệt kèm tệp của B]

## Việc còn lại
- (web, workspace-web) thêm `EVIDENCE_FILE_NOT_OWNED` vào danh sách mã có câu: `CR127_ERROR_CODES` (`apps/workspace-web/src/platform/flow/lib/claim.ts`) và `CODES` (`apps/workspace-web/src/features/contract-review/api-exec.ts`) — khoá i18n đã có; ngoài vùng backend.
