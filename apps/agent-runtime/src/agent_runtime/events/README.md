# events/ — sự kiện run ra Redis Streams (WRK-FR-03)

| File | Nội dung |
|---|---|
| `stream.py` | `publish_run_event`: XADD `run:<run_id>` (MAXLEN, EXPIRE 24 h) từ `RunEvent` của contract |
| `job_events.py` | `RunEvents` (`JobEvents` thật): `job.started/progress/result/failed/delta`, `seq` theo job; Redis lỗi → log, không ném. `ResultMeta` = phần tuỳ chọn của `job.result`: `session_resumed` (WRK-FR-14), `outputs` (H2c R25: id file `out/` Hub đã nhận; rỗng ⇒ `encode_event` bỏ khoá `outputs`, nhận theo `type == "job.result"`) |

Luật người gọi (plan-db §8 R2): chỉ XADD **sau commit** có dòng. Chỉ `main`/`queue`/`runtimes.cli.runner` import (import-linter).
