---
id: cr122-e2b-approve-node
lát: cr122-e2b-approve-node
cr: CR-122
làn: đầy đủ
migration: không
phụ thuộc: E2 (53f7f837a, 9c54af544)
---
## Plan (ngắn)
Phần dở của E2 (trừ node Công cụ): node Duyệt độc lập, "Chạy lại từ Nếu", kiểm vế `fact` khi lưu FlowDef, 3 sửa sau soát E2.

## Làm
- [x] Contract: executor `approve {reject_step, return_step}` (`process-approve.ts`), `EXECUTOR_KINDS += approve`, `NODE_FAMILY_OF/NODE_PRODUCES`, `APPROVE_INVALID` + `approveStageIssues`.
- [x] Hub `nodes/approve`: launcher như `form` (output "chờ duyệt" ⇒ `waiting_review` + task Group của bước: nhắc/chuyển cấp của cổng có sẵn). `gates/approve-out.ts`: khi quyết ghi `fields.decision` (+ `decided_by`) vào output cùng tx; Từ chối/Trả lại có đích ⇒ chạy như Đạt, join bước rẽ tới đích (luật rẽ suy từ executor trong `step.repo`). Không đích ⇒ hành vi cổng cũ.
- [x] `POST /process-runs/:id/rerun-from-if` (`RunControlService.rerunFromIf`, vai platform/tenant admin): CAS sau khoá run (`needs_decision` + `decision.reason = facts_changed` + stage Nếu), `applyBack` về bước Nếu, audit `rerun_if`.
- [x] `DECISION_REASONS += facts_changed` (+ domain, nhãn thread, i18n vi/en); test khoá đếm `contracts-pd2` sửa 23 → 24.
- [x] `flowDefIssues`: vế `fact` của Nếu phải là khoá trong `AppEventDecl.facts` và đúng kiểu ⇒ `FLOW_WHEN_INVALID`.
- [x] Sau soát E2: `loadJoin` đọc `status`, lượt đã kết thúc ⇒ null (không gọi lại handler, không ghi đè `cancelled`); JSDoc `FactsReader` (tự lọc tenant, chỉ đọc đã commit); `actorId` để TODO (`fields.decided_by` đã có).
- [x] admin-web `FE_NODES.approve` CHỈ cho typecheck (`draftValue = null` ⇒ chưa chọn được; U2 bật).

## Quyết định trong lúc làm
- Duyệt dùng lại trọn cổng kiểm (task review, nhắc 24 giờ, chuyển cấp, loại trừ người gửi) thay vì cổng mới — một khái niệm một cơ chế.
- Rẽ Từ chối/Trả lại theo field `decision` qua đường `after.branch` có sẵn (không thêm cột/migration).
- `decision.options` của facts_changed = `["cancel"]`; "Chạy lại từ Nếu" là thao tác riêng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Node Duyệt độc lập
Người/Group của bước Duyệt / Từ chối / Trả lại; Từ chối, Trả lại rẽ tới bước đích (Kết thúc · Từ chối / Trả lại).
- Kịch bản: Duyệt ⇒ bước kế [test: apps/hub-api/src/modules/processes/adapters/runs/flow-approve.int.test.ts » Duyệt ⇒ bước kế (Kết thúc · Đã duyệt)]
- Kịch bản: Từ chối ⇒ bước đích [test: apps/hub-api/src/modules/processes/adapters/runs/flow-approve.int.test.ts » Từ chối ⇒ reject_step (bước 2 skipped)]
- Kịch bản: Trả lại ⇒ bước đích [test: apps/hub-api/src/modules/processes/adapters/runs/flow-approve.int.test.ts » Trả lại ⇒ return_step]
- Kịch bản: không đích ⇒ cổng cũ [test: apps/hub-api/src/modules/processes/gates/approve-out.test.ts » không đích ⇒ giữ hành vi cổng cũ, stage khác ⇒ null]
#### Yêu cầu: Lượt đã kết thúc không bị chốt lại
- Kịch bản: lượt huỷ, kết quả tới muộn ⇒ vẫn huỷ [test: apps/hub-api/src/modules/processes/adapters/runs/flow-approve.int.test.ts » lượt đã huỷ, kết quả tới muộn ⇒ vẫn cancelled, handler không bị gọi]
#### Yêu cầu: Chạy lại từ Nếu
- Kịch bản: chỉ lượt "dữ kiện đổi", bấm 2 lần ra 1 kết quả [test: apps/hub-api/src/modules/processes/gates/approve-out.test.ts » bấm lần 2 (đã running, decision null) / lý do khác / không phải Nếu ⇒ null]
#### Yêu cầu: Kiểm vế dữ kiện khi lưu
- Kịch bản: khoá lạ / sai kiểu bị chặn [test: apps/hub-api/src/modules/processes/gates/approve-out.test.ts » khoá lạ / sai kiểu ⇒ FLOW_WHEN_INVALID đúng đường dẫn]

## Việc còn lại
- int đường HTTP cho `rerun-from-if` và `/review-tasks/:id/decision` trên stage Duyệt (đã có unit CAS + int join bước).
- U2: bật node Duyệt trong bảng node (nhãn, khối chọn đích Từ chối/Trả lại, Group/nhắc/chuyển cấp), nút "Chạy lại từ Nếu" khi `decision.reason = facts_changed`.
- `tests/acceptance/P-d/rules/d2/contracts-pd2.test.ts`: `EXECUTOR_KINDS.slice(5)` và `PROCESS_DEF_RULES.slice(17)` đỏ sẵn (đuôi đã dài thêm từ CR-118…), không do lát này.
