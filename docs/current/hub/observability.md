# Hub · OpenTelemetry và log kv

Cập nhật: 2026-11-09 · Gộp từ: hub-otel (đợt cr125-wave).

## Yêu cầu: Tracing OpenTelemetry tắt mặc định (nguồn: hub-otel)
Hub-api và Runtime chỉ dựng SDK OpenTelemetry khi `OTEL_EXPORTER_OTLP_ENDPOINT` (hoặc `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) được đặt; vắng thì mọi span là no-op dùng chung (không cấp phát, không import SDK Python), `payload.traceparent` vắng.
- Kịch bản: khi vắng endpoint thì `initOtel` không dựng SDK, span là NOOP và không có traceparent [test: apps/hub-api/src/lib/otel.test.ts » vắng endpoint ⇒ initOtel không dựng SDK]
- Kịch bản: khi Runtime không có endpoint thì `init` trả False và `span()` không làm gì [test: apps/agent-runtime/src/agent_runtime/test_otel.py » test_tat_mac_dinh_khong_dung_sdk]

## Yêu cầu: Một trace cho mỗi run chat (nguồn: hub-otel)
Request E12 → span `run` → `agent.step` (tên agent, vai, tenant, run, token vào/ra) → `job.enqueue`; `traceparent` của `job.enqueue` nằm trong `payload.traceparent` của job; Runtime nối `job.run` và `llm.call` (token vào/ra/cache) vào cùng trace và đặt header `traceparent` trong cấu hình MCP để span `/mcp` (`mcp.tool`) của Hub cùng trace; SSE ghi mốc `sse.first_delta` và `sse.deltas` trên span `run`. Span không chứa prompt, trả lời, nội dung hay message lỗi (chỉ id, tên agent/tool, đếm token, tên lỗi).
- Kịch bản: khi bật OTel thì run, agent.step, job.enqueue và span nhận traceparent cùng một trace và xuất OTLP tới collector [test: apps/hub-api/src/lib/otel.test.ts » trace một run]
- Kịch bản: khi Hub nhận job thì span `job.run` của Runtime là con của span `job.enqueue` [test: apps/agent-runtime/src/agent_runtime/test_otel.py » test_span_job_la_con_cua_traceparent_hub]
- Kịch bản: khi lỗi xảy ra thì span chỉ ghi tên lỗi, không ghi message [test: apps/hub-api/src/lib/otel.test.ts » lỗi ghi tên lỗi, không message; apps/agent-runtime/src/agent_runtime/test_otel.py » test_loi_ghi_ten_loi_khong_message]
- Kịch bản: khi Runtime ghi cấu hình MCP thì có header `traceparent` [test: apps/agent-runtime/src/agent_runtime/test_otel.py » test_header_traceparent_vao_cau_hinh_mcp]

## Yêu cầu: Log kv gọn cho agent đọc (nguồn: hub-otel)
`LOG_FORMAT=kv` (mặc định `json` ở mọi môi trường kể cả production; kv chỉ khi đặt tường minh — fix114-log) in một dòng `t=<epoch> lvl=<mức> e=<sự.kiện.chấm> run=<6 ký tự> ag=<tên agent đầy đủ> ms=<n> tk=<vào>/<ra> trace=<8 ký tự> …`: tên sự kiện là chữ, id rút 6 ký tự, chuỗi chỉ trong ngoặc kép khi có khoảng trắng, dòng ≤ 400 ký tự, bí mật bị che theo bộ che hiện có. `bun run log:view` in lại cho người đọc.
- Kịch bản: khi log ở dạng kv thì dòng đúng khuôn, id rút gọn, tk gộp vào/ra [test: apps/hub-api/src/lib/log-kv.test.ts » khuôn; apps/agent-runtime/src/agent_runtime/test_log_kv.py » test_khuon_dong_id_6_ky_tu_agent_day_du]
- Kịch bản: khi giá trị có khoảng trắng, dấu = hoặc xuống dòng thì được đặt ngoặc kép và escape, không có xuống dòng thật [test: apps/hub-api/src/lib/log-kv.test.ts » giá trị; apps/agent-runtime/src/agent_runtime/test_log_kv.py » test_gia_tri_escape_va_ngoac_kep]
- Kịch bản: khi dòng quá 400 ký tự thì bị cắt và kết bằng `~` [test: apps/hub-api/src/lib/log-kv.test.ts » trần dòng; apps/agent-runtime/src/agent_runtime/test_log_kv.py » test_tran_dong_400]
- Kịch bản: khi log chứa JWT, Bearer hoặc khoá nhạy cảm thì bị che [test: apps/hub-api/src/lib/log-kv.test.ts » che bí mật; apps/agent-runtime/src/agent_runtime/test_log_kv.py » test_configure_logging_kv_che_bi_mat_va_gan_ngu_canh]
- Kịch bản: khi chạy `bun run log:view` thì dòng kv được in có giờ, mức, sự kiện và cột run/ag/ms/tk/trace [test: tools/scripts/src/log-view.test.ts » prettyLine]
