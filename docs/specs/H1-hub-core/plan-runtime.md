# Plan · H1 · Agent Runtime Python (`apps/agent-runtime`)

Chủ: backend-lead (Runtime). Song song với `plan.md` (Hub TS, cùng backend-lead khác) — **contract `@ai/contracts/hub`, schema `hub` + RLS + role `agent_rt`, nguyên văn SQL claim/heartbeat/finish/đếm slot thuộc `plan.md`**; plan này chỉ dùng tên và nêu yêu cầu ở §12. Nguồn: `spec.md` §2 (H1-R17…R26), §6, §7; `ba-worker.md` §3–§9; ADR-0007; `CONVENTIONS` §9; ADR-0008 (thư viện, Proposed).

Ký hiệu nguồn SDK: **[V]** = đã xác minh trong tài liệu/mã nguồn ngày 2026-10-04 (dẫn link) · **[CX]** = chưa xác minh → kiểm ở PY-02 (spike).
- [S1] https://code.claude.com/docs/en/agent-sdk/python · [S2] …/agent-sdk/hooks · [S3] …/agent-sdk/permissions · [S4] …/agent-sdk/sessions
- [S5] https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/transport/subprocess_cli.py · [S6] PyPI `claude-agent-sdk` 0.2.163

## 1. Cấu trúc và vòng đời

### 1.1 Cây `apps/agent-runtime/` (CONVENTIONS §9)
| Đường dẫn | Nội dung | Ghi chú |
|---|---|---|
| `pyproject.toml` · `uv.lock` · `package.json` | deps (ADR-0008), cấu hình ruff/pyright (`strict`, `pythonPlatform="Linux"`)/pytest/import-linter; scripts `dev/check/typecheck/test/test:int` | |
| `deploy/ai-worker.service` · `deploy/ai-worker.env.example` | unit systemd + mẫu env (không secret thật) | §1.3 |
| `src/agent_runtime/main.py` | điểm vào `python -m agent_runtime` (§1.5) | |
| `config.py` | `Settings` (pydantic-settings), env §1.4 | **chỉ process cha** import |
| `log.py` | structlog JSON + `bind_job(job_id, run_id, tenant_id)` (contextvars) | §9 |
| `db/` | `pool.py` (asyncpg pool + kết nối LISTEN riêng) · `jobs_sql.py` · `usage_sql.py` · `sessions_sql.py` · `provider_state_sql.py` · `agent_types_sql.py` | SQL nguyên văn lấy từ `plan.md` |
| `queue/` | `claimer.py` (vòng claim) · `listener.py` (LISTEN `job_enqueued`, `job_cancel`) · `heartbeat.py` · `sweeper.py` (orphaned, hết `max_wait_s`) · `supervisor.py` (bảng job đang chạy trong process: job_id → `JobHandle`) | |
| `events/` | `stream.py`: `XADD run:<run_id>` + `EXPIRE` 24 h | |
| `runtimes/cli/` | `runner.py` (cha: spawn process con, đọc giao thức, áp kết quả) · `child.py` (con: chạy provider, `python -m agent_runtime.runtimes.cli.child`) · `protocol.py` (pydantic: `ChildRequest`, `ChildEvent`) · `result.py` (validate `AgentResult`/`OrchestratorDecision` + retry) · `prompt.py` (system prompt định dạng, dựng history) | |
| `providers/` | `base.py` (`Provider` Protocol) · `claude/{options.py,messages.py,ratelimit.py}` · `fake/{provider.py,directives.py}` · `registry.py` (lọc `fake-cli` theo `APP_ENV`) | |
| `sandbox/` | `paths.py` (luật thuần `is_path_allowed`) · `hook.py` (callback `PreToolUse`) · `process.py` (killpg, kiểm group, dọn pgid sót) · `env.py` (env tường minh cho con) | |
| `agents/` | registry loại agent → manifest `agent_types` | |
| `contracts/` | pydantic sinh (C2), không sửa tay | |

**Chiều import (import-linter):** `main → queue → runtimes → providers → sandbox → contracts`; `db`, `events` chỉ được `main/queue/runtimes.cli.runner` import. **Forbidden:** `agent_runtime.runtimes.cli.child`, `providers`, `sandbox` không import `config`, `db`, `events` (process con không cầm secret — WRK-BR-02).

### 1.2 Mô hình process (quyết định chính)
| Mức | Process | Group | Cầm |
|---|---|---|---|
| 1 | Runtime (cha, systemd) | group của systemd | DB/Redis URL, pool, Redis |
| 2 | **Job host** — mỗi job một `python -m agent_runtime.runtimes.cli.child`, `asyncio.create_subprocess_exec(..., start_new_session=True, env=<tường minh>, cwd=work/<job_id>)` | **group mới, pgid = pid con** | chỉ `ChildRequest` (stdin JSON) |
| 3 | CLI Claude do SDK sinh trong job host; process cháu (rg…) | cùng group với job host [CX: CLI có sinh con `detached` không] | — |

Lý do: SDK **không** đặt `start_new_session` và env con = `os.environ` (bỏ `CLAUDECODE`) + `CLAUDE_CODE_ENTRYPOINT` + `options.env` [V S5]; `options.env` chỉ **gộp** vào env kế thừa [V S1]. Đặt SDK trong job host có env sạch ⇒ CLI không thể kế thừa secret, và huỷ = `killpg(pgid)` của job host hạ cả cây. Loại: (a) SDK trong process cha → CLI mang secret, không pgid; (b) `cli_path` = script `setsid env -i …` [CX] — dự phòng; (c) `Transport` tự viết — "low-level internal API… may change" [V S1].

Giao thức cha↔con: stdin = 1 dòng JSON `ChildRequest` (payload contract + `work_dir`, `log_paths`, `mode`); stdout = JSON lines `ChildEvent` (`progress{label}`, `tool_use{name}`, `session{session_id}`, `rate_limit{status,resets_at}`, `usage{in,out,cache_read,cache_write,model}`, `final{kind, raw_json|null, structured|null, is_error, subtype, api_error_status, errors[]}`, `fatal{code,msg}`); stderr con → file log job (§9). Cha validate từng dòng bằng pydantic; dòng hỏng → `fatal`.

### 1.3 Chạy trong WSL2 (CR-029, Q5)
| Mục | Giá trị |
|---|---|
| Máy | Windows: `.wslconfig` `networkingMode=mirrored`, `vmIdleTimeout=-1`; Ubuntu: `/etc/wsl.conf` `[boot] systemd=true`; user `worker` |
| Mã | prod: `/home/worker/ai-system` (ổ Linux) · dev: từ `/mnt/d/...` được, venv ở `UV_PROJECT_ENVIRONMENT=$HOME/.venvs/agent-runtime` |
| Unit `ai-worker.service` | `User=worker` · `WorkingDirectory=/home/worker/ai-system/apps/agent-runtime` · `EnvironmentFile=/etc/ai-worker.env` (0600) · `ExecStart=/home/worker/.local/bin/uv run --frozen python -m agent_runtime` · `Restart=always` `RestartSec=2` · `KillMode=control-group` · `KillSignal=SIGTERM` `TimeoutStopSec=15` · `NoNewPrivileges=yes` |
| Kết nối | `localhost:5432` (Postgres Docker trên Windows), `localhost:6379` (Redis); dự phòng: IP host trong env. PY-02 kiểm `pg_isready -h localhost` từ WSL [CX trên máy này] |
| CLI | dùng CLI đóng gói trong wheel SDK [V S6: wheel manylinux ~103 MB gồm CLI; `_find_cli` ưu tiên bản đóng gói rồi `which claude` — V S5]. Đăng nhập một lần `claude` (bản đóng gói, hoặc CLI cài riêng cùng `~/.claude`) dưới user `worker` [CX: bản đóng gói dùng chung `~/.claude/.credentials.json`] |

### 1.4 Env (process cha)
`APP_ENV` (development\|test\|production) · `AGENT_RT_DATABASE_URL` (role `agent_rt`) · `REDIS_URL` · `AGENT_RT_WORKER_ID` (mặc định `hostname`) · `AGENT_RT_PROVIDERS` (vd `claude-sub,fake-cli`) · `AGENT_RT_WORK_DIR=/home/worker/work` (validate: tuyệt đối, không dưới `/mnt/`) · `AGENT_RT_LOG_DIR=/home/worker/logs` · `AGENT_RT_POLL_S=1` · `AGENT_RT_HEARTBEAT_S=15` · `AGENT_RT_ORPHAN_S=60` · `AGENT_RT_KILL_GRACE_S=3` · `AGENT_RT_MAX_WAIT_S` (mặc định lấy từ payload/`providers`, env chỉ để test ghi đè) · `AGENT_RT_CLI_PATH` (tuỳ chọn).

### 1.5 Vòng đời process cha
| Pha | Việc |
|---|---|
| Khởi động | 1 config (sai → exit 2) · 2 log · 3 pool asyncpg + kết nối LISTEN · 4 Redis ping · 5 registry provider (`fake-cli` chỉ khi `APP_ENV`∈{development,test}, khác → bỏ + log `warn`; có trong `AGENT_RT_PROVIDERS` mà production → exit 2) · 6 manifest `agent_types` (§8) · 7 **dọn job sót** của `worker_id` mình (§2.4) · 8 LISTEN · 9 chạy task: claimer, heartbeat, sweeper, log-cleanup |
| Chạy | `asyncio.TaskGroup`; task chết → log `error`, exit 1 (systemd chạy lại) |
| SIGTERM | ngừng claim → huỷ job đang chạy (§2.3, `failed reason=worker_shutdown`, XADD `job.failed INTERNAL_ERROR`) → exit 0 trong ≤ 10 s |

## 2. Hàng đợi, heartbeat, orphaned, timeout, cancel

### 2.1 Vòng claim (WRK-FR-01, 20, 24, BR-05; WRK-NFR-01 ≤ 2 s)
| Bước | Chi tiết |
|---|---|
| Đánh thức | `LISTEN job_enqueued` (chỉ là tín hiệu) **hoặc** poll mỗi `AGENT_RT_POLL_S`=1 s |
| Claim | **SQL claim của `plan.md`** (advisory lock provider → đếm `running` provider + tenant, đọc `max_concurrent_sub` trong cùng transaction nên không cần cache → `SKIP LOCKED` → `running` + `worker_id`). Lặp tới khi rỗng |
| Lọc (trong SQL) | provider của registry (`= ANY($providers)`); bỏ job có `(conversation_id, agent_id)` đang `running` (BR-05) |
| Sau claim | ghi `jobs.pgid` sau spawn (SQL `plan.md`); `bind_job`; XADD `job.started` (`plan.md` §2.3) |
| Hết chờ (`max_wait_s`) | mỗi vòng poll gọi **SQL expire của `plan.md`**: job `queued` quá `max_wait_s` → `failed` (`reason=tenant_slots`\|`provider_busy`), provider `cooldown/logged_out/error` → `failed` ngay; mỗi job → XADD `job.failed{ALL_PROVIDERS_EXHAUSTED, reason}` (H1-R18) |
| LISTEN rớt | mở lại sau 1 s (lũy thừa tới 10 s); vẫn poll |

### 2.2 Heartbeat, orphaned (WRK-FR-02, 23, BR-04, H1-R20)
| Việc | Chu kỳ | Cách |
|---|---|---|
| Heartbeat | 15 s | một câu SQL `plan.md` cập nhật `heartbeat_at` cho mọi job `running` của `worker_id`, **trả về** job có `cancel_requested_at` ≠ null → huỷ (dự phòng mất `job_cancel`, WRK-FR-05) |
| Orphaned sweeper | 15 s | SQL `plan.md`: `running` ∧ `heartbeat_at < now()-60 s` → `orphaned` → `failed(orphaned)` (mọi worker, idempotent); XADD `job.failed{INTERNAL_ERROR}` |
| Khởi động lại | 1 lần | §2.4 |

### 2.3 Cancel / timeout (WRK-FR-04, 05, NFR-06, AC-W03, W10, AC-H06)
| # | Bước | Ngưỡng |
|---|---|---|
| 1 | Nguồn: `LISTEN job_cancel` (payload chứa `job_id` — `plan.md`) · heartbeat trả `cancel_requested_at` · timeout `asyncio.timeout(timeout_s)` quanh `runner.run()` · SIGTERM của cha | — |
| 2 | Nếu job không thuộc `supervisor` của process này → bỏ qua (job `queued` do Hub/SQL tự chuyển `cancelled` — `plan.md`) | — |
| 3 | `os.killpg(pgid, SIGTERM)` | t=0 |
| 4 | Chờ job host thoát (`proc.wait`) tối đa `KILL_GRACE_S`=3 s | ≤ 3 s |
| 5 | `os.killpg(pgid, SIGKILL)` (bỏ qua `ProcessLookupError`) | t≈3 s |
| 6 | Xác nhận: quét `/proc/*/stat` trường `pgrp == pgid`, lặp 100 ms tới 1,5 s; còn pid → SIGKILL từng pid + log `error` `pg_leak` | ≤ 4,5 s |
| 7 | SQL finish `plan.md`: `cancelled` / `timed_out` (rời `running` ⇒ slot provider + tenant tự trả, WRK-FR-24) ; XADD `job.failed{CANCELLED\|TIMEOUT}` | ≤ 5 s |
| 8 | Không ghi `cli_sessions` khi cancel/timeout; vẫn ghi `usage_logs` nếu đã có `usage` | — |

Không dùng `interrupt()` (cần CLI hợp tác [V S1]); `close()` của SDK leo thang 5 s + 5 s + 5 s [V S5] > 5 s ⇒ cha kill group. Nếu PY-02 thấy CLI sinh con thoát group: dùng `PR_SET_CHILD_SUBREAPER` + quét cây `ppid`.

### 2.4 Dọn khi khởi động (H1-R20, HUB-H1-AC-04)
Đọc job `running` của `worker_id` mình (SQL `plan.md`) → với mỗi `pgid`: chỉ kill nếu `/proc/<pgid>/cmdline` chứa `agent_runtime.runtimes.cli.child` **và** `--job-id=<job_id>` (tránh pid tái dùng) → SIGTERM/SIGKILL như §2.3 → đặt `orphaned→failed(orphaned)` + XADD `job.failed INTERNAL_ERROR`. Thư mục `work/<job_id>/` giữ lại cho cleanup 24 h.

## 3. Runtime `agentic-cli` với Claude Agent SDK Python

### 3.1 API dùng
| Mục | API | Nguồn |
|---|---|---|
| Gọi | `query(*, prompt: str \| AsyncIterable[dict], options, transport=None) -> AsyncIterator[Message]` | [V S1] |
| Client | ví dụ hook trong docs dùng `ClaudeSDKClient` (`await client.query(p)`; `async for m in client.receive_response()`); hook với `query()` [CX] → mặc định `ClaudeSDKClient` | [V S2] |
| `cwd` | `str\|Path` = `work/<job_id>` | [V S1] |
| `tools` | `list[str] \| ToolsPreset` — giới hạn tool có trong ngữ cảnh. Agent: `payload.allowed_tools` (mặc định `["Read","Grep","Glob"]`); Orchestrator: `[]` [CX: `[]` = không tool] | [V S1] |
| `allowed_tools` | chỉ **tự duyệt**, không giới hạn tool tồn tại [V S3]. Đặt = `tools` | [V S3] |
| `disallowed_tools` | tên trần xoá tool khỏi request. Đặt `["Bash","Write","Edit","NotebookEdit","WebFetch","WebSearch","Agent","Task"] − allowed` | [V S3] |
| `permission_mode` | `"dontAsk"` — mọi thứ cần hỏi bị từ chối, không gọi `can_use_tool`; **không** dùng `bypassPermissions` | [V S3] |
| `hooks` | `{"PreToolUse": [HookMatcher(matcher=None, hooks=[path_guard], timeout=10)]}`; hook chạy **trước** mọi bước khác, `deny` thắng cả `bypassPermissions` | [V S2, S3] |
| Trả deny | `{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": "path_not_allowed"}}` | [V S2] |
| Input hook | `tool_name`, `tool_input`, `tool_use_id`, `session_id`, `cwd`, `agent_id?` (subagent) | [V S2] |
| `setting_sources` | `[]` để không nạp `~/.claude/settings.json` (hook/allow rule của user) [CX: list rỗng ⇒ `--setting-sources=` không nạp gì] | [V S5] cờ CLI |
| `resume` / `fork_session` | `resume=<session_id>` (cờ `--resume=`); không fork | [V S1, S5] |
| `max_turns` | agent: `payload.max_turns` hoặc 30; Orchestrator: 3 [CX: structured output có tốn turn] | [V S1] |
| `model` | `profile_step.model` nếu có, không thì mặc định CLI | [V S1] |
| `env` | `{}` (env sạch đã đặt ở job host); `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1` cho Orchestrator (không ghi transcript) | [V S4] |
| `system_prompt` | `str` = system prompt agent + khối định dạng (§4) | [V S1] |
| `output_format` | `{"type":"json_schema","schema": <JSON Schema AgentResult \| OrchestratorDecision>}` → `ResultMessage.structured_output`; hết lượt sửa → `subtype="error_max_structured_output_retries"` | [V S1] |
| `stderr` | callback ghi file log job | [V S1] |
| `max_budget_usd` | không đặt (subscription) | [V S1] |
| `sandbox` (`SandboxSettings`) | H1 không dùng (spec Q10: chỉ hook) | [V S1] |

### 3.2 Map message → ChildEvent
| Message SDK | Dùng |
|---|---|
| `SystemMessage(subtype="init", data)` | `data["session_id"]` → `session` sớm [V S4: Python để trong `data`] |
| `AssistantMessage` có `ToolUseBlock` | `job.progress{message}` nhãn tĩnh theo tên tool (vd "Đang đọc tệp"), **không** kèm đường dẫn/nội dung (H1-R26); đếm `tool_use` (WRK-BR-04) |
| `RateLimitEvent(rate_limit_info: status, resets_at, rate_limit_type…)` | `status=="rejected"` → `rate_limit` [V S1] |
| `ResultMessage` | `session_id`, `usage{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`, `model_usage` (lấy key model), `is_error`, `subtype`, `structured_output`, `result`, `errors`, `api_error_status`, `terminal_reason` [V S1] |
| Ngoại lệ | `CLINotFoundError` → `fatal` + provider `error`; `ProcessError(exit_code, stderr)`; `ResultError(api_error_status, session_id)`; `CLIJSONDecodeError` [V S1] |

### 3.3 Rate limit / hết quota (WRK-FR-15, H1-R24, AC-W02)
| Tín hiệu (thứ tự) | Cooldown |
|---|---|
| `RateLimitEvent.status=="rejected"` | `resets_at` (Unix) nếu có, không thì now+30 phút |
| `ResultMessage.api_error_status==429` hoặc `errors`/`result` khớp `/(usage limit\|rate limit\|429)/i` | như trên (giờ reset parse từ text [CX định dạng]) |
| `ProcessError.stderr` khớp regex trên | now+30 phút |
| Lỗi xác thực (401, "/login", "not logged in") [CX chữ] | `provider_state=logged_out` |
| 3 lần `fatal`/`ProcessError` khác liên tiếp | `provider_state=error` (đếm `consecutive_errors`, về 0 khi job thành công) |
Áp: UPSERT `provider_state(provider_key, state='cooldown', cooldown_until)` (SQL `plan.md`), job `failed(reason=quota)`, XADD `job.failed{ALL_PROVIDERS_EXHAUSTED}` (profile 1 bước). Ngưỡng `allowed_warning` → chỉ log.

## 4. Kết quả có cấu trúc; Orchestrator vs agent
Phân biệt bằng `JobPayload.output` (`agent_result` \| `text`) + `use_session` (`plan.md` §2.2).

| Mục | `output="agent_result"` (agent) | `output="text"` (Orchestrator) |
|---|---|---|
| Tool / MCP | `tools=allowed_tools` (không Bash); MCP: H1 không | `tools=[]`, `disallowed_tools=["*"]`, không MCP |
| Session | §6 | không `cli_sessions`; `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1` |
| Ép định dạng | `output_format` = JSON Schema `AgentResult` (C2) + khối "chỉ trả MỘT đối tượng JSON" trong system prompt | không `output_format`; prompt (có schema `OrchestratorDecision`) do Hub dựng |
| Trích | `structured_output`, không có thì JSON cuối trong `result` (bóc ```json) → pydantic | `result` nguyên văn |
| Hỏng | thử lại **1 lần trong job**: `resume` session vừa tạo + nhắc định dạng kèm lỗi pydantic ≤ 300 ký tự (không chạy lại tool); vẫn hỏng → `job.failed{UPSTREAM_ERROR, reason:invalid_output}` (§12 R5) | Hub `parseDecision` + retry (H1-R06, `plan.md`) |
| XADD | `job.result{output:{kind:"agent_result", result}, usage, session_resumed}` | `job.result{output:{kind:"text", text}, usage}` |

Runtime không phát `delta`; Hub cắt (H1-R08, R09). [CX] `output_format` với `discriminatedUnion` → dự phòng schema phẳng `{status, text?, missing?, question?, choices?}` + pydantic chặt.

## 5. Sandbox (WRK-BR-07, BR-02, FR-11/12, H1-R21)

### 5.1 Luật thuần `sandbox/paths.py`
`is_path_allowed(raw: str, work_dir: Path, forbidden_roots: tuple[Path, ...]) -> PathDecision` — không I/O ngoài `os.path.realpath`.
| Bước | Luật |
|---|---|
| 1 | `raw` rỗng / chứa `\0` → deny |
| 2 | tương đối → nối với `work_dir` |
| 3 | `realpath(strict=False)` (theo symlink, kể cả symlink trỏ ra ngoài; thành phần chưa tồn tại giữ nguyên) |
| 4 | allow ⇔ kết quả == `realpath(work_dir)` hoặc bắt đầu bằng `realpath(work_dir) + "/"` |
| 5 | (thông tin log) nhãn lý do: `home` (dưới `$HOME` của `worker` — gồm `~/.claude`, `~/.codex`, `~/.gemini`), `mnt` (`/mnt/*`), `other_job` (dưới `AGENT_RT_WORK_DIR` nhưng job khác), `outside` |

### 5.2 Hook `PreToolUse` (`sandbox/hook.py`)
| Tool | Trường kiểm | Ghi chú |
|---|---|---|
| `Read`, `Write`, `Edit`, `NotebookEdit` | `file_path` (`notebook_path`) | [V S2: ví dụ docs dùng `file_path`] |
| `Glob`, `Grep` | `path` (thiếu = `cwd` ⇒ allow); `pattern`/`glob` tuyệt đối hoặc chứa `..` → kiểm như đường dẫn | [CX tên trường đầy đủ — PY-02 in `tool_input` thật] |
| `LS` và tool có trường tên chứa `path` | mọi giá trị chuỗi của khoá `*path*` | |
| Tool không có trong `tools` của job | deny `tool_not_allowed` (hàng rào thứ 2 sau `tools`/`disallowed_tools`) | |
| `Bash`, `mcp__*` (H1), `Agent`/`Task` | deny | |
Deny trả `permissionDecisionReason` cố định (`path_not_allowed`/`tool_not_allowed`) — **không** lặp lại đường dẫn; log `warn` chỉ `tool_name`, nhãn lý do, `job_id`. Hook lỗi bất ngờ → deny (fail-closed); `HookMatcher.timeout=10` (timeout ⇒ tool không chạy [V S2]).

### 5.3 Env job host (`sandbox/env.py`, WRK-BR-02)
Danh sách trắng duy nhất: `HOME=/home/worker` (CLI cần đọc phiên đăng nhập; tool vẫn bị hook chặn), `PATH=/usr/local/bin:/usr/bin:/bin`, `LANG=C.UTF-8`, `TMPDIR=work/<job_id>/.tmp`, `APP_ENV`, `PYTHONPATH`/`VIRTUAL_ENV` của venv, tắt auto-update/telemetry CLI [CX tên biến — tra https://code.claude.com/docs/en/env-vars ở PY-02]. **Không** `AGENT_RT_*`, `REDIS_URL`, `DATABASE_URL*`, `ANTHROPIC_API_KEY`. Test: env ∩ khoá secret = ∅ (unit); `#fake:env` (int).

### 5.4 Test
| AC | Test | Loại |
|---|---|---|
| AC-W05 | bảng ca `is_path_allowed`: `../x`, `a/../../x`, `/etc/passwd`, symlink trong work → `/home/worker/.claude`, symlink → `work/<job khác>`, `/mnt/c/Windows`, đường dẫn rỗng/NUL, đúng `work/<job>/a.txt` | unit `test_wrk_br_07_paths.py` |
| AC-W11 | `fake-cli #fake:read=~/.claude/.credentials.json` (file mồi chứa chuỗi canary) + `/home/worker/.codex/x` + `/mnt/c/...` → hook deny, `result` không chứa canary, grep log file + journald JSON không có canary | int `sandbox/hook_int_test.py` |
| Hook nối SDK thật | PY-02 spike: agent Claude được yêu cầu `Read ../../.claude/.credentials.json` → tool result lỗi quyền | smoke `HUB_LIVE=1` |

## 6. Resume session (WRK-FR-14, BR-03, BR-05, BR-06, AC-W04)
| Ca | Xử lý |
|---|---|
| Có `cli_sessions(tenant_id, conversation_id, agent_id, provider_key)` | `resume=session_id` (SELECT luôn lọc `tenant_id` của payload — BR-06) |
| `cwd` mỗi job khác nhau | CLI ≥ v2.1.223 tìm session ngoài project hiện tại [V S4]; thêm `CLAUDE_CODE_PROJECT_DIR_NAME=<tenant>__<conversation>__<agent>` [V S4, SDK ≥ 0.2.140; CX: cần `CLAUDE_CONFIG_DIR` kèm?] |
| Resume lỗi (session mất) — `ResultMessage.is_error`/`ProcessError` với chữ "No conversation found" [CX chữ] **và** chưa có `tool_use` nào | chạy lại 1 lần trong cùng job **không** `resume`, prompt = khối "Ngữ cảnh trước" dựng từ `payload.history` (≤ `history_n` tin của flow, §12 R2) + tin hiện tại; không báo lỗi user (H1-R23). Đã có `tool_use` → `failed UPSTREAM_ERROR` (BR-04) |
| Xong (có `ResultMessage.session_id`, kết quả hợp lệ) | UPSERT `cli_sessions` (SQL `plan.md`) với `session_id` mới |
| Provider khác / không có dòng (BR-03) | không resume, dùng `history` |
| Tuần tự (BR-05) | do SQL claim (§2.1) |
| Orchestrator | không session (H1-R23) |
| AC-W04 kiểm | `fake-cli` `#fake:remember=xanh` → lượt 2 `#fake:recall` trả "xanh" chỉ khi resume đúng id; `#fake:lost-session` → prompt có history |

## 7. Provider giả `fake-cli` (spec §7)
Cùng interface `Provider`, chạy **trong job host** (cùng env, group, hook, cwd). Chỉ nạp khi `APP_ENV ∈ {development, test}` (spec §7); production → bỏ, có trong `AGENT_RT_PROVIDERS` → exit 2.

| Chỉ thị (trong prompt, nhiều chỉ thị được) | Hành vi tất định |
|---|---|
| (không) | `done{text: "echo: <prompt>"}` (agent) / `answer{text}` (Orchestrator) |
| `#fake:delegate=<key>` | Orchestrator → `delegate{agent_key, task}` |
| `#fake:ask` · `#fake:partial` · `#fake:need_input` | `ask{question}` / `partial{text,missing}` / `need_input{question, choices:["A","B"]}` |
| `#fake:sleep=<s>` | ngủ, `progress` mỗi 1 s (huỷ/timeout) |
| `#fake:spawn-child` | `Popen(["sleep","300"])` cùng group rồi ngủ — AC-W10 |
| `#fake:read=<path>` | qua đúng `sandbox.hook.path_guard` (`file_path`); allow → trả độ dài, deny → `done{text:"denied"}` |
| `#fake:ratelimit[=<unix_ts>]` | phát `rate_limit{status:"rejected", resets_at}` rồi `final is_error` |
| `#fake:badjson=<n>` | n lần đầu trả JSON hỏng, đếm theo `run_id` (agent: n=1 qua nhờ retry; Orchestrator: Hub retry — HUB-H1-AC-10) |
| `#fake:crash` | `os._exit(3)` giữa chừng → `fatal` |
| `#fake:usage=<in>,<out>` | usage giả (mặc định 10,20), `model="fake"` |
| `#fake:remember=<w>` · `recall` · `lost-session` | session giả lưu ở `AGENT_RT_WORK_DIR/.fake-sessions/` (§6) |
| `#fake:env` | trả danh sách **khoá** env (không giá trị) — kiểm §5.3 |

## 8. Ghi DB khi xong job
| Bảng | Khi | Giá trị (SQL `plan.md`) |
|---|---|---|
| `usage_logs` | mọi job có `usage` (cả Orchestrator, cả lỗi/huỷ nếu đã có) — H1-R25, AC-W09 | `tenant_id, run_id, user_id, agent_id, provider_key, model`, `billing='subscription'`, `input_tokens = input + cache_creation + cache_read`, `output_tokens`, `cost_usd=0`, `billable_usd=NULL`, `overage=false`, `feature_id=NULL`, `latency_ms`; thiếu số → 0 (không bịa). Cột tách cache/`job_id` — §12 R6 |
| `provider_state` | §3.3; job thành công → `consecutive_errors=0`, `state='ok'` nếu không `cooldown` còn hạn | |
| `cli_sessions` | §6 | |
| `jobs` | finish: `succeeded`/`failed(reason, error_code)`/`cancelled`/`timed_out`, `finished_at` | một transaction cùng `usage_logs` |
| `agent_types` (WRK-FR-25, HUB-FR-90) | khởi động | UPSERT mỗi class ở `agents/`: `key, runtime, description{vi,en}, config_schema` (từ pydantic), `version`; không còn trong code → `available=false` (không xoá). H1: một mục `agentic-cli` |

## 9. Log và lưu output CLI (WRK-NFR-04, H1-R26)
| Mục | Cách |
|---|---|
| Log process cha | structlog JSON ra stdout (journald): `ts, level, event, job_id, run_id, tenant_id, worker_id`; cấm `print`; không log prompt, nội dung file, `tool_input`, env |
| File/job | `AGENT_RT_LOG_DIR/<YYYY-MM-DD>/<job_id>.stderr.log` (stderr CLI qua callback `stderr` + stderr job host) và `<job_id>.events.jsonl` (envelope message SDK: `type, subtype, tool_name, usage, is_error, errors` — **không** text/tool result để không lưu nội dung file); quyền 0600 |
| Giữ | task cleanup mỗi giờ: xoá thư mục ngày > 7 ngày; `work/<job_id>/` > 24 h (WRK-FR-23) |

## 10. Lệnh xong mốc (phần Python)
`cd apps/agent-runtime && uv sync --frozen && uv run ruff check . && uv run ruff format --check . && uv run pyright && uv run lint-imports && uv run pytest && uv run pytest -m int` (WSL2, Docker Postgres/Redis chạy) · gốc: `bun run check:size --all` (gồm `.py`) · `bun run trace --check` (gồm `.py`).

## 11. Task PY
13 task `PY-01`…`PY-13` (Rủi ro, Đọc, File, Lệnh xong) nằm ở `tasks.md` khối **PY** (thay P1–P8 cũ). Cao: PY-02 spike, 04 hàng đợi/slot, 06 cancel/process group, 07 hook, 08 provider/quota, 11 session/tenant, 12 usage. PY-01 gồm mở rộng `check:size` + `trace` quét `.py`; PY-02 là spike SDK trong WSL2 (điền §13) và phải xong trước PY-08.
Thứ tự: PY-01 → PY-02 ∥ PY-03 → PY-04, PY-05, PY-07 → PY-06 → PY-09 → PY-10 → PY-08 → PY-11 → PY-12 → PY-13.

## 12. Yêu cầu gửi plan BE (contract/DB) — điều phối đối chiếu
| # | Cần | Mặc định Runtime giả định |
|---|---|---|
| R1 | ✓ đã khớp `plan.md` §2.2–2.6: `output`, `use_session`, `job.started/progress/result/failed` (+ `seq` theo job), `HUB_JOB_ERROR_CODES`, NOTIFY `{v, job_id, …}` | dùng nguyên tên |
| R2 | `JobPayload` cần `history[{role,text}]` (≤ `history_n`) cho agent — `agent_rt` không đọc `hub.messages`; và `model?`, `max_turns?` | thiếu → không dựng lại được (H1-R23) |
| R5 | `plan.md` §2.4 gợi ý JSON hỏng → `done{text: toàn bộ}`; plan này: retry 1 lần rồi `UPSTREAM_ERROR` (task yêu cầu "lỗi rõ") — điều phối chốt | retry rồi lỗi |
| R6 | `usage_logs`: thêm cột nullable `job_id uuid`, `cache_read_tokens int`, `cache_write_tokens int` (ALTER idempotent, giữ stub) — hoặc xác nhận không cần | không có cột thì chỉ ghi tổng vào `input_tokens` |
| R7 | `jobs` có `worker_id, pgid, heartbeat_at, cancel_requested_at, reason, error_code`; trạng thái BA-W §3 (gồm `orphaned`, `timed_out`) | |
| R8 | SQL: claim (`provider_key = ANY($1)`, BR-05), set `pgid`, heartbeat (trả job bị huỷ), finish (+ usage một transaction), expire, orphan sweep, job `running` theo `worker_id`, UPSERT `cli_sessions`/`provider_state`/`agent_types` | |
| R10 | `provider_state(provider_key PK, state, cooldown_until, consecutive_errors int default 0, updated_at)`; `agent_types` có `available boolean`; `cli_sessions` unique `(tenant_id, conversation_id, agent_id, provider_key)` | |
| R11 | `max_wait_s`: lấy từ `providers.max_wait_s` hay payload? | payload `profile_step.max_wait_s`, mặc định 30 |
| R12 | Khi Runtime chết hẳn (không restart), Hub runner chờ `run:<run_id>` phải tự kiểm `jobs.status`/`heartbeat_at` mỗi 15 s để không treo (AC-04) | Runtime sweeper chạy ≤ 15 s sau khi systemd khởi động lại |
| R13 | Role `agent_rt`: cần thêm `SELECT` trên `hub.providers` (đọc `max_concurrency`, `max_wait_s`) nếu SQL claim cần; RLS cho `agent_rt` phải cho phép claim xuyên tenant | |

## 13. Kết quả spike (PY-02 điền)
| Mục [CX] | Kết quả | Ảnh hưởng |
|---|---|---|
| hook với `query()` vs `ClaudeSDKClient` · `tools=[]` · `setting_sources=[]` · tên trường `tool_input` Glob/Grep/LS · `output_format` union · resume khác `cwd` + `CLAUDE_CODE_PROJECT_DIR_NAME` · chữ lỗi mất session / hết quota / logged_out · CLI sinh con ngoài group · bản CLI đóng gói dùng `~/.claude` · biến tắt auto-update/telemetry · mirrored `localhost` | (trống) | |

## 14. Câu hỏi còn lại (có mặc định)
| # | Câu hỏi | Mặc định |
|---|---|---|
| RQ1 | Lưu "stdout CLI" 7 ngày (WRK-NFR-04) mâu thuẫn "không log nội dung file" (H1-R26) vì stream-json chứa tool result | Lưu stderr đầy đủ + envelope message không nội dung (§9) |
| RQ2 | `APP_ENV` cho `fake-cli`: task ghi `{dev,test}`, spec §7 ghi `{development,test}` | Theo spec: `development`, `test` |
| RQ3 | Mỗi job một process Python con (thêm ~0,5–1 s khởi động) thay vì SDK chạy trong process cha | Chấp nhận (cần cho BR-02 + process group); xem lại nếu spike đo > 1,5 s |
| RQ4 | Tên unit systemd | `ai-worker.service` (BA-W §8) |
| RQ5 | `bun run test` ở gốc trên Windows chạy Python thế nào | script gọi `wsl.exe … uv run …` khi win32; Linux gọi `uv` thẳng |
| RQ6 | Tính `input_tokens` có gồm cache | Có (tổng token vào), tách cột nếu BE nhận R6 |
| RQ7 | `max_turns` mặc định agent | 30; Orchestrator 3 |
