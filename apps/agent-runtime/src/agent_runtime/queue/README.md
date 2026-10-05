# queue/ — hàng đợi job của process cha (plan-runtime §1.5, §2)

| File | Nội dung |
|---|---|
| `runtime.py` | khởi động (pool, LISTEN, manifest, dọn job sót, reset provider) · dịch vụ · dừng SIGTERM |
| `claimer.py` | vòng claim: `job_enqueued` hoặc poll `AGENT_RT_POLL_S`, claim tới khi rỗng; mỗi lần claim sinh token job (H2a RT1, chỉ lưu `token_hash` trong DB — `db/jobs_sql.py` `new_token`) |
| `listener.py` | LISTEN `job_enqueued`/`job_cancel`, mở lại 1→10 s |
| `heartbeat.py` | heartbeat theo `worker_id`; `cancel` → huỷ, mất job → `lost`; job `running` mà không giữ (2 lần liền) → `orphaned` + XADD |
| `sweeper.py` | **chỉ** quét orphan (`AGENT_RT_ORPHAN_S`); H2a: câu requeue `workflow.async` còn lượt (`REQUEUE_ORPHANS`/`REQUEUE_RESTART`) chạy **trước** câu `failed` cùng kết nối — job của mình bị requeue → dừng `lost`; khởi động lại/dừng → `orphaned` |
| `orphans.py` | giết group job host sót (kiểm `cmdline` có `--job-id=<id>`) |
| `supervisor.py` | job đang giữ + lý do dừng (`cancel`/`lost`/`shutdown`); claim lại cùng `id` sau requeue → dừng task cũ, task mới chờ task cũ thoát; `snapshot()` + `stop(..., expected=)` để heartbeat không dừng nhầm lần claim mới; `shutdown` chờ cả task cũ đang dọn |
| `host.py` | Protocol `JobHost`/`JobEvents` + `JobControl`; bản thật `runtimes/dispatch.py` (`JobRouter` → `CliJobHost`/`DifyJobHost`), `events/job_events.py` (nối ở `main`) |

Ràng buộc cấu hình (validator `config.py`, H2a review 1): `AGENT_RT_HEARTBEAT_S` < 30 (Hub quét orphan 60 s) và `AGENT_RT_ORPHAN_S` ≥ 2 × `AGENT_RT_HEARTBEAT_S`; sai → Runtime thoát lúc khởi động.
