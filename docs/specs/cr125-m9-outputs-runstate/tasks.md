---
id: cr125-m9-outputs-runstate
lát: cr125-m9-outputs-runstate
cr: CR-125
làn: đầy đủ (chạm trạng thái run — ghi output khi thả bước chờ / Thông báo)
migration: không
phụ thuộc: m8
---
## Plan (ngắn)
Bỏ `pending` cho 7 đầu ra m8 để lại (docs/specs/cr125-m8-io-ports/tasks.md «Việc còn lại»): máy chủ ghi thật, cùng tx/câu với đường settle sẵn có, không đổi chuyển trạng thái run.

## Làm
- engine: `PackRunsPort.signalEvent(…, data?)` → `signalEvent` use case → `finishWait({signal})` → `waitMd` gộp dữ liệu kèm vào `fields` CÙNG câu INSERT output (`waitEventFields`: chỉ khi sự kiện mang dữ liệu là sự kiện THẮNG; không ghi đè `event`; lọc khoá/giá trị `cleanEventData`).
- Ký số: hook trạng thái cuối (`esign.mount` onStatus) đọc phong bì mới nhất (1 câu) ⇒ `esignOutputsOf` (envelope_id; ký xong + signed_at YYYY-MM-DD + signer) ⇒ `signalEvent`. Tool `contracts-esign-send` trả thêm `envelope_id`.
- Gửi đối tác: `onPartnerReplies` gửi `partnerReplyData` (round, partner_reason).
- Thông báo: `enqueueRunNotice` trả tên người nhận (cùng câu) ⇒ `sent_to` qua `StageResult.fields` (gộp vào INSERT output của `writeOutput`); mẫu `{khoá}` = đầu ra các bước trước (`priorStepFields`, 1 câu) + input (input thắng khi trùng).
- Bỏ `pending` ở node.ts (esign, partner-send, core notify); binding `outputs` + `CORE_WRITTEN_OUTPUTS` thêm khoá; io-ports.test / packs.modules-outputs.test cập nhật.

## Không làm / Chạm
Không migration (sự kiện ghi SỚM trước khi bước chờ bắt đầu không mang dữ liệu — `process_run_events` không có cột payload; thêm ⇒ cần migration, để sau nếu cần). Không đổi máy trạng thái run, không đổi canvas/UI.

## Test tối thiểu
unit: wait-event-data.rules.test, esign-outputs.rules.test, notify-vars.test, io-ports.test, packs.modules-outputs.test, module-registry.test, timers/*. int server: tests/acceptance/CR-125/outputs-runstate.int.test.ts + wait-event-esign.int + CR-121 notify-node/notify-vars + packs.module-registry.int. e2e journey-approval một lần.

## Quyết định trong lúc làm
- Dữ liệu kèm truyền trong bộ nhớ tới `finishWait` (cùng tx thả bước), không lưu ⇒ không migration; sự kiện tới TRƯỚC khi bước chờ bắt đầu chỉ ghi `event` (hiếm: ký/đối tác trả lời sau khi gửi).
- Đầu ra Ký số ghi ở stage chờ (stage cuối cụm — m8 chỉ tính đầu ra một lần ở đó); stage gửi chỉ thêm `envelope_id` vào kết quả tool (lọc theo khai báo output của stage).
- `signed_at` = ngày UTC của `completed_at` (kiểu `date` để Nếu/Hẹn giờ/mẫu dùng như ngày khác).
- `signer`/`sent_to` = tên hiển thị nối ", " (theo thứ tự ký / theo tên), cắt trần.
- Đọc phong bì lỗi ⇒ vẫn bắn sự kiện không dữ liệu kèm (rẽ nhánh không phụ thuộc phần phụ).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Bước chờ sự kiện ghi dữ liệu kèm sự kiện vào đầu ra của bước
Gói bắn sự kiện kèm dữ liệu (khoá snake_case, giá trị vô hướng); khi sự kiện đó thả bước chờ, dữ liệu vào đầu ra của bước trong cùng giao dịch, không ghi đè kết quả sự kiện, bắn lại không đổi gì; sự kiện khác thắng ⇒ không lẫn dữ liệu.
- Kịch bản: Ký số xong ⇒ bước chờ có thời điểm ký, người ký, mã phong bì; bắn lại không đổi; Thông báo sau đó hiện «Đã ký ngày {signed_at}» và ghi người nhận [test: tests/acceptance/CR-125/outputs-runstate.int.test.ts » Ký số xong ⇒ bước chờ có signed_at/signer/envelope_id; bắn lại không đổi; Thông báo sau đó dựng {signed_at} + ghi sent_to]
- Kịch bản: đối tác trả lại sửa ⇒ bước chờ có lần gửi + lý do; công ty khác bắn cùng bản ghi không thả [test: tests/acceptance/CR-125/outputs-runstate.int.test.ts » Gửi đối tác: trả lại sửa ⇒ bước chờ có round + partner_reason; dữ liệu của sự kiện khác không lẫn vào]
- Kịch bản: lọc dữ liệu kèm, chỉ áp cho sự kiện thắng [test: apps/hub-api/src/modules/processes/domain/timers/wait-event-data.rules.test.ts » đúng sự kiện thắng ⇒ gộp dữ liệu kèm, `event` không bị ghi đè]
- Kịch bản: phong bì trạng thái cuối ⇒ đầu ra Ký số [test: apps/hub-api/src/modules/packs/contracts/domain/esign-outputs.rules.test.ts » ký xong ⇒ envelope_id + signed_at (ngày) + người ký theo thứ tự ký]

#### Yêu cầu: Thông báo đọc đầu ra các bước trước
Mẫu `{khoá}` của Thông báo lấy giá trị từ đầu ra các bước đứng trước và dữ liệu của lượt; Thông báo ghi người nhận (`sent_to`) vào đầu ra của bước.
- Kịch bản: `{signed_at}` lấy từ đầu ra Ký số, input thắng khi trùng khoá [test: apps/hub-api/src/modules/processes/nodes/notify/notify-vars.test.ts » `{signed_at}` lấy từ đầu ra bước Ký số; bước sau đè bước trước; input thắng khi trùng]

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Cổng vào/ra đủ cho mọi node và tự nối từ bước trước
Mọi đầu ra đã khai đều được máy chủ ghi (không còn đầu ra chờ); Ký số cấp đủ bốn cổng làm nguồn tự nối cho bước sau.
- Kịch bản: không còn đầu ra pending [test: packages/contracts/src/modules/io-ports.test.ts » danh sách đầu ra CHƯA ghi (pending) — CR-125 m9: engine ghi hết ⇒ rỗng (node mới thêm pending thì ghi vào đây)]
- Kịch bản: nguồn tại Thông báo gồm đủ cổng Ký số một lần [test: packages/contracts/src/modules/io-ports.test.ts » nguồn tại Thông báo = Bắt đầu khi + Duyệt (khớp theo executor) + Ký số MỘT lần (stage chờ, đủ 4 cổng)]
- Kịch bản: binding thật khai đủ khoá [test: apps/hub-api/src/modules/packs/packs.modules-outputs.test.ts » Duyệt ghi decision/decided_by/feedback; Ký số, Gửi đối tác, Thông báo ghi đủ cổng (CR-125 m9)]

## Việc còn lại
- (tuỳ chọn) lưu dữ liệu kèm cho sự kiện tới sớm ⇒ cần cột payload ở `hub.process_run_events` (migration).
