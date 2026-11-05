---
id: kr-int-py
lát: kr-int-py
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Dọn đỏ cũ suite `int`/`py` của `tests/known-red.json` (hạn 2026-11-17), trừ P-c/tenant T03b (Bun flake, để nguyên).

## Làm
- Đã xanh trên evotest ⇒ chỉ gỡ entry: `test_confirm.py::test_hub_fr_95_model_need_input_kept`, `result_int_test.py::test_wrk_fr_27_partial_need_input` (5bebcb10), P-a/pf1 `lock-order` P1-48d/e.
- `migrate-hub.int.test.ts`: HUB_TABLES thiếu 8 bảng (artifacts/artifact_runs hub 0084; process_def_releases, process_routing_rules, process_routings, process_slot_assignments, process_slots, process_tenant_defs hub 0068/0087) ⇒ test cũ, thêm vào danh sách (cùng độ mạnh: so khớp danh sách đầy đủ).
- `result_int_test.py::test_wrk_fr_03_event_sequence`: LỖI APP thật — `encode_event` chỉ bỏ `outputs` khi None, còn `source_reads: null` lọt vào `job.result`; zod `RunEvent` của Hub khai `source_reads` là `.optional()` (không nullable) ⇒ Hub từ chối. Sửa `events/stream.py` bỏ cả hai khoá khi None (cùng họ lỗi 5bebcb10); test cũ giữ nguyên + `test_stream.py` thêm unit.
- chat-gate.int: 12/12 test xanh; hook `(unnamed)` = `afterAll` → `hub.stop()` treo ở `server.stop(true)` (Bun 1.3.14) sau test cuối POST tin vào dock (luồng SSE run, client chỉ cancel thân); mọi kết nối PG đã idle. Giảm nhẹ: teardown chặn ≤ 5 s.
- V2-G perf: test thời gian p95 tách sang `tests/acceptance/V2-G/perf/review.perf.int.test.ts` (bộ perf, làm nóng 3 lượt); `perf.int.test.ts` giữ test đếm câu SQL.

## Không làm / Chạm
Chỉ đổi `agent_runtime/events/stream.py` (encode_event). Không chạm lock-order/máy trạng thái run.

## Test tối thiểu
evotest: migrate-hub 7/7, chat-gate, test_confirm.py 8/8, result_int_test.py, lock-order 5/5 (int); perf V2-G (perf).

## Quyết định trong lúc làm
- Số đo Lưu 200 dòng + 50 mốc (slot thường, nice 19): chạy riêng ~225–258 ms/lượt, song song nhiều lượt khác 423 ms (p95). Planning 110 ms + Execution 77 ms của câu CTE ②; trigger hàng `obligations_doc_frame` 18 ms + `obligations_v2e_cell` 19 ms (50 lần), `contract_items_v2j1_ins/upd` 13+15 ms. Tối ưu thật (trigger theo hàng → theo câu, giảm planning) cần lát riêng; chưa đo `-Exclusive` (cấm trong lát này).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/runtime-events.md
#### Yêu cầu: job.result không mang khoá null tuỳ chọn
Sự kiện `job.result` chỉ có `outputs` / `source_reads` khi có giá trị; không bao giờ dump `null` (Hub zod `.optional()`).
- Kịch bản: khi job không đọc nguồn thì `job.result` không có khoá `source_reads` [test: apps/agent-runtime/src/agent_runtime/events/test_stream.py » test_wrk_fr_18_result_source_reads_key_only_when_present]

## Việc còn lại
- Chạy `-Step perf -Exclusive` cho `tests/acceptance/V2-G/perf/review.perf.int.test.ts` (điều phối); nếu p95 > 250 ms ⇒ lát tối ưu trigger/planning của Lưu.
- chat-gate: gốc treo `server.stop(true)` sau luồng SSE gửi-tin (vòng đời stream/run) — Opus.