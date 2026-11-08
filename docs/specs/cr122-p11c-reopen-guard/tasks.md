---
id: cr122-p11c-reopen-guard
lát: cr122-p11c-reopen-guard
cr: CR-122
làn: đầy đủ (máy trạng thái run)
migration: không
phụ thuộc: cr122-p11b-not-launched, cr122-p13-community-slow
---
## Plan (ngắn)
Blocker soát p11b: bấm "Mở lại" 2 lần / bấm khi sự kiện đầu đang chạy ⇒ 2 run cho một HĐ (run mồ côi, task trùng). Sửa: CAS Mở lại chỉ
khi lượt đã kẹt thật (409 nếu đang mở quy trình); app không nhận lượt ⇒ tx tạo run rollback (`superseded`); hook notLaunched trong
savepoint.

## Đã làm
- `contract-flow.repo.ts` `rearmFlow`: thêm điều kiện `feedback is distinct from FLOW_STARTING or updated_at < now() - 2 phút` (+ chưa
  run). Thua CAS ⇒ `withFlowResend` trả `flow_starting` ⇒ route 409 `APPROVAL_FLOW_STARTING` "Đang mở quy trình, thử lại sau ít phút".
- `flow-event-attach.ts`: `onCreated` trả false ⇒ ném `FlowRunSuperseded` ⇒ tx tạo run rollback; `flow-launch.ts` ⇒ `"superseded"`;
  dispatcher ghi `outcome.superseded`, chốt sự kiện (không thử lại, không báo "không mở được").
- Hợp đồng ngữ nghĩa `launched` (kit): false = bản ghi không nhận lượt; sự kiện không cần gắn ⇒ true. Contracts/community sự kiện khác ⇒
  true. Community `openReviewForFlow` trả "bài còn chờ duyệt" (gồm `mod_screen` null có sẵn) để không huỷ nhầm lượt hợp lệ.
- `not-launched.ts`: mỗi hook `notLaunched` trong SAVEPOINT (tx con drizzle), lỗi ⇒ log `flow-not-launched-hook-failed`, lô vẫn chốt
  (áp cho cả nhánh `closeExhausted`). Hook `launched` lỗi ⇒ chỉ rollback tx tạo run của MỘT sự kiện × flow (runPlan bắt riêng), lô không hỏng.

## P11d (commit riêng) · `contract.submitted` đúng thời điểm nghiệp vụ
Lỗi chặn (e2e G1.2, video demo bước 5): cờ bật ⇒ AI đọc xong là phát sự kiện + `holdForFlow` ⇒ thẻ thành engine/FLOW_STARTING ⇒ mất nút
"Xác nhận và lưu". Sửa: lượt vào `level1` (AI đọc xong `extract-job`, nhập tay / nâng giao dịch `startApproval`, heal `approval-sweep`)
KHÔNG phát khi cờ bật (cờ tắt vẫn ghi bóng như cũ); "Xác nhận và lưu" (`actApproval` approve, lượt máy cũ `level1`, người xác nhận
cấp 1) ⇒ `flow-submit.usecase.ts` CÙNG tx khoá HĐ: `holdForFlow` (+ SP chọn ⇒ `pending_links`) + `contract.submitted`; HĐ chưa khoá.

## Quyết định trong lúc làm
- P11d · người gây sự kiện = người bấm "Xác nhận và lưu" (lượt flow chạy dưới người đó), như lúc gửi duyệt ở máy cũ.
- Hook `launched` KHÔNG bọc savepoint "nuốt lỗi": nuốt lỗi = run mồ côi (đúng lỗi đang sửa); lỗi ⇒ sự kiện thử lại có lùi.

## Lưu ý deploy (p13)
- Trước khi deploy chạy trên prod (chỉ đọc): `select tenant_id, count(*) from community.posts where moderation = 'pending' and mod_screen is null group by 1;`
  — bài chờ duyệt có sẵn từ trước, flow mở lượt vẫn nhận (P11c) nhưng cần biết số lượng để soát thủ công. Trong DB int (mẫu `full`) đã đếm
  ở `not-launched.int.test.ts` (log `P11c p13: …`): kết quả 0 bài (evotest 2026-11-07, 750b10ed1).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Mở lại lượt chờ flow không sinh lượt trùng
Mở lại chỉ chạy khi lượt duyệt đã kẹt thật; đang mở quy trình thì báo "Đang mở quy trình, thử lại sau ít phút". Bản ghi đã có lượt thì
lượt mới bị huỷ ngay trong lúc tạo (không có lượt mồ côi). Lỗi xử lý báo "không mở được" của một bản ghi không chặn các bản ghi khác.
- Kịch bản: bấm Mở lại hai lần cùng lúc ⇒ một lần chạy, một lần báo đang mở, đúng một lượt [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » Mở lại 2 lần song song ⇒ một 'ok' + một 409 (flow_starting), đúng 1 run]
- Kịch bản: Mở lại khi sự kiện đầu chưa xong ⇒ báo đang mở [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » Mở lại khi sự kiện đầu chưa xử lý xong ⇒ 409 (flow_starting), không phát thêm sự kiện]
- Kịch bản: bản ghi đã có lượt, sự kiện thứ hai ⇒ không tạo lượt thứ hai [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » lượt đã có run + sự kiện thứ hai tới ⇒ superseded: tx tạo run rollback, vẫn 1 run, sự kiện chốt không lỗi]
- Kịch bản: hook báo lỗi ở một bản ghi ⇒ bản ghi khác vẫn được xử lý [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » hook notLaunched ném ở một sự kiện ⇒ chỉ log, lô vẫn chốt các sự kiện khác]

#### Yêu cầu: Gửi duyệt HĐ khi công ty bật flow theo sự kiện bắt đầu lúc người dùng xác nhận
AI đọc xong (hoặc tạo tay) ⇒ HĐ là nháp chờ rà soát, vẫn có nút "Xác nhận và lưu"; chỉ khi người dùng xác nhận mới gửi sự kiện gửi duyệt
và mở quy trình; công ty tắt cờ giữ đường cũ.
- Kịch bản: nháp chờ rà soát chưa gửi sự kiện, xác nhận ⇒ một sự kiện, quy trình mở và bước Duyệt mở [test: apps/hub-api/src/modules/processes/triggers/first-launch-contract.int.test.ts » level1 ⇒ chờ flow, một dispatchOnce ⇒ run gắn vào lượt + task 'Duyệt giá trị lớn' mở, máy cũ duyệt ⇒ APPROVAL_NOT_OPEN, HĐ không khoá]
- Kịch bản: AI đọc xong khi cờ bật ⇒ không phát sự kiện [test: apps/hub-api/src/modules/packs/contracts/application/contract-flow.usecase.test.ts » cờ BẬT: AI đọc xong chưa phát (nháp chờ rà soát), không mở run cũ]
- Kịch bản: công ty cờ tắt ⇒ như cũ [test: apps/hub-api/src/modules/processes/triggers/first-launch-contract.int.test.ts » công ty cờ TẮT: lượt giữ máy cũ (không chờ flow), duyệt máy cũ khoá HĐ như trước]

## Việc còn lại
- [ ] Soát Opus low diff (máy trạng thái run).
- [ ] Web: khoá i18n cho mã lỗi `APPROVAL_FLOW_STARTING` (hiện câu tiếng Việt từ server).
- [ ] Chạy câu SELECT đếm trên prod trước deploy (mục "Lưu ý deploy").
