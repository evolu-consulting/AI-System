# events/ — sự kiện run ra Redis Streams (WRK-FR-03)

| File | Nội dung |
|---|---|
| `stream.py` | `publish_run_event`: XADD `run:<run_id>` (MAXLEN, EXPIRE 24 h) từ `RunEvent` của contract |
| `job_events.py` | `RunEvents` (`JobEvents` thật): `job.started/progress/result/failed`, `seq` theo job; Redis lỗi → log, không ném |

Luật người gọi (plan-db §8 R2): chỉ XADD **sau commit** có dòng. Chỉ `main`/`queue`/`runtimes.cli.runner` import (import-linter).
