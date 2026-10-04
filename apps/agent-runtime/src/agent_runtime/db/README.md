# db/ — SQL thuần cho bảng `hub` (Runtime)

Không ORM, không migration (migration ở `packages/db`, CONVENTIONS §8). SQL nguyên văn `plan-db.md` §5.4–5.5.

| File | Nội dung |
|---|---|
| `pool.py` | pool asyncpg + kết nối LISTEN riêng; `Conn`/`Pool` Protocol (asyncpg không kèm kiểu) |
| `jobs_sql.py` | claim (`K_CLAIM` + SKIP LOCKED), pgid, heartbeat, quét orphan, khởi động lại, reset provider |
| `agent_types_sql.py` | Manifest `hub.agent_types` (UPSERT + `available=false`) |
| `finish_sql.py` | transaction "Kết thúc": `jobs` → `usage_logs` → (`cli_sessions`, PY-11) → `provider_state` |
| `usage_sql.py` · `provider_state_sql.py` | INSERT `usage_logs` · Provider OK/lỗi/hỏng (+ fail job `queued`) |

Chỉ `main`, `queue`, `runtimes.cli.{runner,outcome}` được import (import-linter).
