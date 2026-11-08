---
id: cr116-apply-hub
lát: cr116-apply-hub
cr: CR-116
làn: đầy đủ (B3 chạm hàm SECURITY DEFINER / cách ly tenant); B1, B5 làn nhanh
migration: 0088_cr116_hub_hot_paths (journal when 1803400000000)
phụ thuộc: cr116-bench-hub (số đo), cr116-probe (perf:probe/perf:compare)
---
## Plan (ngắn)
Pha 2 CR-116: áp đúng các biến thể đã thắng trong `docs/specs/cr116-bench-hub/tasks.md` "## Số đo" — B1, B3, B5. Không B4
(bắn hẹn CTE: lợi thật nhỏ, rủi ro máy trạng thái cao), không bảng đếm chưa đọc (B6), không B2.
1. B1 · migration 0088: index `hub.review_tasks (stage_run_id, tenant_id)` + `hub.runs (stage_run_id, tenant_id, started_at)`
   — đúng biến thể "+index cả 2 bảng" (EXPLAIN 100k: 7.258 → 15 buffers).
2. B3 · hàm definer theo tập `hub.process_runs_recipients(uuid[], uuid[])` (thân + cách ly như 0020, câu lateral của bench);
   `core.runRecipientsMany`; lô hẹn giờ (`systemEach`) ghi chỗ chờ người nhận theo đúng vị trí trong outbox, điền MỘT câu cuối
   tx lô. Test viết TRƯỚC: giống hệt definer cũ (2 tenant × 5 dạng run × 3 scope), cách ly tenant, đếm câu N → 1.
3. B5 · `stage-driver.lockAndLoad`: khoá + đầu run + `pinned_sources` một câu (`lockHead`), nguồn stage dựng từ hàng đó
   (`stageSourceCtxOf`) — trước: đọc đầu → khoá → đọc lại → đọc nguồn (4 câu PK).

## Làm
- [x] [test] `apps/hub-api/src/modules/processes/core/run-recipients.int.test.ts` (viết trước code B3/B5).
- [x] `packages/db/migrations-hub/0088_cr116_hub_hot_paths.sql` + journal.
- [x] `core/core.repo.ts` `runRecipientsMany`, `core/recipients-defer.ts`, `adapters/timers/stage-timer.repo.ts`, `adapters/hub-uow.ts`.
- [x] `runs/stage-driver.ts` `lockHead`/`lockAndLoad`, `runs/stage-sources.ts` `stageSourceCtxOf`.
- [x] `docs/platform/modules.md`: ghi mở khoá có giới hạn CR-116.

## Không làm / Chạm
- Không B4, B2, B6; không đổi `hub.process_run_recipients` (0020) — đường từng hàng (chat/gates/launcher) giữ nguyên.
- Không đổi hành vi bên ngoài: cùng người nhận, cùng thứ tự sự kiện, cùng khoá.

## Test tối thiểu
`deploy/evotest/run-tests.ps1 -Step int -Filter "<file mới> + hub-uow.int + P-d/d1 batch-queries/race/isolation + P-a/pf1/stage.int"`;
perf: `bun run perf:probe` + `perf:compare` (timer.fire, remind, expire, chat.first-delta) `-Step perf -Exclusive` × 3.

## Quyết định trong lúc làm
- B3 chỉ gom ở lô `systemEach` (vòng hẹn giờ — nơi có 100 lời gọi/lô). Người nhận = trạng thái CUỐI tx lô (trạng thái được
  COMMIT và phát), không phải lúc từng hẹn; khác biệt chỉ khi 2 hẹn của cùng run trong một lô đổi task mở — hẹn không mở/đóng task.
- Câu theo tập phải chạy trong hàm SECURITY DEFINER (nhánh `room_members` cần bỏ RLS như 0020); bench chạy bằng owner.
- B1: index `runs` một phần `stage_run_id is not null` (run chat không có stage — không phải ghi index).
- B5: khoá run bằng một câu `for update` theo `id` (trước: đọc đầu không khoá lấy `tenant_id` rồi khoá theo `(id, tenant)` —
  cùng hàng); khoá vẫn là câu đầu chạm `process_runs` của tx (§10).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Người nhận cập nhật lượt chạy theo lô
Khi vòng nền bắn một lô hẹn giờ, người nhận thông báo cập nhật lượt chạy (người bắt đầu, thành viên còn trong phòng nguồn,
người được giao và thành viên nhóm của việc đang mở) được tính một lần cho cả lô, giống hệt cách tính từng lượt chạy, và
không bao giờ lộ người của tenant khác.
- Kịch bản: khi tính người nhận cho nhiều lượt chạy của hai tenant theo lô thì kết quả giống hệt tính từng lượt ở mọi phạm vi [test: apps/hub-api/src/modules/processes/core/run-recipients.int.test.ts » giống hệt definer từng run: 2 tenant × 5 dạng run, scope system / user A / user B]
- Kịch bản: khi hỏi người nhận với tenant lệch, người của tenant khác hoặc không có phạm vi thì không trả ai [test: apps/hub-api/src/modules/processes/core/run-recipients.int.test.ts » cách ly tenant: cặp (run, tenant lệch), user tenant khác, không scope ⇒ rỗng]
- Kịch bản: khi một lô có nhiều lượt chạy thì chỉ một câu truy vấn người nhận cho cả lô [test: apps/hub-api/src/modules/processes/core/run-recipients.int.test.ts » số câu người nhận mỗi lô: N câu (definer từng run) → 1 câu, lô rỗng 0 câu]
- Kịch bản: khi bắn lô hẹn thử lại thì thông báo phát ra giống hệt bắn từng hẹn [test: apps/hub-api/src/modules/processes/core/run-recipients.int.test.ts » systemEach hẹn giờ (requeue): cùng sự kiện như đường từng hàng, 1 câu người nhận cho cả lô]
#### Yêu cầu: Đọc đầu lượt chạy một lần mỗi bước
Khi một bước của lượt chạy xong, engine khoá lượt chạy và đọc thông tin lượt chạy cùng nguồn đã ghim trong một lần đọc,
kết quả như đọc riêng từng phần.
- Kịch bản: khi bước xong thì thông tin lượt chạy và nguồn của bước giống đọc riêng, chỉ một câu đọc và lượt chạy bị khoá [test: apps/hub-api/src/modules/processes/core/run-recipients.int.test.ts » lockHead + stageSourceCtxOf = headOf + loadStageSourceCtx (mọi idx, có/không ghim), 1 câu thay 4, giữ khoá]

## Việc còn lại
- B4 (bắn hẹn CTE) và B6 (bảng đếm chưa đọc): không làm theo quyết định của người dùng.
