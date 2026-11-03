---
id: hub-otel
lát: hub-otel
cr: CR-114
làn: nhanh
migration: không
phụ thuộc:
---
## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED hub/observability.md
#### Yêu cầu: Tracing OpenTelemetry tắt mặc định
Hub-api và Runtime chỉ dựng SDK OpenTelemetry khi `OTEL_EXPORTER_OTLP_ENDPOINT` (hoặc `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) được đặt; vắng thì mọi span là no-op dùng chung (không cấp phát, không import SDK Python), `payload.traceparent` vắng.
- Kịch bản: khi vắng endpoint thì `initOtel` không dựng SDK, span là NOOP và không có traceparent [test: apps/hub-api/src/lib/otel.test.ts » vắng endpoint ⇒ initOtel không dựng SDK]
- Kịch bản: khi Runtime không có endpoint thì `init` trả False và `span()` không làm gì [test: apps/agent-runtime/src/agent_runtime/test_otel.py » test_tat_mac_dinh_khong_dung_sdk]

#### Yêu cầu: Một trace cho mỗi run chat
Request E12 → span `run` → `agent.step` (tên agent, vai, tenant, run, token vào/ra) → `job.enqueue`; `traceparent` của `job.enqueue` nằm trong `payload.traceparent` của job; Runtime nối `job.run` và `llm.call` (token vào/ra/cache) vào cùng trace và đặt header `traceparent` trong cấu hình MCP để span `/mcp` (`mcp.tool`) của Hub cùng trace; SSE ghi mốc `sse.first_delta` và `sse.deltas` trên span `run`. Span không chứa prompt, trả lời, nội dung hay message lỗi (chỉ id, tên agent/tool, đếm token, tên lỗi).
- Kịch bản: khi bật OTel thì run, agent.step, job.enqueue và span nhận traceparent cùng một trace và xuất OTLP tới collector [test: apps/hub-api/src/lib/otel.test.ts » trace một run]
- Kịch bản: khi Hub nhận job thì span `job.run` của Runtime là con của span `job.enqueue` [test: apps/agent-runtime/src/agent_runtime/test_otel.py » test_span_job_la_con_cua_traceparent_hub]
- Kịch bản: khi lỗi xảy ra thì span chỉ ghi tên lỗi, không ghi message [test: apps/hub-api/src/lib/otel.test.ts » lỗi ghi tên lỗi, không message; apps/agent-runtime/src/agent_runtime/test_otel.py » test_loi_ghi_ten_loi_khong_message]
- Kịch bản: khi Runtime ghi cấu hình MCP thì có header `traceparent` [test: apps/agent-runtime/src/agent_runtime/test_otel.py » test_header_traceparent_vao_cau_hinh_mcp]

#### Yêu cầu: Log kv gọn cho agent đọc
`LOG_FORMAT=kv` (mặc định `kv` khi `APP_ENV=production`, ngược lại `json`) in một dòng `t=<epoch> lvl=<mức> e=<sự.kiện.chấm> run=<6 ký tự> ag=<tên agent đầy đủ> ms=<n> tk=<vào>/<ra> trace=<8 ký tự> …`: tên sự kiện là chữ, id rút 6 ký tự, chuỗi chỉ trong ngoặc kép khi có khoảng trắng, dòng ≤ 400 ký tự, bí mật bị che theo bộ che hiện có. `bun run log:view` in lại cho người đọc.
- Kịch bản: khi log ở dạng kv thì dòng đúng khuôn, id rút gọn, tk gộp vào/ra [test: apps/hub-api/src/lib/log-kv.test.ts » khuôn; apps/agent-runtime/src/agent_runtime/test_log_kv.py » test_khuon_dong_id_6_ky_tu_agent_day_du]
- Kịch bản: khi giá trị có khoảng trắng, dấu = hoặc xuống dòng thì được đặt ngoặc kép và escape, không có xuống dòng thật [test: apps/hub-api/src/lib/log-kv.test.ts » giá trị; apps/agent-runtime/src/agent_runtime/test_log_kv.py » test_gia_tri_escape_va_ngoac_kep]
- Kịch bản: khi dòng quá 400 ký tự thì bị cắt và kết bằng `~` [test: apps/hub-api/src/lib/log-kv.test.ts » trần dòng; apps/agent-runtime/src/agent_runtime/test_log_kv.py » test_tran_dong_400]
- Kịch bản: khi log chứa JWT, Bearer hoặc khoá nhạy cảm thì bị che [test: apps/hub-api/src/lib/log-kv.test.ts » che bí mật; apps/agent-runtime/src/agent_runtime/test_log_kv.py » test_configure_logging_kv_che_bi_mat_va_gan_ngu_canh]
- Kịch bản: khi chạy `bun run log:view` thì dòng kv được in có giờ, mức, sự kiện và cột run/ag/ms/tk/trace [test: tools/scripts/src/log-view.test.ts » prettyLine]

## Plan (ngắn)
Hub-api dùng logger tự viết (JSON một dòng, `lib/logger.ts`), Runtime dùng structlog (`log.py`) — cả hai đã JSON ở prod, nên thêm formatter kv và chọn `kv` khi `APP_ENV=production` (đặt `LOG_FORMAT=json` để quay lại). Tracing dùng SDK chính thức (JS `@opentelemetry/*` cho Bun, Python `opentelemetry-*`), context truyền tường minh (span cha theo `run_id` / `traceparent`), không dựa AsyncLocalStorage qua async generator. Job đã nằm trong Postgres `hub.jobs.payload` nên traceparent đi trong payload (trường mới `traceparent?` của `AgentCliJob`, schema + pydantic sinh lại).

## Làm
- [x] `apps/hub-api/src/lib/otel.ts` (no-op khi tắt) + span request (`app.ts`), `run` (`runs.service.ts` + đóng ở `sse-writer.ts`), `agent.step` + `job.enqueue` (`job-agent-runner.ts`), `mcp.tool` (`mcp.service.ts`).
- [x] `packages/contracts/src/hub/job.ts` `traceparent?`; `contracts/hub.schema.json` + `contracts/hub.py` sinh lại (datamodel-codegen 0.83.0 như uv.lock).
- [x] `apps/agent-runtime/src/agent_runtime/otel.py`; `job_run.py` (`job.run`, `llm.call`), `providers/claude/mcp.py` (header `traceparent`), `main.py` (init/shutdown).
- [x] Log kv: `lib/log-kv.ts` + `logger.ts` (`setLogFormat`), `LOG_FORMAT` trong `config/env.ts`; `log_kv.py` + `log.py` + `config.py`; `tools/scripts/src/log-view*.ts`, `bun run log:view`.
- [x] Phụ thuộc ghim chính xác: JS api 1.10.0, sdk-trace-base 2.12.0, exporter-trace-otlp-http 0.300.0, resources 3.0.0; Python 1.45.0 (đã có trong uv.lock qua mcp) cho api/sdk/exporter-otlp-proto-http.
- [x] `compose.yaml` profile `otel` (otel-collector + Jaeger); `.env.example`; mục "Tracing và log kv" trong `docs/WORKFLOW.md`.

## Không làm / Chạm
- Không thêm span cho từng delta (chỉ mốc `sse.first_delta` + đếm); không instrument DB/Redis; không đổi hành vi khi tắt.
- Runtime không tự gắn trace vào job `workflow.async`/`source.*` (chỉ job `agent.cli`); điểm mở rộng: thêm `traceparent` vào schema job đó.
- Log hiện có (`logger.info("job-enqueue-skipped", …)`): tên sự kiện chuẩn hoá `job.enqueue.skipped` ở dạng kv; không đổi call-site.

## Test tối thiểu
- unit: `apps/hub-api/src/lib/log-kv.test.ts`, `apps/hub-api/src/lib/otel.test.ts` (collector OTLP giả qua `Bun.serve`), `tools/scripts/src/log-view.test.ts`; `apps/agent-runtime/src/agent_runtime/test_log_kv.py`, `test_otel.py`.
- Không int/e2e: không đổi SQL/route; `job-agent-runner` chỉ thêm span + một trường payload tuỳ chọn.

## Quyết định trong lúc làm
- Mặc định kv theo `APP_ENV=production` (cả hai ngôn ngữ đang JSON ở prod; dev/test giữ JSON cho người).
- Tên sự kiện kv: mọi ký tự ngoài `[a-z0-9.]` thành dấu chấm (`orchestrator_tenant_invalid` → `orchestrator.tenant.invalid`); cùng luật ở TS và Python.
- Token vào/ra (`input_tokens`/`output_tokens`) rút ra TRƯỚC khi che (khoá `*token*` bị bộ che hiện có thay hẳn) → `tk=in/out`; cache token chỉ có ở Runtime (`tokens.cache_read/cache_write` trên `llm.call`), Hub không có số này.
- `uv.lock` giữ `revision = 3` (uv mới ghi 5; ảnh uv của `scripts/run.ts` đọc được bản cũ).
- Python test chạy trên Windows chỉ được phần không phụ thuộc `fcntl`; `job_run.py` chỉ kiểm qua pyright + ruff cục bộ, test Linux chạy trên evotest.

## Việc còn lại
- `bun run contracts:check` (cần docker/uv) và pytest `runtimes/cli/test_job_run*.py` trên Linux/evotest chưa chạy cục bộ.
- Gộp Delta vào `docs/current/hub/observability.md` cuối đợt.
