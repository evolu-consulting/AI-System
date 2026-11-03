---
id: hub-binary-wire
lát: hub-binary-wire
cr: CR-114
làn: nhanh
migration: không
phụ thuộc: không
---
## Plan (ngắn)
Nguyên tắc người dùng: tối ưu toàn bộ code, nhị phân/vector CHỈ khi đo thấy lợi; chữ LLM đọc giữ text. Phần A đo JSON vs msgpack trên
các đường service-to-service không qua LLM, quyết từng đường theo luật "≥ 30% byte VÀ có lợi CPU/độ trễ đo được trên đường nóng".
Phần B thêm `-Step py` cho evotest (pytest agent-runtime trên Linux) thay container dựng tay.

## Làm
A. Đo (không đoán): `apps/hub-api/scripts/wire-bench.ts` (JSON vs msgpackr 1.11.14, `useRecords:false` để Python đọc được; Bun 1.4.3) +
   Python (pydantic `model_dump_json`/`model_validate_json` vs `msgpack` 1.2.4, Python 3.14 venv tạm) + độ trễ burst trên evotest
   (`apps/hub-api/src/modules/runner/run-stream-wire.perf.int.test.ts`, giữ lại làm vạch nền độ trễ delta JSON, ngưỡng p95 ≤ 150 ms).
B. `deploy/evotest/run-tests.ps1 -Step py [-Filter …]` + `Dockerfile` target `py` + service `runner-py` (profile `py`) + nhánh `py` trong
   `in-container.sh`/`remote.sh`; quarantine known-red suite `py` (`tools/scripts/src/pytest-reds.ts`, `pytestReds` + test); WORKFLOW.md + README evotest.

## Số đo (Phần A)
Byte / CPU mỗi sự kiện, Bun (ns/op; dec+zod = `JSON.parse|unpack` rồi `RunEventSchema.safeParse` — đường thật của `RunStreamReader`):

| mẫu | đường | JSON B | msgpack B | giảm byte | enc JSON | enc mp | dec JSON | dec mp | dec+zod JSON | dec+zod mp |
|---|---|---|---|---|---|---|---|---|---|---|
| job.delta 200ch (flush mặc định) | run:<id> | 411 | 391 | 4,9% | 859 | 1106 | 378 | 3038 | 1886 | 4875 |
| job.delta 1000ch | run:<id> | 1465 | 1445 | 1,4% | 1405 | 1779 | 1103 | 5332 | 3938 | 7057 |
| job.delta 4000ch (trần) | run:<id> | 5417 | 5397 | 0,4% | 16917 | 4692 | 3404 | 16055 | 10868 | 18646 |
| job.progress | run:<id> | 189 | 168 | 11,1% | 730 | 1281 | 388 | 2300 | 2803 | 5044 |
| job.started | run:<id> | 187 | 165 | 11,8% | 299 | 1158 | 373 | 2032 | 3947 | 5770 |
| job.result (text 3000ch) | run:<id> | 4186 | 4149 | 0,9% | 14936 | 5515 | 3207 | 15777 | 9226 | 17249 |
| ustream message (~600B) | ustream:<uid> | 666 | 634 | 4,8% | 1106 | 2234 | 1056 | 4496 | - | - |
| pg_notify job_enqueued | NOTIFY | 90 | 82 | 8,9% | 152 | 651 | 189 | 778 | - | - |
| hub.jobs.payload (prompt 2KB) | hub.jobs.payload | 2836 | 2812 | 0,8% | 10310 | 3765 | 2202 | 8510 | - | - |

Phía Python (Runtime, ghi XADD / đọc), ns/op, `job.delta`: 200ch enc JSON 3193 / mp 3801, dec JSON 3186 / mp 3910 (byte 411 → 389);
1000ch enc 6592 / 4934, dec 9009 / 8018; 4000ch enc 19589 / 6119, dec 26397 / 19836 (byte 5417 → 5395).
Độ trễ delta JSON hiện tại, evotest 1.000 `job.delta` 200ch XADD → `RunStreamReader.push` (gồm JSON.parse + zod): tuần tự (như DeltaPump)
p50 0,13 ms · p95 0,46 ms · max 10,6 ms; burst một pipeline p50 19,9 ms · p95 24,2 ms · max 24,5 ms (ngân sách 150 ms).

## Quyết định trong lúc làm
**Luật: chỉ đổi khi ≥ 30% byte VÀ lợi CPU/độ trễ đo được trên đường nóng. Kết quả: KHÔNG đường nào đạt ⇒ giữ JSON mọi đường, không thêm cờ `HUB_WIRE_MSGPACK`.**
- `run:<id>` delta (đường nóng nhất): giảm byte chỉ 0,4–4,9% vì payload gần như toàn là chữ (UTF-8 như nhau); khoá/dấu JSON chỉ ~20 B/sự kiện.
  Phía Hub (bên đọc, nút thắt) `JSON.parse` native nhanh hơn msgpackr 3–8× (200ch: 378 → 3038 ns; cả đường dec+zod 1886 → 4875 ns, chậm hơn 2,6×).
  Python ghi nhanh hơn chút ở delta lớn nhưng Runtime không phải nút thắt (delta gom ≥ 100 ms/200 ký tự). Độ trễ thực đã 0,13 ms p50 ⇒ không còn gì để thắng.
  Thêm: `RunStreamReader` đọc bằng `conn.call` (chuỗi UTF-8), msgpack nhị phân cần `callBuffer`/đổi cả `xreadPairs` dùng chung với `sse:` — chi phí đổi cao, lợi âm.
- `job.progress`/`job.started`/`pg_notify`: giảm 9–12% byte nhưng tuyệt đối chỉ 20 B và hiếm (1 lần/job, vài lần/phút) ⇒ không đáng.
- `ustream:<uid>` / `sse:<id>`: bên nhận cuối là trình duyệt qua SSE (`JSON.stringify(data)`), msgpack buộc decode rồi stringify lại — thêm việc, giảm 4,8% byte.
- `hub.jobs.payload` (jsonb Postgres) và `pg_notify` (text ≤ 8000 B): Postgres lưu/đọc jsonb sẵn; msgpack không dùng được trong jsonb/NOTIFY text nếu không base64 (+33% byte) ⇒ loại.
- Protobuf: không có schema nào sẵn ⇒ không xét (đúng yêu cầu). Vector/embedding: không có đường dây nào trong phạm vi này.
- Để mở lại: nếu sau này delta là JSON lớn có cấu trúc (không phải chữ) hoặc đổi sang gom ít hơn, chạy lại `bun apps/hub-api/scripts/wire-bench.ts` (msgpackr là devDependency ghim 1.11.14 chỉ cho bench).
- Golden TS↔Python + cờ `enc=mp1` không làm vì không có đường nào chuyển (tránh mã chết, Luật 4).
- B: ảnh `py` = `ghcr.io/astral-sh/uv:python3.12-bookworm-slim` (cùng ảnh `scripts/run.ts`) + git + bun (chỉ chạy `pytest-reds.ts`). Chạy `-m "int or not int"` một lượt.
  3 ca đỏ sẵn trên base cdf07e7d (không phải do lát này) ghi vào `tests/known-red.json` suite `py`, hạn 2026-11-17: `test_confirm.py::test_hub_fr_95_model_need_input_kept`,
  `result_int_test.py::test_wrk_fr_03_event_sequence` và `::test_wrk_fr_27_partial_need_input` (EVENT_KEYS của test thiếu khoá `source_reads`).

## Không làm / Chạm
Không đổi mã chạy (Hub/Runtime) — giữ nguyên JSON. Chạm: tooling evotest, `tests/known-red.json`, `tools/scripts` (known-red), bench + perf test mới, `docs/WORKFLOW.md`, devDependency `msgpackr` của hub-api.

## Test tối thiểu
- `bun test tools/scripts/src/known-red.test.ts` (12 pass, gồm `pytestReds`).
- evotest `-Step perf -Filter apps/hub-api/src/modules/runner/run-stream-wire.perf.int.test.ts`: 2 pass (số đo ở trên).
- evotest `-Step py`: `src/agent_runtime/events` 9 pass; `queue + runtimes/cli + tests/acceptance/result_int_test.py` 190 pass + 3 đỏ cũ (trước khi ghi known-red: exit 1 với 3 đỏ MỚI; sau: exit 0 với 3 đỏ cũ).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: đo cho thấy không đường dây nào đạt ngưỡng đổi sang msgpack nên giữ JSON; phần còn lại chỉ là công cụ test evotest `-Step py`, perf test nền và bench).

## Việc còn lại
- Chạy `-Step py` cả bộ (không `-Filter`) một lần để biết đủ đỏ cũ của agent-runtime; điều tra 3 ca đỏ sẵn đã quarantine.
