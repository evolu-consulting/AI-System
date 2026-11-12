---
id: sec-fix-1112
title: Sửa bảo mật cuối đợt (security review 2026-11-12)
lane: đầy đủ (quyền/tenant, migration)
---
# sec-fix-1112 · Sửa bảo mật cuối đợt

## Plan (ngắn)
| # | Lỗ hổng | Sửa | Test (int tái hiện ĐỎ trước — commit `bbe0e238c`, rồi XANH) |
|---|---|---|---|
| 1 | `hub.record_evidence` chỉ kiểm tệp cùng tenant ⇒ A gắn attachment của B rồi tải qua endpoint tệp bằng chứng (scope system) | hub `0140_sec_evidence_owner.sql`: `CREATE OR REPLACE`, chữ ký + mọi `attachment_ids` phải `a.user_id = app.user_id` | `processes/gates/evidence-owner.int.test.ts` |
| 2 | `claimTask` bỏ qua `exclude_starter` (cả đường Toàn quyền `alsoMember`) ⇒ người gửi nhận việc của chính mình, giữ khoá tới `claim_release_h` | `claim.repo.ts` thêm `and not starterOut(user)` (cùng nguồn `starterExcluded`: snapshot `after.kind='review'` + `after.exclude_starter=true` + `process_runs.started_by`); `claimMiss` trả `starterExcluded`; `claimMissOutcome` ⇒ `STARTER_CANNOT_REVIEW` (403, mã có sẵn `CHAT_PROCESS_N2_ERRORS` + i18n `process/common`) | `processes/gates/claim-starter.int.test.ts` + unit `claim.rules.test.ts` |
| 3 | `createCtx.usersOk` thiếu `u.kind='internal'` ⇒ uỷ quyền cho user đối tác làm kẹt việc | `delegations.repo.ts` thêm `u.kind = 'internal'` (A và B) ⇒ `DELEGATE_NO_ACCESS` | `processes/delegations/delegations-external.int.test.ts` |
| 4 (Low) | `msg_files_ins` cho gắn mọi tệp mình tạo (kể cả tệp HĐ) ⇒ `files_msg_sel` giấu tệp HĐ với đồng nghiệp, Thu hồi tin soft-delete tệp HĐ | pack-contracts `0109_sec_msg_files_attach.sql`: hàm DEFINER `contracts.msg_file_attachable(fid)` (không là `contracts.file_id`/`contract_files.file_id`/`esign_envelopes.signed_file_id`) + 3 index `(tenant_id, file_id)`; policy `msg_files_ins` thêm điều kiện | `packs/contracts/messages/messages-attach-guard.int.test.ts` |

Không đụng «duyệt đơn tham gia chỉ cần write» (ADR-0044, người dùng đã chốt).

## Perf
Nhận việc: vẫn MỘT câu UPDATE (điều kiện con theo PK `stage_runs`/`process_runs`). Gắn tệp tin nhắn: +3 tra cứu index mỗi hàng `msg_files` (index mới 0109). `record_evidence`: không thêm câu.

## Quyết định trong lúc làm
- #2: mã lỗi dùng lại `STARTER_CANNOT_REVIEW` (403) — cùng khái niệm với cổng duyệt, đã có i18n; không thêm mã mới vào `CHAT_CLAIM_ERRORS`. Thứ tự `claimMissOutcome`: sau «đã xong/không cần nhận», trước «người khác giữ» (người gửi không nhận được dù đang có ai giữ).
- #3: dùng lại `DELEGATE_NO_ACCESS` (câu «Người được uỷ quyền không xem được hợp đồng này») thay vì thêm mã.
- #4: chọn «tệp chưa được dùng ở đâu khác» (hàm DEFINER, cùng khuôn `msg_file_visible` 0108) thay vì cột đánh dấu nguồn — không đổi luồng upload, không migration dữ liệu. Phiên bản HĐ là hàng `contracts` khác ⇒ đã phủ bởi `contracts.file_id`.
- #1: câu lỗi `EVIDENCE_INVALID_MESSAGE` đổi «không thuộc công ty này» → «không do bạn tải lên». `expiring-outcome.repo` (engine) đặt `app.user_id` = người quyết ⇒ tệp do chính người đó tải lên, không ảnh hưởng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/quy-trinh-cr127.md
#### Yêu cầu: Bằng chứng chỉ gắn tệp của chính người ghi
Chữ ký và mọi tệp của bằng chứng phải do chính người ghi bằng chứng tải lên (không chỉ cùng công ty); tệp của người khác ⇒ từ chối, không ghi.
- Kịch bản: khi A gắn tệp hoặc chữ ký do B tải lên thì bị từ chối 42501 và không ghi bằng chứng; tệp của A thì ghi được [test: apps/hub-api/src/modules/processes/gates/evidence-owner.int.test.ts » A gắn tệp / chữ ký của B]
#### Yêu cầu: Người gửi không nhận việc ở bước loại người gửi
Bước duyệt bật «loại người gửi» ⇒ người gửi lượt chạy không Nhận việc được (kể cả là thành viên phòng hoặc thuộc nhóm Toàn quyền) — trả 403 `STARTER_CANNOT_REVIEW`, việc vẫn chưa ai giữ; người khác nhận bình thường.
- Kịch bản: khi người gửi thuộc phòng bấm Nhận việc thì 403 và việc vẫn chưa ai giữ; thành viên khác nhận được [test: apps/hub-api/src/modules/processes/gates/claim-starter.int.test.ts » người gửi thuộc phòng]
- Kịch bản: khi người gửi chỉ thuộc nhóm Toàn quyền thì cũng bị chặn [test: apps/hub-api/src/modules/processes/gates/claim-starter.int.test.ts » người gửi chỉ thuộc Group Toàn quyền]
- Kịch bản: khi bước không bật loại người gửi thì người gửi vẫn nhận được [test: apps/hub-api/src/modules/processes/gates/claim-starter.int.test.ts » bước không bật exclude_starter]
#### Yêu cầu: Uỷ quyền chỉ giữa nhân viên nội bộ
Người uỷ quyền và người được uỷ quyền phải là nhân viên nội bộ còn hoạt động; user đối tác ⇒ `DELEGATE_NO_ACCESS`, không ghi.
- Kịch bản: khi uỷ quyền cho user đối tác thì bị chặn và không ghi; cho nhân viên nội bộ thì được [test: apps/hub-api/src/modules/processes/delegations/delegations-external.int.test.ts » A uỷ quyền cho user đối tác]

### ADDED pack-contracts/tin-nhan-tep.md
#### Yêu cầu: Không gắn tệp hợp đồng vào tin nhắn
Tệp gắn vào hội thoại phải do chính người gửi tải lên và chưa là tệp hợp đồng (tệp chính/phiên bản, tệp kèm HĐ, bản đã ký); tệp mới tải lên qua tin nhắn gắn được.
- Kịch bản: khi gắn tệp chính hoặc tệp kèm của hợp đồng vào tin nhắn thì bị chặn 42501; tệp mới tải lên thì được [test: apps/hub-api/src/modules/packs/contracts/messages/messages-attach-guard.int.test.ts » tệp chính HĐ / tệp kèm HĐ]

## Việc còn lại
- (ngoài phạm vi, ghi để soát) chiều ngược: gắn tệp tin nhắn làm tệp kèm HĐ (`contract_files`) — kiểm luồng thêm tệp kèm có nhận `file_id` sẵn có không.
- (web, vùng workspace-web) thêm `STARTER_CANNOT_REVIEW` vào `CR127_ERROR_CODES` (`apps/workspace-web/src/platform/flow/lib/claim.ts`) + khoá `contracts.work.u4.err.STARTER_CANNOT_REVIEW` (vi: «Bạn là người gửi nên không nhận việc duyệt bước này.») — hiện UI rơi về câu lỗi chung.
