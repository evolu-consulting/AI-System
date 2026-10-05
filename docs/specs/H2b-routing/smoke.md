# H2b · Smoke I2: stream `claude-sub` thật (`HUB_LIVE=1`, F7), chạy 2026-10-05

Phụ lục `test-plan-py.md` §4 (SM1–SM3), AC-12, R29. Người chạy: backend-lead. Kỳ vọng theo `spike-stream.md`: chỉ đòi "≥ 1 `delta` trước `step.finished`" (≙ `job.delta` trước `job.result`), **không** ngưỡng độ trễ (S5). Không chặn `done:h2b`.

**Môi trường**
- Windows: compose Postgres/Redis. DB **riêng** `ai_system_h2b_smoke_test` (tạo + `prepareDb` của `tests/acceptance/H1/_fixtures.ts` = migrate Admin + Hub), Redis DB 12. Dữ liệu: fixture H1 (`insertFixture`, `insertHubConfig`) + catalog H2a (`insertCatalog`, `insertH2aAgents`) + agent H2b (`insertH2bAgents`), rồi đổi `orchestrator` và `assistant` sang profile `claude-sub-1` (script tạm ở scratchpad, không commit). JWT ký bằng cặp khoá tạm (user `lan`/acme), truyền qua `SMOKE_TOKEN` (DB fixture không có admin-api để đăng nhập).
- hub-api: `apps/hub-api/src/server.ts`, cổng `:4100`, `APP_ENV=development`, `LOG_LEVEL=debug`, `HUB_MAX_CONCURRENT_RUNS=2`, `HUB_PUBLIC_INTERNAL_URL=http://172.26.0.1:4100` (WSL NAT, xem `hub-dev.md`).
- agent-runtime: WSL Ubuntu, user `worker`, venv `~/.venvs/agent-runtime`, `uv run --frozen`, `AGENT_RT_PROVIDERS=claude-sub,fake-cli`, `AGENT_RT_HUB_URL=http://172.26.0.1:4100`, work/log ở `~/smoke-h2b`. `claude-agent-sdk` 0.2.163, CLI bundled **2.1.286**, model `claude-opus-5-5` (profile `model: null`), creds `/home/worker/.claude`.
- Client: `tests/smoke/h2b-live.test.ts` (`HUB_LIVE=1 HUB_URL=http://localhost:4100 SMOKE_TOKEN=… DATABASE_URL=<owner smoke DB>`), ca từ chối bằng script tạm gọi E12 + đọc SSE.

## Kết quả

Thời điểm tính từ lúc gửi E12 (ms). "Job" = số `job.delta` Runtime ghi ở `<job>.events.jsonl`.

| # | Kịch bản | Kết quả | Số đo |
|---|---|---|---|
| SM2 | Orchestrator `answer` dài ("Tự trả lời trực tiếp…", ~800 ký tự) | ✅ `run.started → step.started → 47 delta → step.finished → run.finished`. Delta trải đều **4,7 s** (stream thật, như spike #1). `responder` = null (Orchestrator) | delta đầu 8 432, cuối 13 161, `step.finished` 13 348, tổng 13,4 s. 899 ký tự. Token 1356/535 (cache_write 1354) |
| SM1 | `@assistant` câu ~800 ký tự (run direct) | ✅ theo tiêu chí (≥ 1 delta trước `step.finished`, `responder = {key: assistant, name: "Trợ lý"}`, `run.finished`). ⚠️ **Delta dồn cục cuối** (F1): toàn bộ delta tới trong ~0,1 s ngay trước `step.finished` | Lần 1: 26 delta/873 ký tự, delta đầu 18 188, cuối 18 305, `step.finished` 18 501; job: ~130 `job.delta` trong **37 ms** (model sinh từ `message_start` +1,1 s tới `tool_use StructuredOutput` +10,7 s). Token 3063/1151. Lần 2 (kiểm lặp): 27 delta/906 ký tự, 13 451 → 13 567, `step.finished` 13 732; job: 131 `job.delta` trong **40 ms** ngay trước `tool_use StructuredOutput` (model sinh 5,3 s). Token 3062/609 |
| SM3 | Huỷ sau lượt có tool → 1 dòng `usage_logs`, token > 0 (cận dưới) | ✅ (lần 3). Agent gọi `Grep` (lượt 1) → huỷ ở 12 s, đang lượt 2 → `run.failed CANCELLED` (12 094 ms), job `cancelled`, không còn tiến trình `_bundled/claude`. `usage_logs` 1 dòng = lượt 1 **cuối** (`message_delta`: out 265) + lượt 2 **ảnh chụp** (`message_start`: out 6) ⇒ cận dưới đúng spike #9 | in 6445 (= 4 + cache_read 5899 + cache_write 542), out 271 |
| SM3a | (lần 1, huỷ ở delta đầu — bản test cũ) | ⚠️ Không "giữa chừng": do F1 delta đầu chỉ tới **sau** khi job đã xong (`need_input`, 3 tool `Grep/Read/Grep`, 1 `sandbox_deny` đường dẫn ngoài work dir). Hủy tới 56 ms sau khi runner ghi `outcome finished` ⇒ run `cancelled` (F4). Test vẫn xanh nhưng không đo được cận dưới | 14 delta/485 ký tự cùng lúc `step.finished` 22 490. Usage đủ 13 660/1089 |
| SM3b | (lần 2, hẹn giờ 8 s) | ✅ đúng R28 nhưng ca đỏ: CLI khởi động chậm (**6,7 s** tới `session`, lần khác 1,1–1,4 s) ⇒ huỷ trước `message_start` ⇒ 0 usage ⇒ **0 dòng** `usage_logs` ("chưa có usage → không ghi"). Đổi mặc định hẹn giờ 12 s (F3) | `run.failed CANCELLED` 8 048 ms |
| TC-8 | Prompt bị từ chối (yêu cầu viết email lừa đảo giả danh ngân hàng — mức nhẹ, không có tác hại khi bị từ chối) | ✅ **Kiểm được**: CLI trả `ResultMessage` `subtype=success`, **`is_error=true`**, text "API Error: Opus 5's safeguards flagged this message (…/aup)…", 0 output token, 2 `message_start` (CLI tự thử lại 1 lần). Runtime phân loại `refused` (`classify_is_error` chỉ trả `refused` khi `stop_reason == "refusal"` ∧ 0 output ⇒ CLI có phát **`stop_reason="refusal"`**) → job `failed UPSTREAM_ERROR`, `run_steps.detail` `{code: UPSTREAM_ERROR, reason: refused, message: "provider refused the request"}`, SSE `run.failed UPSTREAM_ERROR` (contract `run.failed` không có `reason` — đúng). `usage_logs` 1 dòng (job lỗi có usage > 0, R28) | 0 delta, tổng 12,1 s. Token 6283/0 (cache_read 5084, cache_write 1195) |

**Không lộ token:** JWT smoke và `HUB_INTERNAL_TOKEN` (test) không xuất hiện trong log hub-api, `runtime.log`, log job. Log hub-api chỉ 1 dòng `warn` (`job-failed … reason refused`, ca TC-8). Runtime 0 dòng warning/error (ngoài `sandbox_deny` có chủ đích ở log job).

**Ngân sách:** **7 job `claude-sub`** (≤ 8): SM1 ×2, SM2 ×1, SM3 ×3, TC-8 ×1; trong đó 6 job có gọi model (SM3b huỷ trước lời gọi đầu) = **11 lời gọi API** (`message_start`). Orchestrator chỉ dùng model thật ở SM2 (các ca `@assistant` là run direct, không qua Orchestrator).

## Lỗi / phát hiện

| # | Mức | Nơi | Mô tả | Trạng thái |
|---|---|---|---|---|
| F1 | **Cao** (UX AC-05) | Runtime `claude-sub` agent (`StructuredOutput`) / CLI 2.1.286 hoặc API | Với agent (`output_format` ⇒ tool `StructuredOutput`), `input_json_delta` tới Runtime **dồn một cục** (~130 mảnh trong 37–40 ms) ngay trước `AssistantMessage[tool_use StructuredOutput]`, dù model sinh 5–10 s. 3/3 job agent như vậy. Orchestrator (`text_delta`) stream đều ⇒ vòng đọc Runtime không nghẽn; nguồn là phía CLI/API (khả năng API đệm input JSON của tool_use khi không bật fine-grained tool streaming). Lệch spike #2 (71 `input_json_delta` cách TB 52 ms). Hệ quả: `@assistant`/delegate thoả "≥ 1 delta trước `step.finished`" nhưng người dùng thấy im lặng tới cuối rồi hiện cả bài — AC-05 chỉ đạt hình thức | **Không sửa** (lớn, ngoài I2). Đề xuất task: spike lại `stream_spike.py` ca `agent` với CLI hiện tại để xác định nguồn đệm; phương án: bật beta fine-grained tool streaming (nếu CLI cho qua env), hoặc agent trả chữ tự do + khối kết luận thay vì `output_format`. Ghi I3/TECH-DEBT |
| F2 | Thường (test) | `tests/smoke/h2b-live.test.ts` SM3 | Huỷ "ở delta đầu" không còn giữa chừng do F1 | **Đã sửa**: huỷ ở delta đầu **hoặc** `SMOKE_CANCEL_MS` sau `run.started` (cái nào trước) |
| F3 | Thấp (test) | như trên | Thời gian khởi động CLI dao động 1,1–6,7 s; hẹn 8 s có lần huỷ trước lượt model đầu (0 usage, đúng R28) | **Đã sửa**: mặc định 12 000 ms, ghi ở `hub-dev.md` |
| F4 | Thấp | Hub run direct (huỷ vs kết thúc) | SM3a: runner ghi `run-direct outcome finished` rồi E15 tới sau 56 ms vẫn chuyển run sang `cancelled` và SSE `run.failed CANCELLED` sau khi đã phát đủ nội dung. Có vẻ "huỷ thắng nếu trạng thái kết thúc chưa ghi" — hợp lệ nhưng cửa sổ giữa log outcome và ghi terminal đáng xem lại | Ghi nhận, không sửa (cần review Hub; không ảnh hưởng usage — 1 dòng, đủ token) |
| F5 | Thông tin | CLI | Từ chối kiểu safeguard: CLI tự thử lại 1 lần (2 `message_start`, cả hai 0 output) trước khi trả `is_error` | Ghi nhận — usage ghi cả 2 lời gọi (cache) |

**Sửa trong I2:** `tests/smoke/h2b-live.test.ts` — env `SMOKE_TOKEN` (bỏ đăng nhập), in số đo mỗi ca (không nội dung), SM1 kiểm `responder.key = assistant`, SM3 huỷ theo hẹn giờ `SMOKE_CANCEL_MS` (F2/F3). `docs/guides/hub-dev.md` — bỏ câu "`HUB_LIVE` … không được code nào đọc", thêm mục "Smoke stream H2b". Không đổi `src/**`.

**Dọn dẹp:** đã dừng hub-api (`:4100`) và Runtime WSL, xoá `~/smoke-h2b`, `DROP DATABASE ai_system_h2b_smoke_test`, `FLUSHDB` Redis 12, xoá file JWT tạm. Không đụng DB dev `ai_system`, Admin hay `apps/chat-web`.
