---
id: cr122-e3-esign-node
lát: cr122-e3-esign-node
cr: CR-122
làn: đầy đủ
migration: không
phụ thuộc: E2b (b0bcd5d70)
---
## Plan (ngắn)
Ký số thành node trong flow: **gửi ký** = tool gói `contracts-esign-send` (adapter nhà cung cấp hiện có, đa nhà cung cấp giữ nguyên) +
**chờ ký** = `wait_event` mở rộng nhiều kết quả (`also_events`, `branches`) ⇒ rẽ Đã ký / Từ chối / Huỷ / Hết hạn.

## Làm
- [x] Contract `WaitEventExecutorSchema` += `also_events` (≤ 3), `branches [{on, goto_step}]` (`on` = khoá sự kiện hoặc `timeout`); `waitEventKeys`.
- [x] Engine: `run-event.repo` khớp khoá chính + phụ; stage chờ xong tiêu thụ MỘT sự kiện nhận sớm nhất (1 câu) và ghi field `event` (khoá / `timeout`); `step.repo` suy luật rẽ từ `branches` (cùng đường `after.branch`).
- [x] Gói contracts: trạng thái cuối phong bì ⇒ `esign.completed|declined|voided` (`domain/esign-event.rules.ts`), hook `bindCompleted` truyền khoá; `intake.mount` bắn đúng khoá qua `signalEvent`.
- [x] Sau soát E2b: `applyOutcome` lấy `actorId` = `fields.decided_by` của node Duyệt đã xong gần nhất (1 câu).

## Không làm / Chạm
- Đường cũ (Ký số sau "Đã duyệt" ngoài engine, `esign-flow.usecase.afterApproved`) giữ nguyên — chạy khi cờ `FLOW_TRIGGERS` tắt / mẫu cũ có bước esign.
- Không đụng dispatcher (E1b), phía phát sự kiện A1 (events/FactsReader/OutcomeHandler). File vùng esign đã sửa: `esign.mount.ts`, `intake.mount.ts` (chữ ký hook thêm tham số `event`).

## Quyết định trong lúc làm
- Không thêm loại executor "Ký số": node Ký số = cặp tool gửi + Chờ sự kiện nhiều kết quả (tái dùng hẹn hạn + `signalEvent`); app khai trong manifest (U2/A1 dựng cặp trên canvas).
- Hai sự kiện cùng ghi trước khi thả ⇒ thắng sự kiện nhận sớm nhất (cùng lúc ⇒ thứ tự khai).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Chờ sự kiện nhiều kết quả (Ký số trong flow)
Node Chờ sự kiện nhận nhiều khoá, ghi khoá đã nhận vào field `event`, rẽ bước theo `branches`.
- Kịch bản: từ chối ký ⇒ rẽ nhánh Từ chối [test: apps/hub-api/src/modules/processes/adapters/timers/wait-event-esign.int.test.ts » từ chối ký ⇒ stage chờ xong (event = esign.declined), rẽ tới Kết thúc · Từ chối, nhánh Đã ký skipped]
- Kịch bản: webhook hai lần ⇒ một kết quả [test: apps/hub-api/src/modules/processes/adapters/timers/wait-event-esign.int.test.ts » webhook trả về hai lần ⇒ một kết quả (lần 2 không thả, không thêm output)]
- Kịch bản: trạng thái phong bì ⇒ khoá sự kiện [test: apps/hub-api/src/modules/processes/domain/timers/wait-event-branch.rules.test.ts » trạng thái cuối ⇒ khoá sự kiện, còn lại ⇒ null]

## Việc còn lại
- int "Từ chối rẽ tới Kết thúc khi hẹn nhắc/chuyển cấp còn mở ⇒ hẹn bị huỷ" (yêu cầu sau soát E2b) — chưa viết (hết thời gian lát).
- Luật lưu def cho `branches` của `wait_event` (đích > bước, `on` ∈ khoá chờ ∪ timeout) — chưa có (WAIT_INVALID); hiện runtime bỏ qua đích sai (phòng thủ `branchTarget`).
- Manifest contracts khai `esign.*` + node Ký số trên canvas (U2/A1).
