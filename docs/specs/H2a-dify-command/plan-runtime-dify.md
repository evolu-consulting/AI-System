# Plan · H2a · Runtime — gọi Dify (phụ lục `plan-runtime.md`)

Tách từ `plan-runtime.md` §3 (trần 30 KB); **số mục giữ nguyên** (§3.2, §3.4, §3.5, §3.7). Mã + `reason` lỗi: `plan-errors.md` §2 (RT3, chung với TS `dify.rules.ts`) — Runtime không tự đặt mã khác bảng đó.

### 3.2 Gọi Dify (cách gọi theo spec §7, auto-pilot `chat-client.ts`/`client.ts` — chỉ đọc cách gọi)
| App (`payload.app_type`) | Request | Sự kiện dùng |
|---|---|---|
| `workflow` | `POST {base_url}/workflows/run` body `{inputs, response_mode:"streaming", user}` | `workflow_started` (`task_id`) · `node_started` (tiến độ) · `text_chunk.data.text` · `workflow_finished.data{status, outputs, error, total_tokens, elapsed_time}` · `error` · `ping` |
| `chat` / `agent` | `POST {base_url}/chat-messages` body `{inputs, query, response_mode:"streaming", conversation_id:"", user}` | `message.answer` · `agent_message.answer` · `agent_thought` (tiến độ) · `message_end.metadata.usage{prompt_tokens, completion_tokens, total_tokens, total_price, currency}` · `error` · `ping` |
| Huỷ | workflow `POST {base_url}/workflows/tasks/{task_id}/stop` · chat `POST {base_url}/chat-messages/{task_id}/stop`, body `{user}` | best-effort, timeout 2 s |

- `base_url`, `api_key`, `app_type` lấy từ credential (`plan-runtime` §3.3), **không** từ payload; `app_type` của credential khác `payload.app_type` → `NOT_CONFIGURED`/`credential` (workflow vừa đổi cấu hình).
- Header `Authorization: Bearer <api_key>`; `user` = `payload.dify_user` (`<tenant_key>:<user_id>`, Hub dựng — R15; Runtime không đọc `admin.*`).
- `inputs`/`query` Hub đã map + validate (R05, R06); Runtime gửi nguyên văn.
- Timeout httpx2: connect 10 s, read `AGENT_RT_DIFY_READ_TIMEOUT_S`=30 s (Dify gửi `ping` ~10 s), tổng = deadline job (`plan-runtime` §3.6).
- Kết quả `final_text(acc, outputs, field)` (bản Python của `finalText` TS, cùng bảng ca test): nối `text_chunk`/`answer`; rỗng khi kết thúc → `outputs[payload.output_field or "text"]` (chuỗi; object/số → `json.dumps`; `null`/`""` → rỗng); vẫn rỗng → `UPSTREAM_ERROR`/`invalid_output`. Cắt ≤ 64 000 ký tự, log `warn job.output_truncated`.
- `workflow_finished.status ∈ {failed, stopped}` hoặc sự kiện `error` → `UPSTREAM_ERROR`/`upstream` (R11).
- Không phát `delta` (R12); Hub nhận `job.result{output:{kind:"text", text}}` (RT7).

### 3.4 Vòng thử và retry (WRK-FR-06, R13, Q6)
Hàm thuần `retry_delay(err_kind, attempt, first_seen, side_effect, sent) -> float | None` (`policy.py`); `BACKOFF = AGENT_RT_DIFY_BACKOFF_S` mặc định `(2, 8)` (test `(0.2, 0.8)`).

| Lỗi | `first_seen` (đã nhận `workflow_started`/chunk/`message` đầu) | `side_effect` | Retry? | Mã · `reason` cuối |
|---|---|---|---|---|
| Kết nối (`ConnectError`, `ConnectTimeout`) — request **chưa gửi** | — | bất kỳ | ✓ (2 s, 8 s) | `UPSTREAM_ERROR` · `upstream` |
| 5xx, `ReadError`/`RemoteProtocolError`/`ReadTimeout` trước sự kiện đầu | ✗ | `false` | ✓ | `UPSTREAM_ERROR` · `upstream` |
| như trên | ✗ | `true` | ✗ (Q6: request có thể đã chạy) | `UPSTREAM_ERROR` · `upstream` |
| bất kỳ lỗi sau sự kiện đầu | ✓ | bất kỳ | ✗ | `UPSTREAM_ERROR` · `upstream` |
| HTTP 401/403/404 | — | — | ✗ | `NOT_CONFIGURED` · `upstream` |
| HTTP 400 (`invalid_param`…), 413, 415, 422, 429, 4xx khác, SSE `error`, `status=failed/stopped` | — | — | ✗ | `UPSTREAM_ERROR` · `upstream` |
| Kết quả rỗng | — | — | ✗ | `UPSTREAM_ERROR` · `invalid_output` |

Tối đa 3 lần gọi trong một lần claim (1 + 2 retry). Ngủ backoff bằng `asyncio.wait_for(control.stopped.wait(), delay)` để huỷ/timeout cắt được. Mỗi lần thử log `info dify.attempt{n, http_status?, err_kind}` (không thân, không key).

**Đánh dấu đã gửi (`side_effect`, Q6, R8):** ngay **trước** request Dify đầu của lần claim, nếu `payload.side_effect` → `mark_dispatched`: `UPDATE hub.jobs SET dispatched_at = now() WHERE id = $1 AND worker_id = $2 AND status = 'running'` (0 dòng → mất job, không gọi Dify). Câu requeue (`plan-db` §2) bỏ qua job `side_effect` có `dispatched_at` (R7).

### 3.5 Tiến độ (`job.progress`, R12)
| Nguồn | `message` (tĩnh, ≤ 200) | Ghi chú |
|---|---|---|
| bắt đầu gọi | `"Đang chạy lệnh"` | ngay sau credential |
| `node_started` (workflow) / `agent_thought` (agent) | `"Đang chạy bước {n}"` (`n` đếm tăng) | **không** tên node/workflow/nội dung (R09, RT7) |
| retry | `"Đang thử lại ({k}/2)"` | trước khi ngủ backoff |
`percent: null`. Gộp: tối đa 1 `job.progress`/giây (giữ sự kiện mới nhất). Hub chỉ dùng làm nhịp sống, không đổi `RunEvent` (P13).

### 3.7 Kết thúc và usage (WRK-FR-07, HUB-FR-80, R15, RT5)
Một transaction (SQL Kết thúc H1 + INSERT usage biến thể `dify`): `jobs` → `succeeded{result:{kind:"text", text}}` / `failed` / `cancelled` / `timed_out`; `usage_logs` khi đã có lời gọi Dify trả về (kể cả lỗi sau sự kiện đầu, huỷ). Lỗi trước khi gọi Dify (credential, payload) → SQL Kết thúc H1, không usage.

| Cột | Giá trị |
|---|---|
| `billing` · `provider_key` · `model` · `agent_id` | `'dify'` · `'dify'` · `NULL` · `NULL` |
| `feature_id` | `payload.feature_id` (R15) |
| `input_tokens` · `output_tokens` | chat: `prompt_tokens` · `completion_tokens`; workflow: `total_tokens` · 0; không có → 0 · 0 (không bịa) |
| `cache_read_tokens` · `cache_write_tokens` | NULL |
| `cost_usd` | `total_price` (Decimal) nếu `currency == "USD"`, khác/không có → 0 |
| `latency_ms` | từ lúc gửi request lần thử cuối tới sự kiện kết thúc/lỗi (WRK-FR-07) |
| `job_id` | `ON CONFLICT (job_id) DO NOTHING` — claim lại sau requeue không nhân đôi |
Rồi XADD `job.result{output:{kind:"text", text}, usage{input_tokens, output_tokens}, session_resumed:false}` hoặc `job.failed{status, code, reason, message, usage}` (`code`/`reason` theo `plan-errors` §2); `message` là câu tĩnh theo mã (như H1 `outcome.py`), không chép thân lỗi Dify. **Không** đụng `provider_state` của `dify` (RT6).
