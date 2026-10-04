# queue/ — hàng đợi job của process cha (plan-runtime §1.5, §2)

| File | Nội dung |
|---|---|
| `runtime.py` | khởi động (pool, LISTEN, manifest, dọn job sót, reset provider) · dịch vụ · dừng SIGTERM |
| `claimer.py` | vòng claim: `job_enqueued` hoặc poll `AGENT_RT_POLL_S`, claim tới khi rỗng |
| `listener.py` | LISTEN `job_enqueued`/`job_cancel`, mở lại 1→10 s |
| `heartbeat.py` | heartbeat theo `worker_id`; `cancel` → huỷ, mất job → `lost` |
| `sweeper.py` | **chỉ** quét orphan (`AGENT_RT_ORPHAN_S`); khởi động lại/dừng → `orphaned` |
| `orphans.py` | giết group job host sót (kiểm `cmdline` có `--job-id=<id>`) |
| `supervisor.py` | job đang giữ + lý do dừng (`cancel`/`lost`/`shutdown`) |
| `host.py` | Protocol `JobHost`/`JobEvents` + `JobControl`; bản thật `runtimes/cli/runner.py`, `events/job_events.py` (nối ở `main`) |
