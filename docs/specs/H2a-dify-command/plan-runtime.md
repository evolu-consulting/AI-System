# Plan · H2a · Agent Runtime Python (`apps/agent-runtime`)

Chủ: backend-lead (Runtime). Song song `plan.md` (Hub TS) — **contract `@ai/contracts/hub` + `hub-internal`, DB `hub.*` + SQL nguyên văn (`plan-db.md`), mã/lý do lỗi (`plan-errors.md`), endpoint nội bộ Q5, MCP server `/mcp` thuộc plan TS**; plan này dùng tên, đã đối chiếu `plan.md` §10 (2026-10-05, §9). Phụ lục: `plan-runtime-dify.md` (gọi Dify §3.2, retry §3.4, tiến độ §3.5, usage §3.7). Nền: H1 `plan-runtime.md` (**H1-PR**), `plan-db.md` (**H1-DB**), `spike-py02.md`, `smoke-i2.md`. Nguồn: spec §2 R12, R13, R15, R17–R22; §7; spec-decisions Q5, P4; BA-W §2, §5.1 FR-06/07, §5.2 FR-13, §10 AC-W06; CONVENTIONS §9.

Ký hiệu: **[V]** đã xác minh (mã nguồn SDK cài trong `.venv` ngày 2026-10-05 hoặc spike H1) · **[CX]** chưa xác minh → spike PY-S1 (§4.6).

## 1. Tổng quan thay đổi

| # | Việc | Mục | Task |
|---|---|---|---|
| 1 | Tách `runtimes/cli/job_run.py` (398/400) — không đổi hành vi | §2 | PY-00 |
| 2 | Bộ định tuyến job theo `type` (`agent.cli` → `CliJobHost`, `workflow.async` → `DifyJobHost`) | §3.1 | PY-03 |
| 3 | Job `workflow.async` chạy **trong process cha** (chỉ HTTP, không CLI, không process con) | §3 | PY-01…03 |
| 4 | Claim sinh token job + `token_hash` cho **mọi** job (RT1, P4) | §3.3 | PY-03 |
| 5 | Lấy app-key qua endpoint nội bộ Hub bằng token claim (Q5, RT2) | §3.3 | PY-02 |
| 6 | Requeue orphan `workflow.async` (R7, RT4): hai câu SQL | §3.8 | PY-03 |
| 7 | MCP Hub cho agent CLI (Claude Agent SDK `mcp_servers`, mở có kiểm soát trong hook) | §4 | PY-S1, PY-04 |
| 8 | `side_effect`: phát hiện `CONFIRMATION_REQUIRED` → ép `need_input` | §5 | PY-05 |
| 9 | `fake-cli` gọi `/mcp` thật | §6 | PY-06 |
| 10 | Thư viện HTTP: **httpx2** thành phụ thuộc trực tiếp → ADR-0010 Proposed | §8 | PY-02 |

Lý do `workflow.async` chạy trong process cha: không chạy mã/CLI bên thứ ba, chỉ gọi HTTP; process cha đã cầm secret hệ thống (DB/Redis) nên giữ app-key trong bộ nhớ cha không mở rộng bề mặt; huỷ = huỷ task asyncio (không process group). Giới hạn đồng thời = `providers.max_concurrency` của provider `dify` (WRK-NFR-05: 5) qua SQL claim sẵn có (H1-DB §5.4, P9).

## 2. Tách `job_run.py` (PY-00, nợ H1)

Hiện: `JobRun` gộp điều phối lần chạy (session, retry định dạng, áp kết quả) và giám sát process (spawn, pgid, đọc stdout, giết group, dọn cây). Tách **theo trách nhiệm, giữ nguyên API** `JobRun(host, job, payload, control).execute()` mà `runner.py` gọi.

| File | Giữ | Ước lượng |
|---|---|---|
| `runtimes/cli/job_run.py` | `StopControl`, `JobRun`: `execute`, `_retryable`, `_load_session`, `_use_history`, `_rebuild_from_history`, `_invalid_hint`, `_attempt` (gọi `HostProcess`), `_apply`, `_succeeded`, `_close`, `stopping` | ~170 dòng |
| `runtimes/cli/host_proc.py` (mới) | `HostProcess`: `_prepare_work`, `_open_stderr`, `_spawn`, `_record_pgid`, `_request`, `_supervise`, `_host_gone`, `_pipe_held`, `_stop_reader`, `_reader_done`, `_mark_exit`, `_read`, `_on_event`, `_kill`, `_extra`, `_kill_leftovers`; trạng thái `proc/pipe/out/tree/wait_since/killed` | ~240 dòng |

Luật: composition (`JobRun` giữ `self.proc_host: HostProcess`), không mixin; `HostProcess` nhận `JobRun` qua Protocol hẹp (`seen`, `deadline`, `control`, `stopping()`, `prompt/retry/resume_id`) để không vòng import. Docstring đầu module chuyển phần "v2 N1/N2" sang `host_proc.py`. Test hiện có (`test_job_run*.py`, `test_runner*.py`) **không sửa logic**, chỉ sửa đường import nếu monkeypatch trỏ hàm đã chuyển. Lệnh xong: toàn bộ `pytest` + `pytest -m int` H1 xanh (310 ca), `lint-imports`, `check:size`. Chỗ chèn MCP sau này: `HostProcess._request` (đường dẫn file cấu hình MCP — §4.2).

## 3. Job `workflow.async` (R12, R13, R15, WRK-FR-06/07, AC-W06)

### 3.1 Cây file mới
| File | Nội dung | Thuần? |
|---|---|---|
| `runtimes/dispatch.py` | `JobRouter(JobHost)`: đọc `job.payload["type"]` → host tương ứng; type lạ / payload sai schema → Kết thúc `failed` `INTERNAL_ERROR`/`invalid_payload` (như H1) | |
| `runtimes/dify/host.py` | `DifyJobHost`: validate payload (`JobPayloadWorkflowAsync` sinh từ C2), `bind_job`, credential (§3.3), vòng thử (`-dify` §3.4), huỷ/timeout (§3.6), kết thúc (`-dify` §3.7) | |
| `runtimes/dify/client.py` | `DifyClient`: `run_stream(cred, req) -> AsyncIterator[ServerSentEvent]` (httpx2 `EventSource`), `stop(cred, task_id, user)` | |
| `runtimes/dify/credential.py` | `fetch_credential(hub_url, job_id, token) -> DifyCredential \| CredentialError`; `DifyCredential.__repr__` che key | |
| `runtimes/dify/stream.py` | `StreamState` + `reduce(state, event) -> Step` (text, `task_id`, `first_seen`, `finished`, usage, progress), `final_text` | ✓ |
| `runtimes/dify/policy.py` | `retry_delay(...)`, `map_failure(...) -> (code, reason)` (= `plan-errors` §2), `usage_row(...)`, `mask(text, key)` | ✓ |
| `db/jobs_sql.py` (sửa) | `CLAIM_UPDATE` + `token_hash` (§3.3); `REQUEUE_ORPHANS`, `REQUEUE_RESTART` (§3.8) | |
| `db/workflow_sql.py` | `mark_dispatched`, INSERT usage `billing='dify'` (`-dify` §3.7) | |
| `tests/support/dify_mock.py` | mock Dify + endpoint credential của Hub (§7) | |

`-dify` = `plan-runtime-dify.md`. `main.py`: `make_host` trả `JobRouter({"agent.cli": CliJobHost(...), "workflow.async": DifyJobHost(...)})`. Import-linter: `agent_runtime.runtimes.dify` trong lớp `runtimes` (đã có), forbidden mới: `runtimes.dify` không import `providers`, `sandbox`, `runtimes.cli`. Claim job `dify` chỉ khi `dify` ∈ `AGENT_RT_PROVIDERS` (RT6); không đụng `provider_state` của `dify`.

### 3.3 Token job (RT1, P4) và app-key (Q5, R17, RT2)
| Bước | Chi tiết |
|---|---|
| 0 · claim | `claim_one` sinh `token = secrets.token_urlsafe(32)` (32 byte CSPRNG, base64url không padding, 43 ký tự) cho **mọi** job; `token_hash = hashlib.sha256(token.encode("ascii")).digest()` (32 byte, = `hashJobToken` TS). `CLAIM_UPDATE` (H1-DB §5.4 + RT1) = `UPDATE hub.jobs SET status='running', worker_id=$2, started_at=now(), heartbeat_at=now(), attempts=attempts+1, token_hash=$3 WHERE id=$1 AND status='queued'` (thứ tự tham số theo `jobs_sql.py`). `ClaimedJob.token: str = field(repr=False)` chỉ trong bộ nhớ cha; **không** log, không vào payload/`jobs`/XADD/argv. Process con chỉ thấy token qua file MCP 0600 (§4.2). Requeue xoá `token_hash` → claim sau sinh token mới |
| 1 | Trước lời gọi Dify đầu: `POST {AGENT_RT_HUB_URL}/internal/jobs/{job_id}/dify-credential`, `Authorization: Bearer <token claim>`, không body. URL gốc chỉ từ **env** (payload không có URL Hub/`base_url`/token) |
| 2 | 200 → `DifyCredential{base_url, api_key, app_type}` (`DifyCredentialResponseSchema`) trong bộ nhớ `DifyJobHost` tới hết lần claim; `__repr__`/`__str__` che `api_key`; không vào log, `jobs.result`, XADD, `error_message` |
| 3 | 409 `NOT_CONFIGURED` hoặc 401 → `job.failed{NOT_CONFIGURED, reason:"credential"}` (`plan-errors` §2), không retry; SQL Kết thúc có `worker_id` ∧ `status='running'` nên vô hại nếu job đã bị huỷ/lấy lại (0 dòng → bỏ qua như H1); log `warn job.credential_rejected{status}` · 5xx / lỗi mạng → thử lại như `-dify` §3.4 hàng "kết nối" (an toàn với `side_effect` vì chưa gửi Dify); hết lượt → `NOT_CONFIGURED`/`credential` |
| 4 | Che lộ: mọi chuỗi ra ngoài (thân lỗi Dify ≤ 300 ký tự vào log) qua `mask(text, api_key)` (thô, base64, hex → `***`). Logger `httpx2`, `httpcore2` đặt `WARNING` trong `log.py` |
| 5 | Lấy lại key mỗi lần claim (không giữ qua requeue) |

### 3.6 Huỷ, timeout, mất job, dừng process
| Nguồn (`JobControl.reason`, H1-PR §2.3) | Xử lý | Ghi |
|---|---|---|
| `cancel` (LISTEN `job_cancel` / heartbeat) | huỷ task stream (đóng response) → `stop(task_id)` nếu đã có `task_id` (2 s, lỗi bỏ qua) | `cancelled` + `job.failed{CANCELLED, cancelled}` ≤ 5 s |
| timeout: `asyncio.timeout(payload.timeout_s)` (1–600) quanh **cả** credential + các lần thử + backoff | như huỷ | `timed_out` + `job.failed{TIMEOUT, timeout}` |
| `lost` (heartbeat không trả job) | huỷ task, **không** gọi stop (worker khác có thể đang chạy lại), không ghi | — |
| `shutdown` (SIGTERM cha) | huỷ task, không gọi stop; cha chạy `REQUEUE_RESTART` rồi `RESTART_ORPHANS` H1 (§3.8) | — |
Hạn tổng của run do Hub giữ qua requeue (R9, plan §5.3); Runtime chỉ áp `payload.timeout_s` mỗi lần claim. Không process con ⇒ `jobs.pgid` NULL (SQL dọn bỏ qua kill khi NULL — đã có).

### 3.8 Orphan / requeue (AC-W06, R7, RT4)
Điều kiện requeue: `type='workflow.async'` ∧ `attempts < 3` ∧ `cancel_requested_at IS NULL` ∧ ¬(`side_effect` ∧ `dispatched_at IS NOT NULL`) — job không `side_effect` đã gửi Dify vẫn được chạy lại (AC-W06). **Không** có cột `requeued`: hai câu chạy nối tiếp trên cùng kết nối, câu requeue **trước**, câu `failed orphaned` H1 **sau** (job đã về `queued` không còn khớp).

| Hằng (`jobs_sql.py`) | SQL | Sau đó |
|---|---|---|
| `REQUEUE_ORPHANS` (sweeper, mỗi 10 s, trước `SWEEP_ORPHANS`) | nguyên văn `plan-db` §2 "Requeue orphan", ngưỡng heartbeat = `make_interval(secs => $1)` (cùng `orphan_s` với `SWEEP_ORPHANS`) | mỗi dòng: `pg_notify('job_enqueued', {v:1, job_id, provider_key:"dify"})`; **không** XADD; kill `pgid` nếu `worker_id` là mình (luôn NULL với `dify`) |
| `REQUEUE_RESTART` (khởi động lại / dừng, trước `RESTART_ORPHANS`) | cùng câu, điều kiện heartbeat thay bằng `worker_id = $1` | như trên |
Các dòng còn lại → `SWEEP_ORPHANS`/`RESTART_ORPHANS` H1 (XADD `job.failed` như H1). `ORPHAN_ONE` (host con chết) không áp cho `dify`. Claim lại: `CLAIM_UPDATE` (attempts + 1, token mới) → `job.started` lặp — Hub chấp nhận, không lọc `seq` (plan §5.3). Usage `ON CONFLICT (job_id) DO NOTHING`.

## 4. MCP Hub cho agent CLI (WRK-FR-13, R18–R20, AC-H12)

### 4.1 Ràng buộc từ H1
Spike PY-02 S3 + `options.py`: `strict_mcp_config=True` (chỉ MCP truyền qua `mcp_servers`, bỏ `.mcp.json`/settings/plugin [V `types.py` 2018]) và env `ENABLE_CLAUDEAI_MCP_SERVERS=false` (tắt connector claude.ai [V spike #2a]). **Giữ cả hai**; MCP Hub đi vào qua đúng cơ chế cho phép tường minh `mcp_servers`. Hook H1 deny mọi `mcp__*` (`_DENIED_PREFIXES`) → mở **có kiểm soát** theo `payload.mcp.tools`.

### 4.2 Cấu hình SDK (`providers/claude/mcp.py` mới + `options.py`)
| Mục | Giá trị |
|---|---|
| Khi nào | `payload.output == "agent_result"` ∧ `payload.mcp is not None` (`{url, tools: 1–20}`, RT8) ∧ không phải lần thử lại định dạng (lần thử lại `tools=[]`, **không MCP** — tránh gọi lại tool `side_effect`, WRK-BR-04). Orchestrator (`output="text"`) có `mcp` ≠ null → bỏ qua + log `warn` |
| Tên server | `"hub"` (hằng `MCP_SERVER`) → tool `mcp__hub__<workflow_key>` (key `^[a-z0-9-]{2,32}$`, có `-` [CX chuẩn hoá]) |
| `mcp_servers` | `{"hub": {"type": "http", "url": payload.mcp.url, "headers": {"Authorization": "Bearer <ClaimedJob.token>"}}}` (`McpHttpServerConfig` [V `types.py` 640]); token từ claim (§3.3), payload **không** có token |
| Truyền token | Dict trong `ClaudeAgentOptions` bị SDK chuyển thành `--mcp-config <json>` trên **argv** [V `subprocess_cli.py` 667–692] ⇒ lộ qua `/proc/<pid>/cmdline`. Chọn: cha (`HostProcess`) ghi `{"mcpServers": <dict trên>}` vào `AGENT_RT_WORK_DIR/.mcp/<job_id>.json` (0600, **ngoài** `work/<job_id>/` ⇒ hook deny đọc — nhãn `other_job`), `ChildRequest.mcp_config_path`; `mcp_servers=<path>` (SDK nhận `str \| Path` [V 2010]); xoá file trong `finally` của lần chạy + cleanup 24 h. Dự phòng nếu spike thấy file không nạp header: dict (argv) — rủi ro chấp nhận vì token chỉ sống khi job `running`, cùng user |
| `allowed_tools` | `tools` + `[f"mcp__hub__{k}" for k in payload.mcp.tools]` (tự duyệt dưới `permission_mode="dontAsk"`; thiếu ⇒ bị từ chối [V H1 S3 docs]) |
| `tools` (`--tools`) | giữ `payload.allowed_tools` — chỉ lọc tool dựng sẵn [CX: không ẩn tool MCP; spike H1 #2a thấy MCP vẫn nạp khi `tools=[]`] |
| `disallowed_tools` | giữ `KNOWN_TOOLS − tools` (không chứa tên MCP) |
| `system_prompt` | thêm `MCP_BLOCK` (sau `FORMAT_BLOCK`): "Tool trả lỗi có `code: CONFIRMATION_REQUIRED` → dừng, trả `need_input` với đúng `question` và `choices` trong lỗi" |
| Env job host | thêm `NO_PROXY=localhost,127.0.0.1` [CX cần?]; không thêm biến khác |

### 4.3 Hook sandbox (`sandbox/hook.py`)
| Đổi | Luật |
|---|---|
| `SandboxPolicy.mcp_tools: frozenset[str]` (mặc định rỗng) | = tên đầy đủ `mcp__hub__<k>` của `payload.mcp.tools`; `options.policy_of` điền; `fake-cli` điền như nhau |
| `decide` | thứ tự: `StructuredOutput` (như H1) → **`tool_name ∈ policy.mcp_tools` ⇒ allow, không kiểm đường dẫn** (đối số đi tới Hub/Dify, không chạm FS Worker) → `mcp__*` khác ⇒ deny `tool_not_allowed` → luật H1 |
| Tool MCP phụ CLI tự thêm (`ListMcpResourcesTool`, `ReadMcpResourceTool` [CX]) | không trong `tools` ⇒ deny (luật H1) |
| Log | như H1: chỉ `tool_name`, nhãn, `job_id` — không log `tool_input` |
Hai hàng rào: Hub `/mcp` chỉ nhận tool ∈ `payload.mcp.tools` ∩ enabled ∩ `agent_workflows` (R19) **và** hook Runtime.

### 4.4 Sự kiện và tiến độ
`ToolUseBlock` tên `mcp__hub__<k>` → `job.progress{"Đang gọi công cụ"}` (nhãn tĩnh — H1-R26, RT7); đếm `tool_use` như H1 (WRK-BR-04). Bước `tool` trong trace do Hub `/mcp` ghi (P11–P12), Runtime không ghi.

### 4.5 Lỗi MCP
Hub không tới được / 401 khi CLI khởi tạo: CLI vẫn chạy, tool không có [CX: dạng `SystemMessage(init).data["mcp_servers"][].status`]. Runtime log `warn job.mcp_unavailable{status}`, không fail job. Token hết hiệu lực giữa chừng (job hết `running` ⇒ Hub 401) → tool lỗi, job đằng nào cũng đang bị huỷ.

### 4.6 Spike PY-S1 (CLI thật trong WSL, chạy được ngay sau Gate, trước PY-04)
Script `apps/agent-runtime/spikes/mcp_spike.py` + server MCP giả tối thiểu (stdlib `http.server`, JSON-RPC `initialize`/`tools/list`/`tools/call`, response `application/json`, log header) — **không cần Hub/C2**. Ngân sách ≤ 6 lượt model. Kết quả → `spike-mcp.md` (phụ lục).

| # | Thử | Quyết định phụ thuộc |
|---|---|---|
| 1 | `mcp_servers=<path file>` + `strict_mcp_config=True` + `ENABLE_CLAUDEAI_MCP_SERVERS=false`: init `mcp_servers=[hub: connected]`, tools có `mcp__hub__*`, **không** connector claude.ai; header `Authorization` tới server | §4.2 truyền token (file vs argv) |
| 2 | `tools=["Read"]` có ẩn tool MCP không | §4.2 `tools` |
| 3 | `allowed_tools` thiếu/có `mcp__hub__x` dưới `dontAsk` | §4.2 |
| 4 | Hook nhận `tool_name`, `tool_input` (= `arguments`) cho tool MCP; deny chặn thật | §4.3 |
| 5 | Tên tool với key có `-` (`translate-en`) giữ nguyên | §4.2 tên tool |
| 6 | CLI có thêm `ListMcpResourcesTool`/`ReadMcpResourceTool` không | §4.3 |
| 7 | Tool trả `isError:true` + `content[0]` JSON `CONFIRMATION_REQUIRED` + `content[1]` câu chỉ dẫn + `structuredContent` → `ToolResultBlock(is_error, content)` thấy đủ hai khối text?; model thấy `structuredContent` không; có trả `need_input` theo `MCP_BLOCK` | §5 |
| 8 | Server trả JSON thường (không SSE), `GET` → 405, không `Mcp-Session-Id` — CLI chấp nhận?; `protocolVersion`/`server/discover` CLI gửi | `plan.md` P7 |
| 9 | Server tắt / 401 lúc init | §4.5 |
| 10 | `ps -o args` của CLI khi dùng file: không thấy token | §4.2 |

## 5. Xác nhận `side_effect` phía agent CLI (HUB-FR-95, R21–R22, AC-H22)
Thẩm quyền là **Hub** (`/mcp` không gọi Dify khi chưa có `confirmed` cho (flow, agent, workflow); tiêu thụ nguyên tử — `plan-db` §3). Runtime bảo đảm **kết quả job** là `need_input` khi Hub đã từ chối, không phụ thuộc model tuân lệnh. Hub không kiểm thêm khi nhận `job.result` (RQ3).

| Bước | Cơ chế | File |
|---|---|---|
| 1 | Hub trả `tools/call` → `{isError:true, content:[{type:"text", text: JSON.stringify({code:"CONFIRMATION_REQUIRED", question, choices})}, {type:"text", text:<câu chỉ dẫn>}], structuredContent:{…cùng object}}` (R6, plan §2.3, `plan-errors` §5) | Hub |
| 2 | `parse_confirmation(content) -> Confirm \| None` (thuần, `providers/base.py`, dùng chung `fake-cli`): duyệt khối text **theo thứ tự**, khối đầu `json.loads` được thành dict có `code == "CONFIRMATION_REQUIRED"`, `question` str 1–2 000, `choices` đúng 2 str → `Confirm{question, choices}`; khối khác (câu chỉ dẫn) và `structuredContent` bỏ qua; `content` dạng str → coi như một khối. `mapping.py`: `UserMessage` có `ToolResultBlock(is_error=True)` của tool_use id thuộc `mcp__hub__*` (nhớ id từ `ToolUseBlock`) → gọi hàm trên → ProviderEvent `Confirm` (mới, `base.py`, `protocol.py`) | providers |
| 3 | `HostProcess._on_event` ghi `seen.confirm` (giữ cái đầu) | runtimes/cli |
| 4 | `result.build_output`: `seen.confirm` ≠ None ∧ kết quả agent ≠ `need_input` → thay bằng `need_input{question, choices}` của Hub; log `info job.confirmation_forced` (không nội dung). Có `need_input` của model → giữ | runtimes/cli/result.py |
| 5 | Không resume/không retry sau khi có `Confirm` (lượt sau là run mới của flow, có session) | job_run |
| 6 | Hub map `need_input` → SSE `ask` (H1-R08); tin kế "Đồng ý"/"Agree" → `confirmed` → run kế gọi lại tool | Hub |
Hook **không** chặn tool `side_effect` (Runtime không biết cờ): chặn ở Hub là một nguồn sự thật.

## 6. `fake-cli` (PY-06, spec §7; nền `H1 plan-runtime-fake.md` §7)
Giữ nghĩa H1 của `#fake:tool=<name>` khi **không** khớp MCP (P19, test H1 không đổi). Thêm:

| Chỉ thị | Hành vi |
|---|---|
| `#fake:tool=<key>` với `payload.mcp` ≠ null ∧ `key ∈ payload.mcp.tools` | phát `tool_use{mcp__hub__<key>}` → `path_guard` (policy có `mcp_tools`) → deny: `done{"denied:<reason>"}` · allow: JSON-RPC thật tới `payload.mcp.url` bằng httpx2 (`initialize` → `tools/call{name:key, arguments}`; header `Authorization` đọc từ file `mcp_config_path` (§4.2); timeout 30 s) |
| `#fake:args=<json>` | `arguments` (JSON không khoảng trắng, regex H1 `\S+`); thiếu → `{}`; JSON hỏng → `done{"bad_args"}` |
| `#fake:mcp-list` | `tools/list` → `done{text: "tên1,tên2"}` + mô tả tool đầu (AC-H12, HUB-H2a-AC-05) |
| Kết quả `tools/call` | `isError` + `parse_confirmation` ≠ None → phát `Confirm` → `need_input{question, choices}` (qua bước 4 §5) · `isError` khác → `done{"tool_error"}` · thành công → `done{text}` · HTTP 401 → `done{"mcp_unauthorized"}` · lỗi mạng → `done{"mcp_unreachable"}` · JSON-RPC `error` (`-32602` Unknown tool) → `done{"tool_unknown"}` |
`fake-cli` chạy trong job host (process con): import httpx2 được (không phải `config/db/events`); token MCP là quyền được cấp cho job (WRK-FR-26), không phải secret hệ thống.

## 7. Test và giả lập
| Mức | Gì | Mock |
|---|---|---|
| unit | `stream.reduce`/`final_text` (bảng ca chung với `finalText` TS), `policy.retry_delay` (`-dify` §3.4), `map_failure` (= bảng `plan-errors` §2), `usage_row` (USD/khác/thiếu), `mask` (thô/base64/hex), hook MCP (allow đúng tên, deny tên lạ/`mcp__other__x`, không kiểm path), `parse_confirmation` (JSON đúng/sai hình/khối thứ 2/str), `build_output` ép `need_input`, `mcp.py` dựng options + file 0600, sinh token (43 ký tự, hash 32 byte = vector `hashJobToken`) | — |
| unit (HTTP) | `DifyClient`, `fetch_credential` (200/401/409/5xx) | `httpx2.MockTransport` |
| int `*_int_test.py` | claim ghi `token_hash` (32 byte, khớp sha256 token trong bộ nhớ); HUB-H2a-AC-06 (503×2 → OK, 3 lời gọi, khoảng ≥ backoff rút gọn; 400 không retry; `side_effect` + 503 → không retry), huỷ ≤ 5 s + stop, timeout + stop, credential 409/401 → `NOT_CONFIGURED`/`credential`, usage 1 dòng `billing=dify`; HUB-H2a-AC-04 (`LEAK_KEY_…` và token không có trong `jobs`, `usage_logs`, Redis stream, log JSON Runtime, file log job); AC-W06 (job đang chạy, kill -9 Runtime con → `heartbeat_at` lùi quá ngưỡng → `REQUEUE_ORPHANS` → `queued`, `token_hash`/`dispatched_at` NULL, không XADD → Runtime mới claim (token khác) → `succeeded`, `attempts=2`; `side_effect` + `dispatched_at` → `failed orphaned`; `attempts=3` → `failed orphaned`) | `tests/support/dify_mock.py`: server `asyncio` stdlib chạy trong process test: `/workflows/run`, `/chat-messages` SSE, `/…/stop`, kịch bản theo api key như mock Hub (`mk-ok`, `mk-503x<n>`, `mk-400`, `mk-failed`, `mk-empty`, `mk-slow-<ms>`, `LEAK_KEY_*` — RT9), ghi nhận request; `/internal/jobs/{id}/dify-credential` kiểm Bearer ↔ `token_hash` trong DB test, trả `{base_url: mock, api_key, app_type}` |
| int CLI | `fake-cli` + MCP: server JSON-RPC giả `tests/support/mcp_mock.py` (stdlib) — token đúng/sai, `CONFIRMATION_REQUIRED` đúng hình R6 | stdlib |
| acceptance (qc, TS) | AC-H22, AC-H12, HUB-H2a-AC-05 dùng Hub thật + `fake-cli` + Runtime thật (Python chỉ cung cấp chỉ thị §6) | mock Dify Hub (P15) |
Mock Dify Python **không** thay mock Hub (Q9); hai mock cùng tên kịch bản + hình sự kiện (RT9).

Env test: `AGENT_RT_DIFY_BACKOFF_S=0.2,0.8`, `AGENT_RT_HUB_URL=http://127.0.0.1:<port mock>`.

## 8. Thư viện — ADR-0010 (Proposed)
Cần HTTP client async + SSE cho Dify, endpoint credential và `fake-cli` → MCP. **httpx2 2.13.1** đã có trong `uv.lock` (bắc cầu: `claude-agent-sdk` → `mcp 2.3.0` → `httpx2`), có sẵn `EventSource`, `MockTransport`, `AsyncClient`. Đề xuất khai báo **trực tiếp** `httpx2>=2.13,<3` (không thêm gói vào lock). Chi tiết: `docs/adr/0010-agent-runtime-httpx2.md`. Có ADR thư viện ⇒ Gate trình người dùng (Luật 2b).

Env mới (`config.py`, cha): `AGENT_RT_HUB_URL` (bắt buộc khi `dify` ∈ `AGENT_RT_PROVIDERS`; dev `http://localhost:4000` = `HUB_PUBLIC_INTERNAL_URL` của Hub) · `AGENT_RT_DIFY_BACKOFF_S` (`2,8`) · `AGENT_RT_DIFY_READ_TIMEOUT_S` (30) · `AGENT_RT_DIFY_STOP_TIMEOUT_S` (2). Không env chứa app-key/token. `deploy/ai-worker.env.example` thêm `AGENT_RT_HUB_URL`. MCP dùng `payload.mcp.url` (Hub dựng), credential dùng env.

## 9. Yêu cầu gửi plan BE — đã đối chiếu `plan.md` §10
✓ = BE nhận nguyên · ✗ = BE đổi, Runtime theo cột "Chốt".
| # | Runtime đề xuất | | Chốt (Runtime làm theo) |
|---|---|---|---|
| R1 | Payload `workflow.async` phẳng, `timeout_s` 10–3600, `job_token` | ✗ | Tên trường ✓; `provider_key:"dify"`; `timeout_s` 1–600; `workflow_key` `^[a-z0-9-]{2,32}$`; **không** `job_token`/`base_url`/URL Hub (RT1, env) |
| R2 | `NOT_CONFIGURED`, không thêm reason | ✗ | `NOT_CONFIGURED` ✓ + reason `credential`, `upstream` (`plan-errors` §2) |
| R3 | `mcp = {url, token, tools}`, regex `^[a-z][a-z0-9_-]{1,63}$` | ✗ | `{url, tools: 1–20}`, không token (RT1); regex `CATALOG_KEY_RE` |
| R4 | `jobs.type`, `agent_id` nullable, `dispatched_at`, provider `dify`, `token_hash` | ✓ | CHECK `type='workflow.async' OR agent_id IS NOT NULL`; thêm `queued_at`; `max_concurrency` 5 |
| R5 | Credential `{base_url, api_key, app_type}`, 401, 409 | ✓ | Bearer = token claim (RT2) |
| R6 | `content[0].text` JSON `CONFIRMATION_REQUIRED` | ✓ | + `content[1]` câu chỉ dẫn + `structuredContent` (Runtime bỏ qua, §5) |
| R7 | Requeue `dispatched_at IS NULL`, cột `requeued` | ✗ | `attempts<3 ∧ ¬(side_effect ∧ dispatched_at)`; hai câu, không `requeued` (§3.8) |
| R8 | SQL usage `dify` + `mark_dispatched` | ✓ | `-dify` §3.4, §3.7 (RT5) |
| R9 | Hạn run giữ qua requeue | ✓ | plan §5.3 |
| R10 | Hub dựng `dify_user`, đọc `side_effect` | ✓ | — |

## 10. Task PY (chèn khối PY `tasks.md`)
PY-00, PY-S1 (ngay sau Gate, song song) → C2 → PY-01 → … → PY-06. Bảng đủ (Đọc, Rủi ro, File, Lệnh xong) ở `tasks.md`.

## 11. Câu hỏi còn lại (có mặc định)
| # | Câu hỏi | Mặc định |
|---|---|---|
| RQ1 | `workflow.async` chạy trong process cha hay process con | Process cha (§1) |
| RQ2 | Token MCP truyền cho CLI qua argv (dict) hay file | File 0600 ngoài `work/<job_id>` (§4.2); spike PY-S1 #1, #10 quyết |
| RQ3 | Ai ép `need_input` khi có `CONFIRMATION_REQUIRED` | ✓ chốt: Hub chặn gọi Dify, Runtime ép kết quả (§5); Hub không kiểm thêm |
| RQ4 | Retry 429 của Dify | Không; `UPSTREAM_ERROR`/`upstream` |
| RQ5 | Lỗi đọc giữa stream sau sự kiện đầu | Không retry, `UPSTREAM_ERROR`, stop best-effort |
| RQ6 | Tiến độ lộ số bước | Chỉ số thứ tự, không tên node |
| RQ7 | Credential 401 sau claim | ✓ đổi: `NOT_CONFIGURED`/`credential` (`plan-errors` §2); Kết thúc vô hại nếu job không còn của mình |
| RQ8 | `output_field = null` lấy khoá nào | `"text"` ở cả hai bên — `finalText` TS cần ghi rõ (plan §7) |
| RQ9 | `app_type` credential ≠ payload | `NOT_CONFIGURED`/`credential`, không gọi Dify |
