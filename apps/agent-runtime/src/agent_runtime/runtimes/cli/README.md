# runtimes/cli/ — runtime `agentic-cli`: job host process con (plan-runtime §1.2, §2.3)

| File | Nội dung |
|---|---|
| `runner.py` | (cha) `CliJobHost.run(job, control)`: validate payload, SQL Kết thúc (lỗi DB → thử lại backoff) + XADD sau commit |
| `job_run.py` | (cha) `JobRun`: spawn `python -m agent_runtime.runtimes.cli.child --job-id=<id>` (`start_new_session`, env `sandbox/env.py`, cwd `work/<job_id>`), ghi `pgid`, đọc sự kiện, cancel/timeout → giết group (`sandbox/process.py`), cha đang dừng → không ghi |
| `outcome.py` | sự kiện đã thấy → kết quả job + ảnh hưởng provider + dòng usage |
| `joblog.py` | file log theo job (khung message, stderr) |
| `child.py` | (con) đọc `ChildRequest` (stdin) → provider từ `providers/registry.py` → JSON lines stdout. Không import `config`/`db`/`events` |
| `protocol.py` | `ChildRequest`, `ChildEvent` (kiểu sự kiện ở `providers/base.py`), `child_argv` |
| `session.py` | (cha) luật session §6: khoá `cli_sessions` (+`tenant_id`), resume lỗi trước `tool_use` → dựng từ history (PY-11) |

Còn: `result.py`/`prompt.py` (PY-10), usage/provider_state (PY-12), file log events (PY-13).
