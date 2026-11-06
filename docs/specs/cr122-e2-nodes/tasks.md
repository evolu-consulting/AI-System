---
id: cr122-e2-nodes
lát: cr122-e2-nodes
cr: CR-122
làn: đầy đủ
migration: không
phụ thuộc: F0 (9b124375c)
---
## Plan (ngắn)
Phần chạy node của FlowDef (CR-122 E2, flow-model.md mục B/H2): Nếu đọc dữ kiện app (`fact`), bước gộp `next_step`, Kết thúc
(`outcome`) gọi `OutcomeHandler` cùng tx chốt lượt, dữ kiện đổi sau khi rẽ ⇒ "Cần xử lý".

## Làm
- [x] Contract `CondFromSchema` += `{kind:"fact", key}` (FACT_KEY_RE); luật lưu If chỉ kiểm phép so cho vế `fact`.
- [x] Domain `if.rules`: `compareFact` (boolean/danh sách/trống ⇒ Sai), `evaluateWhen(..., facts)` trả `reads`; `finish.rules`.
- [x] `settleStep`: Nếu có vế `fact` ⇒ đọc `FactsReader` (≤ 1 lần/lượt rẽ), LUÔN ghi audit `branch.facts {matched, reads}`;
  `next_step` ⇒ nhảy bước gộp (stage giữa `skipped` + huỷ hẹn); bước có `outcome` xong ⇒ so lại mọi Nếu-fact, lệch ⇒
  `needs_decision{reason: facts_changed, stage_idx}`, không lệch ⇒ `OutcomeHandler.apply(tx)` + nhánh sau `skipped` + run `done`.
- [x] Sổ cổng `adapters/runs/flow-ports.ts` (`registerFactsReader`/`registerOutcomeHandler`, tra theo `(pack, event)`).

## Không làm / Chạm
- Không thêm loại executor mới (`review`/`finish`): FE_NODES (admin-web, của U1) bắt buộc đủ loại ⇒ vỡ typecheck. Kết thúc = stage có `outcome` (executor tuỳ, vd `set` rỗng).
- Không migration (dùng `needs_decision` + `decision` jsonb có sẵn; audit action `branch` có sẵn).
- E1 (trigger/queue/0105–0106), U1 (admin-web), DLC: không chạm.

## Test tối thiểu
- unit: `domain/runs/finish.rules.test.ts`, `application/runs/settle-step-flow.usecase.test.ts`, `domain/if/if.rules.test.ts`.
- int: `adapters/runs/flow-step.repo.int.test.ts`.

## Quyết định trong lúc làm
- Kết thúc không phải executor riêng (lý do trên); `OutcomeHandler` gọi trong `settleStep` (tx join bước đã khoá run) thay vì `apply-settle.ts` (file đó là stage Áp/PR).
- Handler chưa đăng ký cho lượt gắn gói + FlowDef mới ⇒ ném (rollback, không chốt lượt nửa vời). Lượt cũ/không gói ⇒ chỉ chốt.
- `actorId` truyền `null` (người quyết bước cuối chưa có trong join bước).
- "Cần xử lý" dùng `needs_decision` + `decision.reason = facts_changed` (không thêm `DECISION_REASONS` — test khoá đếm 23).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Node Nếu đọc dữ kiện bản ghi
Điều kiện Nếu có nguồn `fact` đọc giá trị HIỆN TẠI qua `FactsReader` của app; trống ⇒ Sai; lần rẽ ghi giá trị đã đọc.
- Kịch bản: giá trị 150 > 100 ⇒ Đúng, audit ghi giá trị đã đọc [test: apps/hub-api/src/modules/processes/adapters/runs/flow-step.repo.int.test.ts » Nếu đọc giá trị hiện tại (150 > 100 ⇒ Đúng), ghi giá trị đã đọc vào lịch sử, Sai-nhánh skipped]
- Kịch bản: trường trống ⇒ nhánh Sai [test: apps/hub-api/src/modules/processes/adapters/runs/flow-step.repo.int.test.ts » trường trống ⇒ nhánh Sai, lịch sử ghi null]
#### Yêu cầu: Bước gộp next_step
Cuối nhánh có `next_step` ⇒ đi tới bước gộp, nhánh kia bị bỏ qua.
- Kịch bản: nhánh Đúng gộp về bước 5 [test: apps/hub-api/src/modules/processes/application/runs/settle-step-flow.usecase.test.ts » cuối nhánh Đúng (next_step 5) ⇒ nhảy tới bước gộp, nhánh kia skipped + huỷ hẹn]
#### Yêu cầu: Node Kết thúc gọi OutcomeHandler
Bước có `outcome` xong ⇒ app áp kết quả cùng tx chốt lượt, idempotent; giá trị đổi sau khi rẽ ⇒ "Cần xử lý".
- Kịch bản: Kết thúc idempotent khi gọi lại [test: apps/hub-api/src/modules/processes/adapters/runs/flow-step.repo.int.test.ts » Kết thúc ⇒ OutcomeHandler cùng tx, run done, nhánh sau skipped, gọi lại ⇒ already_applied, không đổi]
- Kịch bản: handler lỗi ⇒ rollback [test: apps/hub-api/src/modules/processes/adapters/runs/flow-step.repo.int.test.ts » handler ném ⇒ rollback: run KHÔNG done (thử lại sau)]
- Kịch bản: dữ kiện đổi ⇒ Cần xử lý [test: apps/hub-api/src/modules/processes/adapters/runs/flow-step.repo.int.test.ts » H2 · giá trị đổi sau khi rẽ (150 ⇒ 50) ⇒ Cần xử lý, không gọi handler]

## Việc còn lại
- Node Duyệt độc lập (duyệt/từ chối/trả lại → Kết thúc · Trả lại qua `back.effects.ts`, nhắc, chuyển cấp) — chưa làm (cần loại executor mới ⇒ phối hợp U1 thêm FE_NODES).
- "Chạy lại từ node Nếu" cho `decision.reason = facts_changed` qua `gates/run-control.service.ts` — chưa làm.
- Node Công cụ cho Dify/MCP/tool app trong catalog — chưa làm.
- Kiểm vế `fact` với `AppEventDecl.facts` khi lưu FlowDef (khoá/kiểu) — route lưu gọi `flowDefIssues` cần mở rộng cho điều kiện Nếu.
