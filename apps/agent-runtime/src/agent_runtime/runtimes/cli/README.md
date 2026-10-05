# runtimes/cli/ — runtime `agentic-cli`: job host process con (plan-runtime §1.2, §2.3)

| File | Nội dung |
|---|---|
| `runner.py` | (cha) `CliJobHost.run(job, control)`: validate payload, SQL Kết thúc (lỗi DB → thử lại backoff) + XADD sau commit |
| `job_run.py` | (cha) `JobRun`: điều phối một lần chạy — session/resume (H1-R23), thử lại JSON hỏng, cha đang dừng → không ghi, `_apply` → `CliJobHost.close`; giữ `proc_host: HostProcess` |
| `host_proc.py` | (cha) `HostProcess` (PY-00): spawn `python -m agent_runtime.runtimes.cli.child --job-id=<id>` (`start_new_session`, env `sandbox/env.py`, cwd `work/<job_id>`), ghi `pgid`, đọc sự kiện, cancel/timeout → giết group (`sandbox/process.py`); đọc trạng thái lần chạy qua Protocol `RunState` |
| `stdout_pipe.py` | (cha) pipe stdout do cha tạo: inode → tìm cháu giữ pipe, đóng transport khi bỏ đọc |
| `outcome.py` | sự kiện đã thấy → kết quả job + ảnh hưởng provider + dòng usage |
| `joblog.py` | file log theo job (khung message, stderr) |
| `child.py` | (con) đọc `ChildRequest` (stdin) → provider từ `providers/registry.py` → JSON lines stdout. Không import `config`/`db`/`events` |
| `protocol.py` | `ChildRequest`, `ChildEvent` (kiểu sự kiện ở `providers/base.py`), `child_argv` |
| `delta.py` | H2b (WRK-FR-03, R20): thuần `split_utf16` (≤ n đơn vị UTF-16, không cắt giữa code point), `DeltaBuffer` (xả khi ≥ `AGENT_RT_DELTA_FLUSH_CHARS` hoặc ≥ `AGENT_RT_DELTA_FLUSH_MS`) |
| `delta_pump.py` | H2b (cha): `DeltaPump` — gom `Delta` của job host, hẹn giờ xả, XADD `job.delta{kind, text}` (`seq` chung bộ đếm job) qua `RunEvents.delta`; `drain` trước `_close`, mẻ đang XADD bọc `asyncio.shield`; `streamed` ⇒ không thử lại JSON / dựng lại session |
| `refusal.py` | H2b F4 (WRK-FR-15): `classify_is_error(text, output_tokens, stop_reason)` — rate/auth như H1; `refused` chỉ khi `stop_reason == "refusal"` ∧ 0 output (TC-8); còn lại None ⇒ `PROVIDER_ERROR` |
| `session.py` | (cha) luật session §6: khoá `cli_sessions` (+`tenant_id`), resume lỗi trước `tool_use` → dựng từ history (PY-11) |
| `files/` | H2c (WRK-FR-11, WRK-FR-18): tải file đính kèm vào `work/<job_id>/attachments/` và đẩy `out/` lên Hub — xem `files/README.md`; gọi từ `job_run.py` (`_prepare_files`, `_close`) |
| `quota_rules.py` | H3a (WRK-FR-22, WRK-FR-15): luật thuần quota/probe (`plan-runtime` H3a §3); `clean_*`, `parse_fake_probe` re-export từ `providers` (PY-03a) |
| `probe/` | H3a (WRK-FR-22, PY-03): probe quota — xem `probe/README.md`; vòng gọi ở `queue/probe_loop.py` (PY-04) |

Còn: `result.py`/`prompt.py` (PY-10), usage/provider_state (PY-12), file log events (PY-13).
