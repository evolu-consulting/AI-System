---
id: cr116-probe
lát: cr116-probe
cr: CR-116
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Công cụ đo, không đổi hành vi sản phẩm: ghi MỘT lần baseline (evotest `-Exclusive`), đặt probe ở điểm nóng, mọi thay đổi / phương án A/B
chạy lại đúng kịch bản và so với baseline đã lưu (`perf/baseline/<kịch bản>.json`) thay vì đo rời rạc.
- Probe (tắt mặc định, bật `PERF_PROBE=1`): TS `packages/db/src/probe.ts` (export `@ai/db/probe`; tap SQL gắn vào `createDb`), Python
  `agent_runtime/probe.py` (`ProbeConnection` gắn vào `create_pool`). Dòng kv `t= e=probe.<tên> ms= cpu= rss= sql= rt=`.
- Runner `bun run perf:probe|perf:baseline|perf:compare` (`tools/scripts/src/perf-probe*.ts`) gọi `run-tests.ps1 -Step perf|py -Exclusive -Probe`.
- Kịch bản: `timer.fire` (PD-P01) · `remind` (PD-P13) · `expire` (PD-P14) · `chat.first-delta` (PF3, LLM giả) · `contracts.read` (HD-NFR-01)
  ở `tests/perf-probe/`; `claim.n` ở `apps/agent-runtime/tests/perf_probe/`. Fixture dùng lại của các perf test gốc.

## Làm
- [x] Probe TS + tap SQL + unit (tắt ⇒ không ghi, micro-bench overhead).
- [x] Probe Python + unit; điểm đo: `timer.fire`, `expire.runs`, `remind.once`, `contracts.list|detail`, `claim.one`.
- [x] Runner + luật thuần (gom p50/p95/mean, spread, so sánh, bảng ≤ 15 dòng) + unit.
- [x] Glue evotest: `-Probe`, `-Exclusive` cho `-Step py`, `EVO_PROBE` → `PERF_PROBE`/`PERF_PROBE_OPTS`.
- [x] Docs `docs/WORKFLOW.md` "Đo perf: baseline + probe + compare".
- [x] Baseline ban đầu `perf/baseline/*.json` (6 kịch bản, small, 3 lượt, `-Exclusive`, pg 16.15; 5 kịch bản TS đo ở 271b8456, `claim.n` ở 0cb230ca).

## Không làm / Chạm
Không đổi hành vi prod: các điểm đo chỉ bọc lời gọi hiện có (`probe(name, fn)` = `fn()` khi tắt). Chạm: `packages/db/src/client.ts`
(thêm `debug` chỉ khi bật), `sweeps.ts`, `reminder.ts`, `list-contracts.usecase.ts`, `get-contract.usecase.ts`, `jobs_sql.py`, `pool.py`,
`deploy/evotest/*`. Không đổi test khoá (`tests/acceptance`).

## Test tối thiểu
Unit: `packages/db/src/probe.test.ts`, `tools/scripts/src/perf-probe.rules.test.ts`, `apps/agent-runtime/src/agent_runtime/test_probe.py`.
Kịch bản là perf test (chạy bằng runner, ngoài `test:int`/`test:perf` vì `describe.skipIf(!PERF_PROBE)`).

## Quyết định trong lúc làm
- `rt` (round trip) = số đợt câu gửi theo từng kết nối trong cùng một lượt event-loop (postgres.js không có hook "xong câu"); câu pipeline
  cùng kết nối cùng tick tính 1. Python: mỗi lời gọi asyncpg = 1 (không pipeline).
- cpu/rss/sql/rt là số toàn tiến trình trong khoảng probe ⇒ kịch bản chạy tuần tự.
- Noise guard: cần ≥ 3 lượt mỗi bên; Δ p50 > 10% chỉ đỏ khi vượt spread (max-min của p50 theo lượt / trung vị) của hai bên; số câu SQL tăng
  > 10% luôn đỏ (tất định).
- Mọi kịch bản `perf` gộp một lượt evotest (một khoá `-Exclusive`); `py` một lượt riêng.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: công cụ đo — probe tắt mặc định, bật bằng PERF_PROBE=1 chỉ ghi dòng log, không đổi kết quả nghiệp vụ)

## Việc còn lại
- Giới hạn đã biết: sql/rt/cpu/rss là số toàn tiến trình ⇒ probe lồng nhau hoặc việc nền (kick launcher sau commit) làm `sql` của `expire.runs`/`timer.fire` trong kịch bản `timer.fire` cao hơn thực tế; so sánh vẫn hợp lệ vì cùng kịch bản (có `sqlSpread` chặn nhiễu).
- CR-116 A/B: phương án = cùng kịch bản, `bun run perf:compare --scenario <tên>`.
