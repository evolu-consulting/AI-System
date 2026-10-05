# db/ — SQL thuần cho bảng `hub` (Runtime)

Không ORM, không migration (migration ở `packages/db`, CONVENTIONS §8). SQL nguyên văn `plan-db.md` §5.4–5.5
(+ H2a `plan-db` §2, `plan-runtime-dify` §3.4/§3.7).

| File | Nội dung |
|---|---|
| `pool.py` | pool asyncpg + kết nối LISTEN riêng; `Conn`/`Pool` Protocol (asyncpg không kèm kiểu) |
| `jobs_sql.py` | claim (`K_CLAIM` + SKIP LOCKED, ghi `token_hash` lần claim — RT1), pgid, heartbeat, requeue `workflow.async` mồ côi (+ NOTIFY) **trước** quét orphan, khởi động lại, `orphan_one`, `finished_as`, reset provider; `FINISH_FENCED`/`FINISHED_AS_FENCED` = câu gốc + `AND token_hash = $n` |
| `workflow_sql.py` | job `workflow.async`: `mark_dispatched` (Q6) · "Kết thúc" = `FINISH_FENCED` + usage `billing=dify` (`ON CONFLICT (job_id) DO NOTHING`), không đụng `provider_state` |
| `agent_types_sql.py` | Manifest `hub.agent_types` (UPSERT + `available=false`) |
| `finish_sql.py` | transaction "Kết thúc": `jobs` → `usage_logs` → `cli_sessions` → `provider_state` |
| `sessions_sql.py` | SELECT/UPSERT `cli_sessions` (khoá 3 cột + `tenant_id`, BR-06) |
| `usage_sql.py` · `provider_state_sql.py` | INSERT `usage_logs` · Provider OK/lỗi/hỏng (+ fail job `queued`) |

Rào lần claim (review 1 C1): job `workflow.async` có thể requeue rồi **cùng** `worker_id` claim lại ⇒
`worker_id` + `running` không đủ phân biệt lần claim. Mọi câu ghi theo job đang chạy của Dify
(`mark_dispatched`, "Kết thúc", `finished_as`) thêm `token_hash = sha256(token lần claim)`
(`ClaimedJob.fence`). CLI (`agent.cli`, `SET_PGID`, `FINISH`) không bao giờ requeue → giữ câu gốc;
heartbeat theo `worker_id` (làm mới lần claim hiện hành của mình là đúng).

Chỉ `main`, `queue`, `runtimes` (cha) import; `providers`, `sandbox`, `contracts`, `agents`, job host con cấm (import-linter).
