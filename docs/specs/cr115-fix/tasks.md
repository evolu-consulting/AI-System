---
id: cr115-fix
lát: cr115-fix
cr: CR-115
làn: đầy đủ (khoá/tx/máy trạng thái run, đường nóng có ngưỡng PD-P01)
migration: không
phụ thuộc: cr115-batch-launch
---
## Plan (ngắn)
Sửa lỗi review cuối đợt của lô bắn hẹn `retry` + `kickMany` (`docs/specs/cr115-batch-launch/tasks.md`). Test trước (đỏ ở
31b2e328), rồi sửa.

## Làm
- [x] TB1 · test: savepoint `systemEach` lỗi sau khi đã ghi ⇒ ghi hoàn lại, sự kiện của hàng bỏ, `fireOne` bắn đúng 1 lần;
  40001 chạy lại ⇒ chỉ sự kiện lần sau; tenant sai ⇒ `ok:false`, fn không chạy (`hub-uow.int.test.ts`, PD-B05).
- [x] TB2 · `planAs` AWAIT `set_config` scope user TRƯỚC `plan` (bỏ pipeline); mọi `skip` trong lô ⇒ `kick` lẻ sau COMMIT.
- [x] TB3 · `kickMany` khoá + đọc đầu mọi run MỘT câu `FOR UPDATE SKIP LOCKED` trước mọi khoá hội thoại/stage; run không khoá
  được ⇒ `kick` lẻ sau COMMIT (chờ khoá ngoài tx lô) ⇒ không chu trình run↔hội thoại.
- [x] Thấp1 · `publish(events, {kickMany})`: chỉ `systemEach` (vòng hẹn giờ) gom kick thành `kickMany`; phát khác giữ đường
  và thứ tự cũ.
- [x] Thấp2 · cả tx `systemEach` ném sau `claim` ⇒ từng hẹn đã chọn đi `fireOne` (lỗi nữa ⇒ lùi hạn từng hẹn).
- [x] Thấp3 · tx lô ném: dò `hub.runs` của các hàng `launch` (kết quả lần chạy cuối); thấy ⇒ đã COMMIT ⇒ launch tiếp theo
  kết quả lô; không thấy ⇒ `kick` từng run.
- [x] `ProcessHandles.kickMany` (seam test).

## Không làm / Chạm
`launcher-batch.ts`, `hub-uow.ts`, `outbox.ts`, `timer-sweep.ts`, `core/handles.ts`, `processes.mount.ts`. Không migration.

## Test tối thiểu
`tests/acceptance/P-d/d1/batch-launch-fix.int.test.ts` (PD-B05..B08), `hub-uow.int.test.ts` (systemEach), unit
`outbox.test.ts`, `timer-sweep.batch.test.ts`; hồi quy P-d/d1 + processes/adapters + P-a/pf1 + P-a/pf2; PD-P01 3 lượt
`-Exclusive`.

## Quyết định trong lúc làm
- 2026-11-03: TB3 chọn khoá run `SKIP LOCKED` một câu đầu tx (gộp với đọc đầu run ⇒ không thêm câu) thay vì dời
  `touchConversation` (nằm trong `insertRun`, module `runs` đóng băng).
- 2026-11-03: TB2 chọn `await` câu scope (thêm 1 round-trip/run) thay vì gộp scope vào câu khoá (`core.lockRun` dùng chung).
- 2026-11-03: PD-B07 giả lập tx "giữ run B rồi cần hội thoại A" (dạng huỷ/trả lời PF2) bằng SQL trực tiếp, không dựng
  luồng chat/PF2 thật; tx test đặt `deadlock_timeout` 50 ms để CHÍNH nó nhận 40P01 nếu có chu trình.
- 2026-11-03: Thấp2 — COMMIT lô thành công mà client thấy lỗi ⇒ `fireOne` thấy hẹn đã bắn (`skipped`), kick của lô không
  phát; stage `queued` chờ quét mồ côi (`requeueOrphans`). Chấp nhận (hiếm, không mất trạng thái).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Bắn hẹn thử lại theo lô
Lô bắn hẹn `retry` không làm mất hay lặp lần chạy khi một hẹn lỗi giữa chừng, khi lô có nhiều người/tenant, khi tx khác
đang giữ quy trình, hoặc khi lỗi mạng xảy ra sau lúc ghi xong; chỉ vòng hẹn giờ gom kick theo lô, mọi đường khác giữ như cũ.
- Kịch bản: khi một hẹn trong lô lỗi sau khi đã đánh dấu bắn thì đánh dấu được hoàn lại và hẹn được bắn lại đúng một lần [test: tests/acceptance/P-d/d1/batch-launch-fix.int.test.ts » PD-B05]
- Kịch bản: khi một lô có quy trình của 2 tenant × 2 người xen kẽ thì mỗi bước chạy dưới đúng người bắt đầu và đủ job [test: tests/acceptance/P-d/d1/batch-launch-fix.int.test.ts » PD-B06]
- Kịch bản: khi tx khác giữ quy trình B rồi cần hội thoại A trong lúc lô kick A và B thì không có deadlock và mỗi bước chạy đúng một lần [test: tests/acceptance/P-d/d1/batch-launch-fix.int.test.ts » PD-B07]
- Kịch bản: khi lô đã ghi xong nhưng Hub nhận lỗi kết nối thì các bước đã tạo lượt chạy vẫn được khởi chạy, không trùng [test: tests/acceptance/P-d/d1/batch-launch-fix.int.test.ts » PD-B08]
- Kịch bản: khi một lần phát không phải của vòng hẹn giờ có nhiều kick thì kick từng quy trình theo đúng thứ tự cũ [test: apps/hub-api/src/modules/processes/adapters/outbox.test.ts » Thấp1]
- Kịch bản: khi cả giao dịch lô lỗi sau khi đã chọn hẹn thì từng hẹn được bắn lại riêng, lỗi nữa thì lùi hạn từng hẹn [test: apps/hub-api/src/modules/processes/adapters/timers/timer-sweep.batch.test.ts » Thấp2]

## Số đo sau (evotest)
PD-P01 (mã f0e625ed, `-Step perf -Exclusive`, 1 lượt theo điều phối): p50 548,0 / p95 663,6 ms (ngưỡng 991 / 1.226) — đạt.
Đỏ trước sửa (31b2e328): systemEach TB1, PD-B07 (40P01 trên `conversations`), PD-B08; PD-B05/B06 xanh cả trước (B06 là đua,
không tái hiện ổn định). Sau sửa: P-d/d1 + processes/adapters + P-a/pf1 + P-a/pf2 351 pass / 0 fail.

## Việc còn lại
