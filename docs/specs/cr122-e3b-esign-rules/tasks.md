---
id: cr122-e3b-esign-rules
lát: cr122-e3b-esign-rules
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: E3 (18a4efaaa)
---
## Plan (ngắn)
Hoàn thiện node Ký số / Chờ sự kiện nhiều kết quả sau soát E3: luật lưu `branches`, field output `event`, dọn sự kiện sót, int huỷ hẹn khi Từ chối.

## Làm
- [x] `wait-timed.rules`: `branches[j].on` ∈ `event` ∪ `also_events` ∪ `timeout`, `goto_step` là bước có thật SAU bước chờ ⇒ ngược lại WAIT_INVALID (`stages.i.executor.branches.j`).
- [x] `wait_event` khai output field `event` (`ensureWaitEventStage`, `NODE_PRODUCES.wait_event = declared`) ⇒ node Nếu đọc được.
- [x] `stage-timer.repo`: một câu chọn sự kiện thắng VÀ đánh dấu đã dùng mọi dòng chưa dùng cùng khoá của stage.
- [x] int: Từ chối rẽ tới Kết thúc khi hẹn còn mở ⇒ hẹn nhánh bỏ + nhánh sau Kết thúc bị huỷ; int hai sự kiện cùng chờ.

## Quyết định trong lúc làm
- Sự kiện tới SAU khi stage chờ đã xong vẫn có thể được ghi lại nếu snapshot còn một `wait_event` cùng khoá ở phía sau (`record` upsert đặt lại `consumed_by`) — giữ như CR-120 (một flow không nên có hai bước chờ cùng khoá; luật def đã chặn khoá trùng `WAIT_INVALID`).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Luật lưu rẽ nhánh của Chờ sự kiện
- Kịch bản: on lạ / đích sai bị chặn [test: apps/hub-api/src/modules/processes/nodes/wait-for/wait-branches.rules.test.ts » on lạ / đích lùi / đích không có ⇒ WAIT_INVALID đúng đường dẫn]
#### Yêu cầu: Chờ sự kiện có field `event` (kể cả def `wait_event` cũ khi lưu lại / chạy: output có `fields.event`)
- Kịch bản: normalize khai field [test: apps/hub-api/src/modules/processes/nodes/wait-for/wait-branches.rules.test.ts » normalize khai field output `event`]
#### Yêu cầu: Sự kiện trùng không sót
- Kịch bản: hai sự kiện cùng chờ ⇒ dùng hết [test: apps/hub-api/src/modules/processes/adapters/timers/wait-event-esign.int.test.ts » hai sự kiện cùng chờ (webhook + đồng bộ) ⇒ thắng cái nhận sớm, MỌI dòng cùng khoá đã dùng (không sót cho bước chờ sau)]
#### Yêu cầu: Kết thúc huỷ hẹn còn mở
- Kịch bản: Từ chối rẽ tới Kết thúc [test: apps/hub-api/src/modules/processes/adapters/runs/flow-approve.int.test.ts » Từ chối rẽ tới Kết thúc khi hẹn còn mở ⇒ hẹn của nhánh bị bỏ và nhánh sau Kết thúc bị huỷ]
#### Yêu cầu: OutcomeHandler nhận người duyệt (từ E3)
`actorId` truyền cho MỌI `OutcomeHandler` = `fields.decided_by` của node Duyệt xong gần nhất (không có ⇒ null).
- Kịch bản: thủ công — đã có trong E3 [test: thủ công — đọc trong `flow-step.repo.ts` applyOutcome, int E3 `flow-*` xanh]

## Việc còn lại
- Manifest `nodes[]` + khai `esign.*` (N1).
