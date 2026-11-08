---
id: cr122-p11b-not-launched
lát: cr122-p11b-not-launched
cr: CR-122
làn: đầy đủ (máy trạng thái run)
migration: không
phụ thuộc: cr122-p11-first-launch
---
## Plan (ngắn)
Blocker soát p11: lượt duyệt HĐ chờ flow (`FLOW_STARTING`) kẹt mãi khi bộ điều phối không mở được run (0 flow khớp / bị từ chối /
hết lượt thử / lease_exhausted). Sửa: báo app khi sự kiện chốt mà không có run, thẻ có lý do + Mở lại (phát lại sự kiện), FLOW_STARTING
quá 2 phút ⇒ kẹt, thẻ không trống bước sau khi gắn run.

## Đã làm
- Kit `OutcomeHandler.notLaunched?(tx, {tenantId, event, ref, reason})`.
- `processes/triggers/not-launched.ts`: `notLaunchedReason` (thuần) + `notifyNotLaunched`; `dispatcher.ts` gọi trong tx chốt lô
  (sự kiện cờ bật, không lượt, không còn thử lại) và sau `closeExhausted` (nay trả tenant/event/ref) với `FLOW_START_FAILED`.
- Contracts `markFlowNotLaunched` (CAS: level1, engine, chưa run, `feedback = FLOW_STARTING`) ghi mã lý do: `FLOW_NOT_ASSIGNED`,
  `FLOW_GROUP_MISSING:<mã>`, `FLOW_REFUSED`, `FLOW_START_FAILED`.
- "Mở lại" của lượt chờ flow (`flow-resend.usecase.ts`, nối ở `extraction.mount.ts`): `rearmFlow` (CAS chưa run) + phát lại
  `contract.submitted` với event_id mới (người gây = người gửi duyệt); lượt khác ⇒ đường Mở lại cũ.
- Thẻ: `attentionOf` bỏ qua FLOW_STARTING chỉ khi `updated_at` ≤ 2 phút (quá ⇒ stalled `FLOW_STARTING`); `runCardSteps` chưa có bước
  mở ⇒ hiện bước kế tiếp đang chờ. Web: mã mới trong `attention.ts` + câu vi/en (kèm cách sửa, "rồi bấm Mở lại").

## Quyết định trong lúc làm
- Nút: dùng lại nút "Mở lại" sẵn có của thẻ kẹt (Luật GỐC 2: một control cho một việc), không thêm nút "Gửi lại" riêng; câu lý do
  hướng dẫn "bấm Mở lại".
- Lý do lưu là MÃ (web dịch), theo khuôn `FLOW_GROUP_MISSING`/`FLOW_ROUTE_NONE` có sẵn.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Lượt duyệt chờ flow không kẹt khi không mở được quy trình
Công ty bật flow theo sự kiện: sự kiện gửi duyệt chốt mà không mở được lượt nào thì thẻ duyệt HĐ báo lý do nghiệp vụ kèm cách sửa và
cho chủ HĐ Mở lại (phát lại sự kiện mới); chờ mở quy trình quá 2 phút cũng báo kẹt; vừa gắn lượt thì thẻ hiện bước kế tiếp.
- Kịch bản: chưa gán quy trình ⇒ lý do FLOW_NOT_ASSIGNED, gán rồi Mở lại ⇒ lượt chạy [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » 0 flow khớp ⇒ lý do FLOW_NOT_ASSIGNED, gán flow + Mở lại (event_id mới) ⇒ run gắn vào lượt]
- Kịch bản: thiếu nhóm của quy trình ⇒ lý do nêu mã nhóm [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » flow cần nhóm công ty chưa có ⇒ lý do FLOW_GROUP_MISSING:<mã>]
- Kịch bản: chờ mở quy trình quá 2 phút ⇒ báo kẹt [test: apps/hub-api/src/modules/packs/contracts/domain/approval-engine-card.flow.rules.test.ts » P11b · FLOW_STARTING quá 2 phút ⇒ stalled (lý do FLOW_STARTING), còn mới ⇒ null]
- Kịch bản: vừa gắn lượt ⇒ thẻ hiện bước kế tiếp [test: apps/hub-api/src/modules/packs/contracts/domain/approval-engine-card.flow.rules.test.ts » P11b · vừa gắn run, chưa có bước mở ⇒ thẻ hiện bước kế tiếp đang chờ (không trống)]
- Kịch bản: mỗi lý do có câu riêng trên web [test: apps/workspace-web/src/features/contract-approval/lib/attention.flow.test.ts » mỗi mã có câu riêng (không rơi về câu chung)]

## Việc còn lại
- [ ] Soát Opus low diff (máy trạng thái run).
- [ ] e2e: ca "chưa gán quy trình ⇒ lý do + Mở lại" trong journey (qc, cuối đợt).
