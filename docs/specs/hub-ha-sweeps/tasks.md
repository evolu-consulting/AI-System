---
id: hub-ha-sweeps
lát: hub-ha-sweeps
cr: CR-114
làn: đầy đủ (đường nóng có ngưỡng perf, khoá/đồng thời)
migration: hub 0082 (chỉ index)
phụ thuộc:
---
## Plan (ngắn)
Mục tiêu: hub-api chạy ≥ 2 instance an toàn; vòng nhắc / hết hạn / bắn hẹn của engine quy trình đạt ngưỡng perf (Luật 4c).
1. Kiểm kê mọi vòng nền của `apps/hub-api` (bảng dưới): vòng singleton toàn cục ⇒ khoá advisory; việc theo hàng ⇒ claim
   `FOR UPDATE SKIP LOCKED` / ghi có điều kiện.
2. TD #190 (nhắc trùng ≥ 2 Hub): test int 2 Hub (PD-P10) chạy trên evotest, ghi trạng thái.
3. Perf nhắc / hết hạn / hẹn giờ (TD #254, #196): đo trên evotest, sửa chỗ chậm, báo số thật.
4. TECH-DEBT #190/#254/#196.

### Kiểm kê vòng nền (an toàn 2 Hub?)
| Vòng | File | Nhịp | Cơ chế nhiều instance | Kết luận |
|---|---|---|---|---|
| process-sweep (hẹn giờ → hết hạn → interrupted → resolve → Áp → orphan) | `processes/runs/sweeps.ts` | 3 s | hẹn: SKIP LOCKED + `fireTimer` khoá run/stage/timer và kiểm lại; hết hạn: CTE `FOR UPDATE SKIP LOCKED`; interrupted/Áp/resolve: re-khoá run trong tx, idempotent; orphan: `kick` idempotent | an toàn (PD-I24, PD-I39d, PD-P02) |
| process-remind (nhắc + chuyển cấp) | `processes/notify/reminder.ts` → `remind-tasks.usecase.ts` | 300 s | claim task `FOR UPDATE OF t SKIP LOCKED` + run `FOR KEY SHARE SKIP LOCKED`, ghi trong cùng tx lô | an toàn (PD-P10, TD #190) |
| thread-poster | `processes/core/thread-poster.ts` | reconcile | khoá run `FOR SHARE`, chèn tin `id = event.id` (idempotent) | an toàn |
| attachments sweeper | `attachments/sweeper.ts` | — | `pg_try_advisory_xact_lock('hub.attach.sweep')` (bận ⇒ bỏ lượt) | singleton qua advisory |
| ops-watch | `ops/ops.mount.ts`, `ops.repo.ts` | 60 s | `pg_advisory_xact_lock('hub.ops_watch')` + so `last_round_at` | singleton qua advisory |
| notify dispatcher | `notify/notify.mount.ts`, `dispatch.repo.ts` | — | fanout + delivery `FOR UPDATE SKIP LOCKED` + hạn thuê `sending` | an toàn |
| kh writer | `kh/kh.writer.ts` | 10 s | claim lô có lease 60 s | an toàn |
| orphan sweep job | `runner/orphan-sweep.ts` | 10 s | update có điều kiện, chỉ một bên nhận dòng | an toàn |
| run lease / lease sweeper | `runs/close/lease.ts`, `sweeper.ts` | 10 s | lease theo instance; chiếm `owner` có điều kiện (P12) | thiết kế cho nhiều instance (H1 lease.int) |
| room-post reconcile | `rooms/agents/room-post.ts` | 5 s | definer idempotent (`runs.room_posted_at`) | an toàn |
| HĐ nhắc hạn (HD4) | `packs/contracts/reminders.mount.ts`, `reminders.repo.ts` | — | `for no key update … skip locked` | an toàn |
| HĐ quá hạn sổ (HD7) | `ledger.mount.ts`, `overdue.repo.ts` | 1 h | `FOR UPDATE SKIP LOCKED` + `overdue_for` | an toàn |
| dò giá | `price-scout.mount.ts`, `price-scout-schedule.repo.ts` | — | `FOR UPDATE OF c SKIP LOCKED` + `lease_until` | an toàn |
| uy tín chốt tháng | `reputation.mount.ts`, `rep-lock-sweep.ts` | 6 h | ghi `on conflict` (kỳ chốt không tính lại) | an toàn (lượt thừa chỉ đọc) |
| duyệt / ký số / Community | `approval-sweep.ts`, `esign-sweep.ts`, `community/adapters/notify.sweep.ts` | — | `SKIP LOCKED` + ghi có điều kiện | an toàn |
| config poll, me-stream ping, SSE ping, extract stream | — | — | theo instance / theo kết nối, không ghi chung | không cần |

## Làm
- [x] Kiểm kê vòng nền (bảng trên): không vòng nào cần sửa để chạy 2 Hub — singleton đã có khoá advisory theo tx, việc theo
  hàng đã claim `SKIP LOCKED` / ghi có điều kiện / idempotent.
- [x] TD #190: đã sửa từ P-d (claim SKIP LOCKED trong tx lô); chạy lại test 2 Hub trên evotest (HEAD a4a95d93): PD-P10,
  PD-P11, PD-P15 ×2, PD-I24, PD-I39a–d xanh (9/9). TECH-DEBT #190 → đóng.
- [x] Đo perf thật trên evotest (`-Step perf`): PD-P13 nhắc lô 100 p95 86 ms (p50 68), 10k task 5.179 ms; PD-P14 hết hạn
  lô 100 p95 58 ms (p50 38), 20k run 11.978 ms; PD-P01 hẹn giờ lô 100 p50 1.594 / p95 2.302 ms; PD-P02 2 hub p95 5.610 ms.
- [x] TECH-DEBT #196, #254: ghi số đo mới, vẫn mở.
- [x] Lượt 2: (a) `tests/acceptance/P-a/pf1/_local.ts` `stop()` chờ `handles.settled()` trước khi đóng pool ⇒ hết
  "Unhandled error between tests" (int 3 file exit 0). (b) EXPLAIN (ANALYZE, BUFFERS) từng câu trên dữ liệu PD-P13/P14
  (test chẩn đoán tạm, không commit): `markRemindedMany` quét MỌI task `open` + tính lại `jsonb_to_recordset` mỗi hàng
  (7 → 66 ms theo vòng) ⇒ CTE `materialized` + `id = any((select ids from x)::uuid[])` (tra PK); claim hết hạn Bitmap Heap
  Scan đọc 24.300 entry chết (4.840 trang) ⇒ migration 0082 index `(hạn, id)` cho Index Scan + Limit, bỏ index thừa
  `review_tasks_remind_idx`.

## Không làm / Chạm
- Không thêm leader-election khoá phiên (`pg_try_advisory_lock` giữ theo kết nối): mọi singleton hiện có đã dùng khoá theo tx
  (tự nhả khi commit/rollback, không kẹt khi tiến trình chết) — tương đương "tự bầu lại" mà không cần kết nối riêng.

## Test tối thiểu
Không thêm test (đã có): `tests/acceptance/P-d/d1/{remind-load,race,batch-queries}.int.test.ts`,
`tests/acceptance/P-d/perf/{background,timers}.perf.int.test.ts`.

## Quyết định trong lúc làm
- Vòng singleton dùng `pg_[try_]advisory_xact_lock` thay khoá phiên (lý do ở trên).
- Không sửa code đường nhắc/hết hạn/hẹn giờ trong timebox 45': số đo cho thấy chi phí lô đã ~50 ms (p50) và dao động theo
  lượt — cần hồ sơ từng câu (EXPLAIN ANALYZE trên dữ liệu PD-P13/P14) trước khi đổi; hẹn giờ cần gom bắn `fireTimer` (máy
  trạng thái, Opus). Ghi số thật vào TECH-DEBT #196/#254.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đổi kế hoạch truy vấn — câu cập nhật cùng tập hàng, index mới thay index cũ cùng tên —
và hạ tầng test; kiểm kê + số đo).

## Việc còn lại
- PD-P13/PD-P14 vẫn trên p95 ≤ 50 ms trên evotest (số ở TECH-DEBT #254) — không còn tăng theo vòng, phần còn lại là chi phí
  cố định mỗi lô + nhiễu máy chủ chung: notice 200 hàng ~18 ms (2 FK trigger ~10 ms), claim nhắc ~13 ms (cổng trưởng phòng
  tra `users` mỗi hàng ~6 ms, `more` anti-join ~4 ms), commit 4–11 ms (fsync). PD-P14 theo test-plan-addendum đo CẢ
  `sweepOnce` (giữ). Đếm unread (`count` notice chưa đọc của người nhận) vẫn tăng tuyến tính theo số chưa đọc — muốn hết
  phải có bộ đếm (đổi contract/bảng), ngoài lát.
- **Đề xuất TD #196 (hẹn giờ theo lô) — chưa làm:** `fireTimer` mỗi hẹn một tx (khoá run → stage → timer, 5–6 câu) rồi
  `kick` launcher SAU COMMIT; PD-P01 ~16 ms/hẹn. Gom: một tx `systemBatch` mỗi lô — (1) CTE khoá timer tới hạn
  `SKIP LOCKED` + run `FOR UPDATE SKIP LOCKED` + stage theo `any(array)`, (2) `fireAction` lớp 1 trên mảng, (3) một câu
  `update … from jsonb_to_recordset` cho từng nhóm hành động (markFired / requeue stage / finishWait / cancel), (4) outbox
  `kick` gom mỗi run. Exactly-once giữ nhờ khoá run+timer trong cùng tx (như nhắc). Cần đo trước phần `kick` (launcher tạo
  job) — nếu chiếm phần lớn 16 ms thì gom tx không đủ. Đổi máy trạng thái ⇒ Opus, lát riêng, test PD-I24/PD-I39/PD-P02.
