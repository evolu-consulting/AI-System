---
id: cr122-p11e-confirm-flow
lát: cr122-p11e-confirm-flow
cr: CR-122
làn: nhanh (web, thẻ duyệt)
migration: không
phụ thuộc: cr122-p11c-reopen-guard (P11d)
---
## Plan (ngắn)
e2e G1.2 đỏ sau P11d: nhân viên bấm "Xác nhận và lưu" ⇒ trang đứng, không bao giờ hiện bước "Duyệt giá trị lớn"; gợi ý "Bản nháp chỉ
bạn thấy — bấm Xác nhận và lưu…" vẫn hiện.

## Bằng chứng (trace evotest `cr122-q1-e2e/.data/evotest/20261107-001619-3404-e2e`, G1.2)
- Server ĐÚNG đường mới: `POST …/tasks/<id lượt>/actions/approve` ⇒ `mode: engine`, `step: level1`; `GET …/approval` ngay sau ⇒
  `feedback: FLOW_STARTING`, `run_status: null`, `steps: []`, `attention: null` (submitToFlow đã ghi sự kiện + chờ flow).
- Sau đó web KHÔNG gửi thêm request nào tới thẻ trong 45 s (HĐ g1 17:19:11 → HĐ g1b 17:19:57; g1b y hệt).
- Nguyên nhân: `apps/workspace-web/src/features/contract-approval/lib/engine-card.ts` `engineAdvancing` đòi `steps.length > 0` ⇒ thẻ
  chờ flow (chưa run, chưa bước) bị coi là "không chuyển bước" ⇒ `useApproval` tắt tải lại; push `/me/stream` lọc theo run của thẻ ⇒
  cũng không tới. Thẻ đứng ở trạng thái lúc xác nhận dù bộ điều phối đã mở run (int P11d chứng minh phía server mở run + task ≤ 1 lượt).
- Gợi ý nháp: `ContractReviewPage.tsx` hiện khi `status = needs_review` — với flow theo sự kiện HĐ vẫn `needs_review` tới khi duyệt xong.

## Đã làm
- `engineAdvancing`: thêm trường hợp `engine_run_id === null` (đang mở quy trình) ⇒ vẫn tải lại (2·4·8·16 s rồi 30 s); kẹt (`attention`)
  vẫn dừng như cũ.
- `submittedForReview` (engine, cấp 1, bước soạn s0 không mở) ⇒ `useApprovalUi().submitted` ⇒ trang tắt gợi ý "bản nháp".

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-web.md
#### Yêu cầu: Thẻ duyệt sau "Xác nhận và lưu" khi công ty bật flow theo sự kiện
Sau khi người dùng xác nhận, thẻ duyệt tự cập nhật tới khi quy trình mở và hiện bước duyệt đang mở; trang không còn gợi ý "bản nháp"
khi hợp đồng đã gửi đi.
- Kịch bản: vừa xác nhận, quy trình đang mở ⇒ thẻ tiếp tục tải lại [test: apps/workspace-web/src/features/contract-approval/lib/engine-card.flow.test.ts » chưa run, chưa bước, không attention ⇒ vẫn tải lại (đang mở quy trình)]
- Kịch bản: bước duyệt đã mở ⇒ thôi tải lại [test: apps/workspace-web/src/features/contract-approval/lib/engine-card.flow.test.ts » run đã gắn, bước kế đang chờ ⇒ tải lại, bước mở ⇒ thôi]
- Kịch bản: đã gửi ⇒ không còn là bản nháp [test: apps/workspace-web/src/features/contract-approval/lib/engine-card.flow.test.ts » đã gửi (engine, bước soạn không mở) ⇒ hết là bản nháp, bước soạn s0 mở / máy cũ ⇒ còn nháp]

## Việc còn lại
- [ ] qc chạy lại e2e journey G1.2 (một lần) sau gộp.
- [ ] (ghi nợ) `eventConcernsRun` so `process_run_id` với `run_id` của thẻ (= id lượt duyệt, không phải run engine) ⇒ push không bao giờ
  khớp; nên so `engine_run_id`. Ngoài phạm vi lát (lưới tải lại đủ để chạy đúng).
