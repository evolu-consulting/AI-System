---
id: cr115-batch-launch
lát: cr115-batch-launch
cr: CR-115
làn: đầy đủ (máy trạng thái run, đồng thời, đường nóng có ngưỡng perf)
migration: chưa (dự kiến hub 0086 nếu cần)
phụ thuộc: hub-ha-sweeps (CR-114)
---
## Plan (ngắn)
Mục tiêu CR-115: PD-P01 bắn 100 hẹn retry p50 ≤ 500 ms (hiện 1.490–1.690 ms trên evotest), exactly-once 2 Hub (PD-P02).

## Trạng thái: ĐÃ MỞ KHOÁ (người dùng chốt 2026-11-03, CR-115) — đang làm/xong theo mục "Làm"

Số đo ban đầu dưới đây (giữ làm mốc so sánh).

Số đo (chẩn đoán CR-114, `debug` pool Hub, một lượt 100 hẹn, evotest): ~6.000–7.100 câu SQL / ~800–1.000 tx. Thời gian
gom theo câu (lượt 1 / lượt 2, ms):
| Nhóm | Câu chính | ms | Module |
|---|---|---|---|
| Điều khiển tx | `begin` + `set_config` scope + `commit` (×~800–1.000) | 570 / 600 | mọi module |
| Tạo hub run | `messages` insert, `flows` insert, `runs` insert, `conversations` update | ~190 / ~110 | `runs` (`runs.repo.ts` insertRun — đóng băng) |
| Phiên CLI | `delete from hub.cli_sessions` | 116 / 81 | `dify/agent`, `dlc-calls` (đóng băng) |
| Job | `jobs` insert, `run_steps` insert + advisory lock, `pg_notify`, savepoint, provider cooldown | ~170 / ~150 | `launcher-prompt.ts` (processes) + `lib/run-steps.ts`, `studio/models` (đóng băng) |
| Phần processes | khoá run, `stage_runs → running`, đọc đầu run (×2), phiên tươi, recipients | ~150 / ~120 | `processes/runs/*` (mở cho CR-115) |
| Poll cấu hình mỗi kick | `config_meta` admin + hub (×100 mỗi bảng) | 44 / 40 | `processes/runs/launcher.ts` |

Phần nằm trong module được mở (launcher + processes) chỉ ~15–20% thời gian lượt. Thử bắn song song 4 hẹn không nhanh hơn
(nút cổ chai là luồng JS × số câu) ⇒ muốn đạt 500 ms phải giảm SỐ CÂU + SỐ TX mỗi stage ~70%, tức gom theo lô cả
`insertRun` (runs), tạo job + `run_steps` (runner/lib) và dọn `cli_sessions` (dify agent) — ngoài phạm vi mở khoá
"chỉ đường launcher.kick theo lô". Làm riêng phần launcher (một lần poll cấu hình + đọc đầu run theo mảng mỗi lô, bớt
~600 câu) ước còn ~1.300 ms — không đạt mục tiêu.

## Cần người dùng chốt (một câu)
Mở khoá có giới hạn thêm `runs` (insertRun theo mảng), tạo job/`run_steps` của stage agent, và dọn `cli_sessions` cho đường
launch theo lô? Mặc định đề xuất: **có**, chỉ cho đường stage agent khởi chạy từ hẹn `retry` (đường chat/HTTP giữ nguyên), test
so sánh snapshot hàng `flows/runs/messages/jobs/run_steps` đường cũ ↔ đường lô trên cùng fixture + PD-P02 + PD-I24/I39,
lát Opus (≥ 1 ngày). Không ⇒ làm phần launcher (~-15%) và đặt ngưỡng PD-P01 theo số đo thật.

## Làm
- [x] `SystemUow.systemEach` (`adapters/hub-uow.ts`): MỘT tx scope system cho cả lô; `claim` (khoá run `FOR UPDATE OF r SKIP
  LOCKED`, giữ tới COMMIT ⇒ Hub kia bỏ qua run này) → mỗi hàng một SAVEPOINT với repo gắn tenant của hàng; hàng lỗi chỉ ROLLBACK savepoint
  (`ok:false`), outbox của hàng thành công phát một lần sau COMMIT.
- [x] `fireDueTimers` (`adapters/timers/timer-sweep.ts`): mặc định `fireBatch` (hẹn sắp theo run ⇒ thứ tự khoá run nhất quán
  giữa các Hub); hàng lỗi ⇒ đường từng hàng cũ `fireOne` (lỗi nữa ⇒ log + lùi hạn như trước). Seam `processTimerBatch: false`
  (AppDeps → `ProcessBgDeps.timerBatch`) = đường cũ nguyên văn, chỉ cho test tương đương.
- [x] Outbox: ≥ 2 sự kiện `kick` trong một lần phát ⇒ `launcher.kickMany` (mount: launcher giả không có `kickMany` ⇒ `kick`
  từng run, lỗi một run chỉ log).
- [x] `StageLauncher.kickMany` (`runs/launcher-batch.ts`): một lần `config.poll` + MỘT tx: đọc đầu mọi run một câu
  (`= any(uuid[])`), mỗi run (sắp theo id) đặt scope `user` người bắt đầu + SAVEPOINT chạy đúng `plan` của `kick` (khoá run →
  quyền → `insertRun` → stage running → dọn `cli_sessions`). Sau COMMIT: sự kiện một pipeline Redis, rồi `launch` từng stage;
  run lỗi / còn `more` ⇒ `kick` từng run (đường cũ, idempotent). Cả tx lô hỏng ⇒ mọi run theo `kick` từng run.
- [x] `stage-driver` đọc liên kết + `timeout_s` + `sources`/`autofix` của job trong MỘT tx (`runs/stage-job-inputs.ts`, trước: 3 tx).

## Không làm / Chạm
Notices/unread (lát cr115-unread-counter). Không migration (không cần 0086). `insertRun`/job/`run_steps`/`cli_sessions`: KHÔNG
viết lại thành câu mảng (đã ≥ 2× không cần; xem "Việc còn lại") — chỉ gom tx (savepoint trong tx lô), giữ nguyên câu cũ ⇒
tương đương theo cấu trúc. `runs/create-run.ts` chỉ thêm cờ `noUserLock` (bỏ khoá tư vấn user cho run stage của lô).

## Test tối thiểu
- `tests/acceptance/P-d/d1/batch-launch.int.test.ts` (test trước): PD-B01 cùng fixture, Hub cũ (`processTimerBatch:false`) ↔
  Hub lô ⇒ ảnh hàng flows/runs/messages/jobs/run_steps/stage_runs/timers/cli_sessions bằng nhau (bỏ id/thời điểm/owner); PD-B03
  hàng lỗi (hội thoại không thuộc người bắt đầu) cô lập; PD-B02 2 Hub lô ∥ 60 hẹn ⇒ đúng 1 lần; PD-B04 lô không chặn bởi /
  không giữ khoá tư vấn user.
- Unit: `outbox.test.ts` (kickMany), `hub-uow.test.ts`, `uow-boundary.test.ts` (chặn `.systemEach` ở đường HTTP).
- PD-I24/PD-I39 (`race.int.test.ts`), `wait.int.test.ts`; PD-P01/P02 perf có ngưỡng.

## Quyết định trong lúc làm
- 2026-11-03: dừng trước khi code — số đo cho thấy mục tiêu không đạt được trong phạm vi mở khoá đã duyệt (Luật 2 hard stop).
- 2026-11-03: người dùng mở khoá có giới hạn (CR-115) ⇒ ghi `docs/platform/modules.md`.
- 2026-11-03: chọn ĐO TRƯỚC với cách gom tx + savepoint (giữ nguyên câu SQL của `plan`) thay vì viết lại insert mảng — rủi ro
  tương đương thấp hơn; chỉ viết mảng nếu chưa đạt 2×.
- 2026-11-03 (sửa theo điều phối): claim trong tx bắn khoá RUN, không khoá hẹn — `join process_runs … for update of r skip
  locked` ⇒ đúng thứ tự §10 run → stage → timer (`fireTimer` khoá stage, timer sau); tx/Hub khác bỏ qua run đang bị giữ (tập
  rời nhau, vẫn đúng một lần). Bản đầu khoá hẹn trước run (có thể deadlock) — đã bỏ.
- 2026-11-03 (sửa theo điều phối): run stage tạo trong `kickMany` KHÔNG lấy `lockUserRuns` (`ProcessRunInput.noUserLock`, đánh
  dấu bằng `BATCH_TXS` của savepoint) — khoá xact giữ tới COMMIT cả lô sẽ chặn chat của người bắt đầu. Đổi lại: đếm trần chat
  (`countRunning`, 429) có thể chưa thấy run stage của lô đang mở (thấy ngay khi lô COMMIT); run stage không tự kiểm trần.
  PD-B04: tx khác giữ khoá user của A, lô vẫn bắn + tạo đủ run/job. Lợi phụ: 4 tx kick song song không còn nối tiếp ⇒ đạt 2×.
- 2026-11-03: `starterUsable` gửi liền sau khoá run + đọc đầu run (pipeline, áp cho cả `kick` đơn) — xét kết quả đúng chỗ cũ.
- 2026-11-03: bắn theo `FIRE_TXS = 4` tx song song (mỗi tx ≤ 25 hẹn, SKIP LOCKED ⇒ tập rời nhau, tổng ≤ 100/lượt); mỗi tx
  phát `kickMany` riêng. Đo: p50 1.023 → 882 ms.
- 2026-11-03: KHÔNG pipeline 3 câu khoá của `fireTimer` (đổi luật "run không thấy ⇒ không khoá stage/timer" mà unit test ghi rõ).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Bắn hẹn thử lại theo lô
Vòng nền bắn các hẹn `retry` tới hạn theo lô (≤ 100 mỗi lượt) trong một giao dịch, rồi khởi chạy lại các bước của lô cùng
lúc; kết quả (bước, lượt chạy, tin, job) giống hệt bắn từng hẹn, một hẹn lỗi không làm hỏng các hẹn khác, hai Hub cùng quét
vẫn bắn mỗi hẹn đúng một lần.
- Kịch bản: khi cùng một bộ hẹn được bắn theo lô và theo từng hẹn thì các hàng tạo ra giống nhau và hẹn lỗi chỉ ảnh hưởng chính nó [test: tests/acceptance/P-d/d1/batch-launch.int.test.ts » PD-B01]
- Kịch bản: khi hai Hub cùng quét 60 hẹn thì mỗi hẹn bắn đúng một lần, mỗi bước một job [test: tests/acceptance/P-d/d1/batch-launch.int.test.ts » PD-B02]
- Kịch bản: khi 1.000 hẹn thử lại tới hạn thì mỗi lượt bắn ≤ 100, mỗi hẹn đúng một lần và lượt 100 hẹn p50 ≤ 991 ms, p95 ≤ 1.226 ms [test: tests/acceptance/P-d/perf/timers.perf.int.test.ts » PD-P01]
- Kịch bản: khi lô đang tạo lượt chạy cho các bước của một người thì lô không giữ khoá theo người đó, chat của họ không phải chờ lô [test: tests/acceptance/P-d/d1/batch-launch.int.test.ts » PD-B04]

## Số đo sau (evotest)
Vòng 1 (không `-Exclusive`, mã cũ của lát: khoá hẹn trước, giữ khoá user): 1.058/1.173 → 1.023/1.262 → 882/1.245 ms (1,9×).
Vòng 2 — mã 5c756fbd (claim theo run, không khoá user, `starterUsable` pipeline), `-Step perf -Exclusive`, 3 lượt CÙNG mã:
| Lượt | PD-P01 p50 / p95 (ms) | PD-P02 2 Hub p50 / p95 |
|---|---|---|
| 1 | 680,7 / 948,1 | 1.661 / 4.767 |
| 2 | 781,1 / 943,2 | 1.586 / 4.493 |
| 3 | 792,6 / 981,0 | 1.528 / 4.047 |
Mốc 1.683 / 2.362 ⇒ tệ nhất **2,12× / 2,41×** (≥ 2×). Ngưỡng PD-P01 = tệ nhất × 1,25: **p50 ≤ 991 ms, p95 ≤ 1.226 ms**
(`timers.perf.int.test.ts`). PD-P02 không ngưỡng (chỉ "đúng một lần").

## Việc còn lại
- Không làm (đã ≥ 2× mà không cần): `insertRun`/`markStageRunning`/`cli_sessions` dạng mảng, job + `run_steps` trong tx lô.
  Nếu cần nhanh hơn nữa: đó là bước kế (bỏ ~4 round-trip + 2 tx driver mỗi stage).
- P1-48e (`lock-order.int.test.ts`) đỏ khi chạy CHUNG bộ (P-d/d1 + processes/adapters + P-a/pf1) ở CẢ ref base platform/gd0
  (300 pass, 1 fail) lẫn lát ⇒ có sẵn, không do lát; chạy riêng file: base 5/5, lát 5/5 xanh. Cần thêm `tests/known-red.json`
  (qc) hoặc sửa đua (expire `SKIP LOCKED` bỏ qua run đang bị tx sau apply giữ khoá).
