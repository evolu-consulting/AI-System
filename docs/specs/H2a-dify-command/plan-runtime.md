# Plan · H2a · Agent Runtime Python (`apps/agent-runtime`)

Chủ: backend-lead (Runtime). Song song `plan.md` (Hub TS) — **contract `@ai/contracts/hub` (payload `workflow.async`, `agent.cli.mcp`, sự kiện), DB `hub.*` + SQL Runtime nguyên văn, endpoint nội bộ Q5, MCP server `/mcp` thuộc `plan.md`**; plan này dùng tên, yêu cầu gửi BE ở §9 (chưa đối chiếu). Nền: H1 `plan-runtime.md` (gọi tắt **H1-PR**), `plan-db.md` (**H1-DB**), `spike-py02.md`, `smoke-i2.md`. Nguồn: spec §2 R12, R13, R15, R17–R22; §7; spec-decisions Q5; BA-W §2, §5.1 FR-06/07, §5.2 FR-13, §10 AC-W06; CONVENTIONS §9.

Ký hiệu: **[V]** đã xác minh (mã nguồn SDK cài trong `.venv` ngày 2026-10-05 hoặc spike H1) · **[CX]** chưa xác minh → spike PY-S1 (§4.6).

## 1. Tổng quan thay đổi

| # | Việc | Mục | Task |
|---|---|---|---|
| 1 | Tách `runtimes/cli/job_run.py` (398/400) — không đổi hành vi | §2 | PY-00 |
| 2 | Bộ định tuyến job theo `type` (`agent.cli` → `CliJobHost`, `workflow.async` → `DifyJobHost`) | §3.1 | PY-03 |
| 3 | Job `workflow.async` chạy **trong process cha** (chỉ HTTP, không CLI, không process con) | §3 | PY-01…03 |
| 4 | Lấy app-key qua endpoint nội bộ Hub bằng token job (Q5) | §3.3 | PY-02 |
| 5 | MCP Hub cho agent CLI (Claude Agent SDK `mcp_servers`, mở có kiểm soát trong hook) | §4 | PY-S1, PY-04 |
| 6 | `side_effect`: phát hiện `CONFIRMATION_REQUIRED` → ép `need_input` | §5 | PY-05 |
| 7 | `fake-cli` gọi `/mcp` thật | §6 | PY-06 |
| 8 | Thư viện HTTP: **httpx2** thành phụ thuộc trực tiếp → ADR-0010 Proposed | §8 | PY-02 |

Lý do `workflow.async` chạy trong process cha: không chạy mã/CLI bên thứ ba, chỉ gọi HTTP; process cha đã cầm secret hệ thống (DB/Redis) nên giữ app-key trong bộ nhớ cha không mở rộng bề mặt; huỷ = huỷ task asyncio (không process group). Giới hạn đồng thời = `providers.max_concurrency` của provider `dify` (WRK-NFR-05: 5) qua SQL claim sẵn có (H1-DB §5.4).

## 2. Tách `job_run.py` (PY-00, nợ H1)

Hiện: `JobRun` gộp điều phối lần chạy (session, retry định dạng, áp kết quả) và giám sát process (spawn, pgid, đọc stdout, giết group, dọn cây). Tách **theo trách nhiệm, giữ nguyên API** `JobRun(host, job, payload, control).execute()` mà `runner.py` gọi.

| File | Giữ | Ước lượng |
|---|---|---|
| `runtimes/cli/job_run.py` | `StopControl`, `JobRun`: `execute`, `_retryable`, `_load_session`, `_use_history`, `_rebuild_from_history`, `_invalid_hint`, `_attempt` (gọi `HostProcess`), `_apply`, `_succeeded`, `_close`, `stopping` | ~170 dòng |
| `runtimes/cli/host_proc.py` (mới) | `HostProcess`: `_prepare_work`, `_open_stderr`, `_spawn`, `_record_pgid`, `_request`, `_supervise`, `_host_gone`, `_pipe_held`, `_stop_reader`, `_reader_done`, `_mark_exit`, `_read`, `_on_event`, `_kill`, `_extra`, `_kill_leftovers`; trạng thái `proc/pipe/out/tree/wait_since/killed` | ~240 dòng |

Luật: composition (`JobRun` giữ `self.proc_host: HostProcess`), không mixin; `HostProcess` nhận `JobRun` qua Protocol hẹp (`seen`, `deadline`, `control`, `stopping()`, `prompt/retry/resume_id`) để không vòng import. Docstring đầu module chuyển phần "v2 N1/N2" sang `host_proc.py`. Test hiện có (`test_job_run*.py`, `test_runner*.py`) **không sửa logic**, chỉ sửa đường import nếu monkeypatch trỏ hàm đã chuyển. Lệnh xong: toàn bộ `pytest` + `pytest -m int` H1 xanh (310 ca), `lint-imports`, `check:size`. Chỗ chèn MCP sau này: `HostProcess._request` (thêm đường dẫn file cấu hình MCP — §4.2).

## 3. Job `workflow.async` (R12, R13, R15, WRK-FR-06/07, AC-W06)

### 3.1 Cây file mới
| File | Nội dung | Thuần? |
|---|---|---|
| `runtimes/dispatch.py` | `JobRouter(JobHost)`: đọc `job.payload["type"]` → host tương ứng; type lạ → `finish_failed(INVALID_PAYLOAD)` | |
| `runtimes/dify/host.py` | `DifyJobHost`: validate payload (`JobPayloadWorkflowAsync` sinh từ C2), `bind_job`, vòng thử (§3.4), huỷ/timeout (§3.6), kết thúc (§3.7) | |
| `runtimes/dify/client.py` | `DifyClient`: `run_stream(cred, req) -> AsyncIterator[ServerSentEvent]` (httpx2 `EventSource`), `stop(cred, app_type, task_id, user)` | |
| `runtimes/dify/credential.py` | `fetch_credential(hub_url, job_id, token) -> DifyCredential`; `DifyCredential.__repr__` che key | |
| `runtimes/dify/stream.py` | `StreamState` + `reduce(state, event) -> Step` (text, `task_id`, `first_seen`, `finished`, usage, progress) | ✓ |
| `runtimes/dify/policy.py` | `retry_delay(...)`, `map_failure(...)`, `usage_row(...)`, `mask(text, key)` | ✓ |
| `db/workflow_sql.py` | `mark_dispatched`, Kết thúc biến thể `billing='dify'` (SQL nguyên văn từ `plan.md`) | |
| `tests/support/dify_mock.py` | mock Dify + endpoint credential của Hub (§7) | |

`main.py`: `make_host` trả `JobRouter({"agent.cli": CliJobHost(...), "workflow.async": DifyJobHost(...)})`. Import-linter: thêm `agent_runtime.runtimes.dify` vào lớp `runtimes` (đã có), forbidden mới: `runtimes.dify` không import `providers`, `sandbox`, `runtimes.cli`. `AGENT_RT_PROVIDERS` thêm `dify` (provider_key của job `workflow.async`, §9 R4).

### 3.2 Gọi Dify (cách gọi theo spec §7, auto-pilot `chat-client.ts`/`client.ts` — chỉ đọc cách gọi)
| App (`payload.app_type`) | Request | Sự kiện dùng |
|---|---|---|
| `workflow` | `POST {base_url}/workflows/run` body `{inputs, response_mode:"streaming", user}` | `workflow_started` (`task_id`) · `node_started` (tiến độ) · `text_chunk.data.text` · `workflow_finished.data{status, outputs, error, total_tokens, elapsed_time}` · `error` · `ping` |
| `chat` / `agent` | `POST {base_url}/chat-messages` body `{inputs, query, response_mode:"streaming", conversation_id:"", user}` | `message.answer` · `agent_message.answer` · `agent_thought` (tiến độ) · `message_end.metadata.usage{prompt_tokens, completion_tokens, total_tokens, total_price, currency}` · `error` · `ping` |
| Huỷ | workflow `POST {base_url}/workflows/tasks/{task_id}/stop` · chat `POST {base_url}/chat-messages/{task_id}/stop`, body `{user}` | best-effort, timeout 2 s |

- Header `Authorization: Bearer <app_key>`; `user` = `payload.dify_user` (`<tenant_key>:<user_id>`, Hub dựng — R15; Runtime không đọc `admin.*`).
- `inputs`/`query` Hub đã map + validate (R05, R06); Runtime gửi nguyên văn.
- Timeout httpx2: connect 10 s, read `AGENT_RT_DIFY_READ_TIMEOUT_S`=30 s (Dify gửi `ping` ~10 s), tổng = deadline job (§3.6).
- Kết quả: nối `text_chunk`/`answer`; rỗng khi kết thúc → `outputs[payload.output_field or "text"]` (chuỗi; khác chuỗi → `json.dumps`); vẫn rỗng → `UPSTREAM_ERROR` (như R09). Cắt ≤ 64 000 ký tự (giới hạn `Output1.text`), log `warn job.output_truncated`.
- `workflow_finished.status ∈ {failed, stopped}` hoặc sự kiện `error` → `UPSTREAM_ERROR` (R11).
- Không phát `delta` (R12); Hub nhận `job.result{text}`.

### 3.3 App-key qua endpoint nội bộ (Q5, R17)
| Bước | Chi tiết |
|---|---|
| 1 | Sau claim, trước lời gọi Dify đầu: `POST {AGENT_RT_HUB_URL}/internal/jobs/{job_id}/dify-credential`, `Authorization: Bearer <payload.job_token>` (tên theo contract BE — §9 R5). URL gốc lấy từ **env** Runtime, không từ payload (token chỉ gửi tới Hub đã cấu hình) |
| 2 | 200 → `DifyCredential{base_url, api_key, app_type}` giữ trong bộ nhớ của `DifyJobHost` tới hết lần claim; `__repr__`/`__str__` che `api_key`; không vào log, `jobs.result`, XADD, `error_message` |
| 3 | 409/422 `NOT_CONFIGURED` (secret thiếu, giải mã lỗi, workflow tắt) → `job.failed{NOT_CONFIGURED}`, không retry · 401 (token sai / job không `running` theo Hub) → coi như mất job: không ghi, log `warn job.credential_rejected` (Hub/heartbeat xử lý) · 5xx / lỗi mạng → thử lại theo §3.4 (an toàn cả với `side_effect` vì chưa gửi Dify) |
| 4 | Che lộ: mọi chuỗi ra ngoài (thân lỗi Dify ≤ 300 ký tự vào log, `error_message`) qua `mask(text, api_key)` (thay key thô, base64, hex bằng `***`). Logger `httpx2`, `httpcore2` đặt `WARNING` trong `log.py` (không log header/URL ở DEBUG) |
| 5 | Lấy lại key khi job được claim lại sau requeue (không giữ qua claim) |

### 3.4 Vòng thử và retry (WRK-FR-06, R13, Q6)
Hàm thuần `retry_delay(err_kind, attempt, first_seen, side_effect, sent) -> float | None` (`policy.py`); `BACKOFF = AGENT_RT_DIFY_BACKOFF_S` mặc định `(2, 8)` (test đặt `(0.2, 0.8)`).

| Lỗi | `first_seen` (đã nhận `workflow_started`/chunk/`message` đầu) | `side_effect` | Retry? | Mã cuối |
|---|---|---|---|---|
| Kết nối (`ConnectError`, `ConnectTimeout`) — request **chưa gửi** | — | bất kỳ | ✓ (2 s, 8 s) | `UPSTREAM_ERROR` |
| 5xx, `ReadError`/`RemoteProtocolError`/`ReadTimeout` trước sự kiện đầu | ✗ | `false` | ✓ | `UPSTREAM_ERROR` |
| như trên | ✗ | `true` | ✗ (Q6: request có thể đã chạy) | `UPSTREAM_ERROR` |
| bất kỳ lỗi sau sự kiện đầu | ✓ | bất kỳ | ✗ | `UPSTREAM_ERROR` |
| 401/403/404 | — | — | ✗ | `NOT_CONFIGURED` |
| 400 (`invalid_param`…), 429, SSE `error`, `status=failed/stopped`, kết quả rỗng | — | — | ✗ | `UPSTREAM_ERROR` |

Tối đa 3 lần gọi trong một lần claim (1 + 2 retry). Ngủ backoff bằng `asyncio.wait_for(control.stopped.wait(), delay)` để huỷ/timeout cắt được. Mỗi lần thử log `info dify.attempt{n, http_status?, err_kind}` (không thân, không key).

**Đánh dấu đã gửi (`side_effect`, Q6):** ngay **trước** khi gửi request Dify lần đầu của lần claim, nếu `payload.side_effect` → SQL `mark_dispatched` (`jobs.dispatched_at = now()`, tên cột theo BE §9 R4). Requeue khi orphan chỉ xảy ra nếu `dispatched_at IS NULL` (SQL của BE).

### 3.5 Tiến độ (`job.progress`, R12)
| Nguồn | `message` (tĩnh, ≤ 200) | Ghi chú |
|---|---|---|
| bắt đầu gọi | `"Đang chạy lệnh"` | ngay sau credential |
| `node_started` (workflow) / `agent_thought` (agent) | `"Đang chạy bước {n}"` (`n` đếm tăng) | **không** tên node/workflow/nội dung (như R09) |
| retry | `"Đang thử lại ({k}/2)"` | trước khi ngủ backoff |
`percent: null`. Gộp: tối đa 1 `job.progress`/giây (giữ sự kiện mới nhất). Hub chuyển thành `step.started/finished` (R12, không phát ra chat).

### 3.6 Huỷ, timeout, mất job, dừng process
| Nguồn (`JobControl.reason`, H1-PR §2.3) | Xử lý | Ghi |
|---|---|---|
| `cancel` (LISTEN `job_cancel` / heartbeat) | huỷ task stream (đóng response) → `stop(task_id)` nếu đã có `task_id` (2 s, lỗi bỏ qua) | `cancelled` + `job.failed{CANCELLED}` ≤ 5 s |
| timeout: `asyncio.timeout(payload.timeout_s)` quanh **cả** credential + các lần thử + backoff | như huỷ | `timed_out` + `job.failed{TIMEOUT}` |
| `lost` (heartbeat không trả job) | huỷ task, **không** gọi stop (worker khác có thể đang chạy lại), không ghi | — |
| `shutdown` (SIGTERM cha) | huỷ task, không gọi stop; cha ghi SQL Khởi động lại/dừng — với `workflow.async` SQL của BE **đưa về `queued`** theo cùng luật orphan | — |
Không có process con ⇒ không `pgid` (`jobs.pgid` NULL; SQL dọn khởi động bỏ qua kill khi NULL — đã có).

### 3.7 Kết thúc và usage (WRK-FR-07, HUB-FR-80, R15)
Một transaction (SQL Kết thúc biến thể của BE): `jobs` → `succeeded{result:{kind:"text", text}}` / `failed` / `cancelled` / `timed_out`; `usage_logs` khi đã có lời gọi Dify trả về (kể cả lỗi sau sự kiện đầu, huỷ): 

| Cột | Giá trị |
|---|---|
| `billing` · `provider_key` · `model` · `agent_id` | `'dify'` · `'dify'` · `NULL` · `NULL` (command) |
| `feature_id` | `payload.feature_id` (command; tool/agent → NULL, R15) |
| `input_tokens` · `output_tokens` | chat: `prompt_tokens` · `completion_tokens`; workflow: `total_tokens` · 0; không có → 0 · 0 (không bịa) |
| `cache_read_tokens` · `cache_write_tokens` | NULL |
| `cost_usd` | `total_price` (Decimal) nếu `currency == "USD"`, khác/không có → 0 |
| `latency_ms` | từ lúc gửi request lần thử cuối tới sự kiện kết thúc/lỗi (WRK-FR-07: không có token thì vẫn có thời gian) |
| `job_id` | `ON CONFLICT (job_id) DO NOTHING` — claim lại sau requeue không nhân đôi |
Rồi XADD `job.result{output:{kind:"text", text}, usage{input_tokens, output_tokens}, session_resumed:false}` hoặc `job.failed{status, code, reason, message, usage}`; `message` là câu tĩnh theo mã (như H1 `outcome.py`), không chép thân lỗi Dify. **Không** đụng `provider_state` (lỗi Dify là lỗi của workflow, không phải provider hỏng).

### 3.8 Orphan / requeue (AC-W06)
Runtime chết giữa job → heartbeat dừng → sweeper (Hub hoặc Runtime khác, H1-DB §5.5) chạy SQL quét **mới của BE**: `workflow.async` ∧ `attempts < 3` ∧ (`dispatched_at IS NULL`) → `queued` (`worker_id`, `heartbeat_at`, `started_at` NULL), không XADD `job.failed`; còn lại → `failed orphaned` như H1. Bên Runtime: `sweep_orphans`/`restart_orphans` nhận cột mới `requeued` (bool) trong `RETURNING` → chỉ XADD `job.failed` khi `requeued=false`. Claim lại: SQL claim H1 (đã `attempts + 1`) → `job.started` lần nữa (Hub phải chịu `job.started` lặp — §9 R7).

## 4. MCP Hub cho agent CLI (WRK-FR-13, R18–R20, AC-H12)

### 4.1 Ràng buộc từ H1
Spike PY-02 S3 + `options.py`: `strict_mcp_config=True` (chỉ MCP truyền qua `mcp_servers`, bỏ `.mcp.json`/settings/plugin [V `types.py` 2018]) và env `ENABLE_CLAUDEAI_MCP_SERVERS=false` (tắt connector claude.ai [V spike #2a]). **Giữ cả hai**; MCP Hub đi vào qua đúng cơ chế cho phép tường minh `mcp_servers`. Hook H1 deny mọi `mcp__*` (`_DENIED_PREFIXES`) → mở **có kiểm soát** theo `payload.mcp.tools`.

### 4.2 Cấu hình SDK (`providers/claude/mcp.py` mới + `options.py`)
| Mục | Giá trị |
|---|---|
| Khi nào | `payload.output == "agent_result"` ∧ `payload.mcp is not None` ∧ không phải lần thử lại định dạng (lần thử lại `tools=[]`, **không MCP** — tránh gọi lại tool `side_effect`, WRK-BR-04). Orchestrator (`output="text"`) có `mcp` ≠ null → bỏ qua + log `warn` |
| Tên server | `"hub"` (hằng `MCP_SERVER`) → tool trong CLI `mcp__hub__<workflow_key>` [CX chuẩn hoá ký tự] |
| `mcp_servers` | `{"hub": {"type": "http", "url": payload.mcp.url, "headers": {"Authorization": "Bearer <token>"}}}` (`McpHttpServerConfig` [V `types.py` 640]) |
| Truyền token | Dict trong `ClaudeAgentOptions` bị SDK chuyển thành `--mcp-config <json>` trên **argv** của CLI [V `subprocess_cli.py` 667–692] ⇒ token đọc được qua `/proc/<pid>/cmdline`. Chọn: cha (`HostProcess`) ghi file `AGENT_RT_WORK_DIR/.mcp/<job_id>.json` (0600, **ngoài** `work/<job_id>/` ⇒ hook deny đọc — nhãn `other_job`), `ChildRequest.mcp_config_path`; `mcp_servers=<path>` (SDK nhận `str \| Path` [V 2010]); xoá file trong `finally` của lần chạy + cleanup 24 h. Dự phòng nếu spike thấy file không nạp header: dict (argv) — rủi ro chấp nhận vì token chỉ sống khi job `running`, cùng user |
| `allowed_tools` | `tools` + `[f"mcp__hub__{k}" for k in payload.mcp.tools]` (tự duyệt dưới `permission_mode="dontAsk"`; thiếu ⇒ bị từ chối [V H1 S3 docs]) |
| `tools` (`--tools`) | giữ `payload.allowed_tools` — chỉ lọc tool dựng sẵn [CX: không ẩn tool MCP; spike H1 #2a thấy MCP vẫn nạp khi `tools=[]`] |
| `disallowed_tools` | giữ `KNOWN_TOOLS − tools` (không chứa tên MCP) |
| `system_prompt` | thêm `MCP_BLOCK` (Runtime, sau `FORMAT_BLOCK`): "Tool trả lỗi có `code: CONFIRMATION_REQUIRED` → dừng, trả `need_input` với đúng `question` và `choices` trong lỗi" |
| Env job host | thêm `NO_PROXY=localhost,127.0.0.1` [CX cần?]; không thêm biến khác |

### 4.3 Hook sandbox (`sandbox/hook.py`)
| Đổi | Luật |
|---|---|
| `SandboxPolicy.mcp_tools: frozenset[str]` (mặc định rỗng) | = tên đầy đủ `mcp__hub__<k>` của `payload.mcp.tools`; `options.policy_of` điền; `fake-cli` điền như nhau |
| `decide` | thứ tự: `StructuredOutput` (như H1) → **`tool_name ∈ policy.mcp_tools` ⇒ allow, không kiểm đường dẫn** (đối số đi tới Hub/Dify, không chạm FS của máy Worker; khoá `*path*` trong input workflow không bị hiểu nhầm) → `mcp__*` khác ⇒ deny `tool_not_allowed` → luật H1 |
| Tool MCP phụ CLI tự thêm (`ListMcpResourcesTool`, `ReadMcpResourceTool` [CX]) | không trong `tools` ⇒ deny (luật H1) |
| Log | như H1: chỉ `tool_name`, nhãn, `job_id` — không log `tool_input` |
Hai hàng rào: Hub `/mcp` chỉ nhận tool ∈ `payload.mcp.tools` ∩ enabled (R19) **và** hook Runtime.

### 4.4 Sự kiện và tiến độ
`ToolUseBlock` tên `mcp__hub__<k>` → `job.progress{"Đang gọi công cụ"}` (nhãn tĩnh, không tên workflow — H1-R26); đếm `tool_use` như H1 (WRK-BR-04: đã gọi tool ⇒ không chạy lại từ history).

### 4.5 Lỗi MCP
Hub không tới được / 401 khi CLI khởi tạo: CLI vẫn chạy, tool không có [CX: dạng `SystemMessage(init).data["mcp_servers"][].status`]. Runtime log `warn job.mcp_unavailable{status}` từ init, không fail job (agent tự trả `partial`/`done`). Token hết hạn giữa chừng (job hết `running`) → tool lỗi, job đằng nào cũng đang bị huỷ.

### 4.6 Spike PY-S1 (CLI thật trong WSL, sau Gate, trước PY-04)
Script `apps/agent-runtime/spikes/mcp_spike.py` + server MCP giả tối thiểu (stdlib `http.server`, JSON-RPC `initialize`/`tools/list`/`tools/call`, response `application/json`, log header) — không cần Hub. Ngân sách ≤ 6 lượt model. Ghi kết quả vào `spike-mcp.md` (phụ lục).

| # | Thử | Quyết định phụ thuộc |
|---|---|---|
| 1 | `mcp_servers=<path file>` + `strict_mcp_config=True` + `ENABLE_CLAUDEAI_MCP_SERVERS=false`: init `mcp_servers=[hub: connected]`, tools có `mcp__hub__*`, **không** connector claude.ai; header `Authorization` tới server | §4.2 truyền token (file vs argv) |
| 2 | `tools=["Read"]` có ẩn tool MCP không | §4.2 `tools` |
| 3 | `allowed_tools` thiếu/có `mcp__hub__x` dưới `dontAsk` | §4.2 |
| 4 | Hook nhận `tool_name`, `tool_input` (= `arguments`) cho tool MCP; deny chặn thật | §4.3 |
| 5 | Chuẩn hoá tên: key có `-`, `_`, `.` | §9 R10 (regex key) |
| 6 | CLI có thêm `ListMcpResourcesTool`/`ReadMcpResourceTool` không | §4.3 |
| 7 | Tool trả `isError:true` + text JSON `CONFIRMATION_REQUIRED` → `UserMessage` `ToolResultBlock(is_error, content)` thấy được; model có trả `need_input` theo `MCP_BLOCK` | §5 |
| 8 | Server trả JSON thường (không SSE) cho `POST`, không hỗ trợ `GET` (405) — CLI chấp nhận? `protocolVersion` CLI gửi | `plan.md` Q8 (MCP server tự viết) |
| 9 | Server tắt / 401 lúc init | §4.5 |
| 10 | `ps -o args` của CLI khi dùng file: không thấy token | §4.2 |

## 5. Xác nhận `side_effect` phía agent CLI (HUB-FR-95, R21–R22, AC-H22)
Thẩm quyền là **Hub** (`/mcp` không gọi Dify khi chưa có xác nhận `confirmed` cho (flow, agent, workflow); tiêu thụ nguyên tử). Runtime bảo đảm **kết quả job** là `need_input` khi Hub đã từ chối, không phụ thuộc model tuân lệnh.

| Bước | Cơ chế | File |
|---|---|---|
| 1 | Hub trả `tools/call` → `{isError:true, content:[{type:"text", text:<JSON {"code":"CONFIRMATION_REQUIRED","question","choices"}>}]}` (§9 R6) | Hub |
| 2 | `mapping.py`: `UserMessage` có `ToolResultBlock(is_error=True)` của tool_use id thuộc `mcp__hub__*` (nhớ id từ `ToolUseBlock`) và text parse được đúng hình → `Confirm{question, choices}` (ProviderEvent mới, `base.py`, `protocol.py`) | providers/claude |
| 3 | `HostProcess._on_event` ghi `seen.confirm` (giữ cái đầu) | runtimes/cli |
| 4 | `result.build_output`: `seen.confirm` ≠ None ∧ kết quả agent ≠ `need_input` → thay bằng `need_input{question, choices}` của Hub; log `info job.confirmation_forced` (không nội dung). Có `need_input` của model → giữ (model đã hỏi) | runtimes/cli/result.py |
| 5 | Không resume/không retry sau khi có `Confirm` (lượt sau là run mới của flow, có session) | job_run |
| 6 | Hub map `need_input` → SSE `ask` (H1-R08); tin kế "Đồng ý" → `confirmed` → run kế gọi lại tool | Hub |
Hook **không** chặn tool `side_effect` (Runtime không biết cờ, không cần): chặn ở Hub là một nguồn sự thật, tránh hai luật lệch.

## 6. `fake-cli` (PY-06, spec §7; nền `H1 plan-runtime-fake.md` §7)
Giữ nghĩa H1 của `#fake:tool=<name>` khi **không** khớp MCP (P19, test H1 không đổi). Thêm:

| Chỉ thị | Hành vi |
|---|---|
| `#fake:tool=<key>` với `payload.mcp` ≠ null ∧ `key ∈ payload.mcp.tools` | phát `tool_use{mcp__hub__<key>}` → `path_guard` (policy có `mcp_tools`) → deny: `done{"denied:<reason>"}` · allow: JSON-RPC thật tới `payload.mcp.url` bằng httpx2 (`initialize` → `tools/call{name:key, arguments}`; `Authorization: Bearer token`; timeout 30 s) |
| `#fake:args=<json>` | `arguments` (JSON không khoảng trắng, regex H1 `\S+`); thiếu → `{}`; JSON hỏng → `done{"bad_args"}` |
| `#fake:mcp-list` | `tools/list` → `done{text: "tên1,tên2"}` + mô tả tool đầu (AC-H12, HUB-H2a-AC-05) |
| Kết quả `tools/call` | `isError` + `CONFIRMATION_REQUIRED` → phát `Confirm` → `need_input{question, choices}` (đi qua bước 4 §5 như thật) · `isError` khác → `done{"tool_error"}` · thành công → `done{text}` · HTTP 401 → `done{"mcp_unauthorized"}` · lỗi mạng → `done{"mcp_unreachable"}` |
`fake-cli` chạy trong job host (process con): import httpx2 được (không phải `config/db/events`); token MCP là quyền được cấp cho job (WRK-FR-26), không phải secret hệ thống.

## 7. Test và giả lập
| Mức | Gì | Mock |
|---|---|---|
| unit | `stream.reduce` (bảng sự kiện workflow/chat, rỗng → `outputs[field]`, `failed`), `policy.retry_delay` (bảng §3.4), `map_failure`, `usage_row` (USD/khác/thiếu), `mask` (thô/base64/hex), hook MCP (allow đúng tên, deny tên lạ/`mcp__other__x`, không kiểm path), `mapping` → `Confirm`, `build_output` ép `need_input`, `mcp.py` dựng options + file 0600 | — |
| unit (HTTP) | `DifyClient`, `fetch_credential` | `httpx2.MockTransport` (SSE theo kịch bản) |
| int `*_int_test.py` | HUB-H2a-AC-06 (503×2 → OK, 3 lời gọi, khoảng ≥ backoff rút gọn; 400 không retry; `side_effect` + 503 → không retry), huỷ ≤ 5 s + stop, timeout + stop, NOT_CONFIGURED từ credential, usage 1 dòng `billing=dify`; HUB-H2a-AC-04 (`LEAK_KEY_…` không có trong `jobs`, `usage_logs`, Redis stream, log JSON Runtime, file log job); AC-W06 (job đang chạy, kill -9 Runtime con → đặt `heartbeat_at` lùi 61 s → sweeper → `queued` → Runtime mới claim → `succeeded`, `attempts=2`; `side_effect` + `dispatched_at` → `failed orphaned`) | `tests/support/dify_mock.py`: server `asyncio` stdlib (không thư viện mới) chạy trong process test: `/workflows/run`, `/chat-messages` SSE, `/…/stop`, kịch bản theo `inputs.scenario` hoặc biến điều khiển (`ok`, `slow`, `5xx:n`, `400`, `failed`, `empty`, `usage`), ghi nhận request (header, body, thời điểm); `/internal/jobs/{id}/dify-credential` trả `{base_url: mock, api_key: "LEAK_KEY_…", app_type}` |
| int CLI | `fake-cli` + MCP: server JSON-RPC giả trong `tests/support/mcp_mock.py` (stdlib) — token đúng/sai, `CONFIRMATION_REQUIRED` | stdlib |
| acceptance (qc, TS) | AC-H22, AC-H12, HUB-H2a-AC-05 dùng Hub thật + `fake-cli` + Runtime thật (Python chỉ cung cấp chỉ thị §6) | mock Dify của Hub (Q9) |
Mock Dify Python **không** thay mock của Hub (Q9): Python int không cần Hub chạy. Hai mock phải cùng hình sự kiện — QC đối chiếu bằng một bảng fixture sự kiện chung trong test-plan (đề xuất).

Env test: `AGENT_RT_DIFY_BACKOFF_S=0.2,0.8`, `AGENT_RT_HUB_URL=http://127.0.0.1:<port mock>`.

## 8. Thư viện — ADR-0010 (Proposed)
Cần HTTP client async + SSE cho Dify, endpoint credential và `fake-cli` → MCP. **httpx2 2.13.1** đã có trong `uv.lock` (bắc cầu: `claude-agent-sdk` → `mcp 2.3.0` → `httpx2`), có sẵn `EventSource` (SSE, gốc httpx-sse), `MockTransport`, `AsyncClient`. Đề xuất khai báo **trực tiếp** `httpx2>=2.13,<3` (cùng khoảng `mcp` cần, không thêm gói vào lock). Chi tiết so sánh: `docs/adr/0010-agent-runtime-httpx2.md`. Có ADR thư viện ⇒ Gate trình người dùng (Luật 2b).

Env mới (`config.py`, cha): `AGENT_RT_HUB_URL` (bắt buộc khi `dify` ∈ `AGENT_RT_PROVIDERS`; dev `http://localhost:4000`) · `AGENT_RT_DIFY_BACKOFF_S` (`2,8`) · `AGENT_RT_DIFY_READ_TIMEOUT_S` (30) · `AGENT_RT_DIFY_STOP_TIMEOUT_S` (2). Không env chứa app-key. `deploy/ai-worker.env.example` thêm `AGENT_RT_HUB_URL`.

## 9. Yêu cầu gửi plan BE (contract/DB — chưa đối chiếu)
| # | Yêu cầu | Mặc định Runtime dùng nếu BE chưa chốt khác |
|---|---|---|
| R1 | `JobPayload` biến thể `workflow.async`: `v, type, job_id, run_id, step_id, tenant_id, user_id, conversation_id, flow_id, feature_id\|null, command_id\|null, workflow_id, workflow_key, provider_key:"dify", app_type: workflow\|chat\|agent, inputs: object (≤ 64 KB), query: string\|null, output_field: string\|null, dify_user: string (≤ 200), side_effect: bool, timeout_s (10–3600), job_token: string` (base64url 43 ký tự). **Không** `base_url`/key | tên như cột trái |
| R2 | `job.failed.code` thêm `NOT_CONFIGURED` (R11); `reason` không thêm (null) | — |
| R3 | `agent.cli.mcp`: `{url, token, tools: string[] (workflow key)} \| null`; regex `workflow_key` | `^[a-z][a-z0-9_-]{1,63}$` |
| R4 | DB: `jobs.type` + `workflow.async`; `jobs.agent_id` **nullable** (command không có agent; CHECK `type <> 'agent.cli' OR agent_id IS NOT NULL`); cột `jobs.dispatched_at timestamptz NULL`; provider seed `dify` (`kind='api'`, vendor thêm `dify`, `max_concurrency=5` — WRK-NFR-05); token job lưu hash (cột chung cho MCP và credential) | như cột trái |
| R5 | Endpoint Q5: `POST /internal/jobs/:job_id/dify-credential`, `Authorization: Bearer <job_token>`, hợp lệ chỉ khi job `running` ∧ token khớp hash ∧ `job_id` khớp; 200 `{base_url, api_key, app_type}` + `Cache-Control: no-store`; 401 (token/trạng thái); 409 `{code:"NOT_CONFIGURED"}`; không log body | như cột trái |
| R6 | MCP `tools/call` khi cần xác nhận: `isError:true`, `content[0].text` = JSON `{"code":"CONFIRMATION_REQUIRED","question":string,"choices":[string,string]}` (theo `locale`) | như cột trái |
| R7 | SQL quét orphan + Khởi động lại (H1-DB §5.4–5.5) cho `workflow.async`: `attempts < 3 ∧ dispatched_at IS NULL` → `queued` (xoá `worker_id, heartbeat_at, started_at, pgid`); `RETURNING …, requeued`; Hub chịu `job.started` lặp cho cùng job, không kết thúc run khi requeue | §3.8 |
| R8 | SQL Kết thúc biến thể Dify: `billing='dify'`, tham số `feature_id`, `model` NULL, `agent_id` NULL; SQL `mark_dispatched`: `UPDATE hub.jobs SET dispatched_at = now() WHERE id=$1 AND worker_id=$2 AND status='running'` | §3.7 |
| R9 | Timeout run async: Hub giữ hạn của run (`commands.timeout_s` từ lúc tạo run) qua các lần requeue; Runtime chỉ áp `payload.timeout_s` mỗi lần claim | như cột trái |
| R10 | Hub dựng `dify_user` (`<tenant_key>:<user_id>`) và đọc `side_effect` (R23) vào payload lúc tạo job | — |

## 10. Task PY (chèn khối PY `tasks.md`)
PY-00 → PY-S1 → (C2) → PY-01 → PY-02 → PY-03 → PY-04 → PY-05 → PY-06. Bảng đủ (Đọc, Rủi ro, File, Lệnh xong) ở `tasks.md`.

## 11. Câu hỏi còn lại (có mặc định)
| # | Câu hỏi | Mặc định |
|---|---|---|
| RQ1 | `workflow.async` chạy trong process cha (giữ app-key ở cha) hay process con như CLI | Process cha (§1): chỉ HTTP, cha đã cầm secret hệ thống; con chỉ cần khi chạy mã bên thứ ba |
| RQ2 | Token MCP truyền cho CLI qua argv (dict) hay file | File 0600 ngoài `work/<job_id>` (§4.2); spike PY-S1 #1, #10 quyết |
| RQ3 | Ai ép `need_input` khi có `CONFIRMATION_REQUIRED` | Hub chặn gọi Dify (thẩm quyền); Runtime ép kết quả job thành `need_input` (§5). BE có thể thêm kiểm `tool_confirmations.pending` của run khi nhận `job.result` (không bắt buộc) |
| RQ4 | Retry 429 của Dify | Không (BA chỉ lỗi mạng/5xx); `UPSTREAM_ERROR` |
| RQ5 | Lỗi đọc giữa stream sau sự kiện đầu (mất mạng) | Không retry, `UPSTREAM_ERROR`, gọi stop best-effort |
| RQ6 | Tiến độ lộ số bước | Chỉ số thứ tự, không tên node (§3.5) |
| RQ7 | Credential 401 sau claim (Hub coi job không `running`) | Coi như mất job, không ghi; nếu Hub chưa kết thúc job thì heartbeat/sweeper xử lý |
