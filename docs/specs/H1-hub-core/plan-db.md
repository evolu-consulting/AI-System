# Plan · H1 · DB Hub↔Runtime (phụ lục `plan.md`)

Bảng Runtime (§3.3) và SQL Runtime nguyên văn (§5.4–5.5) — tách khỏi `plan.md` để giữ trần (WORKFLOW Kỷ luật token #5); số mục giữ như `plan.md`. Quy ước cột, role/GRANT, thứ tự khoá: `plan.md` §3, §3.4, §3.5. Ràng buộc gửi Runtime: `plan.md` §8; trả lời yêu cầu Runtime: §8 dưới đây.

### 3.3 Runtime (Python ghi, ADR-0007 #9)
| Bảng | Cột | Index (câu dùng) |
|---|---|---|
| `jobs` | `id, tenant_id, user_id, run_id FK runs CASCADE, step_id, conversation_id, agent_id, type (agent.cli\|agent.run), provider_key FK providers(key), priority smallint DEFAULT 100 (nhỏ trước), payload jsonb, status DEFAULT 'queued' (`JOB_STATUSES`), attempts DEFAULT 0, worker_id null, pgid int null, heartbeat_at null, cancel_requested_at null, started_at null, finished_at null, result jsonb null, error_code null (`HUB_JOB_ERROR_CODES`), error_reason null (`JOB_FAIL_REASONS`), error_message null (≤ 500), created_at` | claim `(priority, created_at, id) WHERE queued`; slot `(provider_key)`, `(tenant_id) WHERE running`; BR-05 `(conversation_id, agent_id) WHERE queued/running`; huỷ `(run_id)`; orphan `(heartbeat_at) WHERE running`; heartbeat `(worker_id) WHERE running` |
| `cli_sessions` | `conversation_id FK CASCADE, agent_id, provider_key, tenant_id, session_id, updated_at` | PK `(conversation_id, agent_id, provider_key)`; mọi SELECT/UPSERT lọc thêm `tenant_id` (BR-06) |
| `provider_state` | `provider_key PK FK providers(key) CASCADE, status DEFAULT 'ok' (ok\|busy\|cooldown\|error\|logged_out), cooldown_until null, last_error null (≤ 500), consecutive_errors int DEFAULT 0 CHECK ≥ 0, updated_at` | |
| `agent_types` | `key PK, runtime, description jsonb, config_schema jsonb, version, worker_id, available boolean DEFAULT true, registered_at` | |
| `usage_logs` (stub) | giữ mọi cột/CHECK/index; **thêm** (đều nullable, không default — Admin M4 và test khoá INSERT không đổi): `job_id uuid`, `cache_read_tokens int CHECK ≥ 0`, `cache_write_tokens int CHECK ≥ 0`. `input_tokens` = **tổng** token vào (gồm cache); hai cột cache là phần bên trong, null = SDK không báo | `usage_logs_job_uq UNIQUE (job_id) WHERE job_id IS NOT NULL`; `usage_logs_at_idx (at)` (IF NOT EXISTS — production cần như dev) |

Hàm `hub.tenant_sub_limit(uuid) RETURNS int` — `sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp`, trả `admin.tenants.max_concurrent_sub`: Runtime không cần quyền `admin.*`. Ngay sau `CREATE`: `REVOKE EXECUTE ON FUNCTION hub.tenant_sub_limit(uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION hub.tenant_sub_limit(uuid) TO agent_runtime;` (mặc định Postgres cho PUBLIC EXECUTE).

### 5.4 SQL Runtime (nguyên văn, tham số asyncpg)
**Claim** — một transaction READ COMMITTED; advisory lock **toàn cục** `K_CLAIM` (P5, không theo provider), câu khoá tách riêng để snapshot câu sau thấy mọi claim đã commit:
```sql
SELECT pg_advisory_xact_lock(hashtext('hub.jobs.claim'));
SELECT j.id, j.payload FROM hub.jobs j
JOIN hub.providers p ON p.key = j.provider_key AND p.enabled
LEFT JOIN hub.provider_state s ON s.provider_key = p.key
WHERE j.status = 'queued' AND j.cancel_requested_at IS NULL
  AND j.provider_key = ANY($1::text[])
  AND (s.status IS NULL OR s.status IN ('ok','busy') OR (s.status = 'cooldown' AND s.cooldown_until <= now()))
  AND (SELECT count(*) FROM hub.jobs r WHERE r.status = 'running' AND r.provider_key = j.provider_key) < p.max_concurrency
  AND (p.kind <> 'subscription' OR hub.tenant_sub_limit(j.tenant_id) IS NULL
       OR (SELECT count(*) FROM hub.jobs r JOIN hub.providers rp ON rp.key = r.provider_key
           WHERE r.status = 'running' AND r.tenant_id = j.tenant_id AND rp.kind = 'subscription')
          < hub.tenant_sub_limit(j.tenant_id))
  AND NOT EXISTS (SELECT 1 FROM hub.jobs b
       WHERE b.conversation_id = j.conversation_id AND b.agent_id = j.agent_id
         AND (b.status = 'running' OR (b.status = 'queued'
              AND (b.priority, b.created_at, b.id) < (j.priority, j.created_at, j.id))))
ORDER BY j.priority, j.created_at, j.id
LIMIT 1
FOR UPDATE OF j SKIP LOCKED;
UPDATE hub.jobs SET status = 'running', worker_id = $2, started_at = now(), heartbeat_at = now(), attempts = attempts + 1
WHERE id = $3 AND status = 'queued';
-- COMMIT → XADD job.started. Không dòng → COMMIT, chờ job_enqueued / poll 1 s
```
**pgid:** `UPDATE hub.jobs SET pgid = $3 WHERE id = $1 AND worker_id = $2 AND status = 'running';`
**Heartbeat 10 s** (một câu cho mọi job của worker): `UPDATE hub.jobs SET heartbeat_at = now() WHERE worker_id = $1 AND status = 'running' RETURNING id, cancel_requested_at IS NOT NULL AS cancel;` — job đang giữ mà không có trong kết quả = không còn của mình → giết group, không ghi gì; `cancel` → huỷ (dự phòng mất `job_cancel`).
**Kết thúc** (một transaction, sau khi group đã hết; thứ tự `plan.md` §3.5):
```sql
UPDATE hub.jobs SET status = $3, result = $4, error_code = $5, error_reason = $6, error_message = $7,
  finished_at = now(), pgid = NULL
WHERE id = $1 AND worker_id = $2 AND status = 'running';           -- 0 dòng → ROLLBACK, không XADD
INSERT INTO hub.usage_logs (tenant_id, run_id, step_id, user_id, feature_id, agent_id, provider_key, model, billing,
  input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, billable_usd, overage, latency_ms, job_id)
VALUES ($8, $9, $10, $11, NULL, $12, $13, $14, 'subscription', $15, $16, $20, $21, 0, NULL, false, $17, $1)
ON CONFLICT (job_id) WHERE job_id IS NOT NULL DO NOTHING;           -- chỉ khi có usage
INSERT INTO hub.cli_sessions (conversation_id, agent_id, provider_key, tenant_id, session_id, updated_at)
VALUES ($18, $12, $13, $8, $19, now())
ON CONFLICT (conversation_id, agent_id, provider_key) DO UPDATE
  SET session_id = EXCLUDED.session_id, updated_at = now()
  WHERE hub.cli_sessions.tenant_id = EXCLUDED.tenant_id;          -- chỉ khi use_session, succeeded và có session_id
-- provider_state (cuối transaction): succeeded → Provider OK; fatal/ProcessError không phải quota/đăng nhập → Provider lỗi
-- COMMIT → XADD job.result | job.failed
```
**Provider OK:** `UPDATE hub.provider_state SET consecutive_errors = 0, updated_at = now() WHERE provider_key = $1 AND consecutive_errors <> 0;`
**Provider lỗi:** `INSERT INTO hub.provider_state (provider_key, consecutive_errors, last_error, updated_at) VALUES ($1, 1, $2, now()) ON CONFLICT (provider_key) DO UPDATE SET consecutive_errors = hub.provider_state.consecutive_errors + 1, last_error = EXCLUDED.last_error, updated_at = now() RETURNING consecutive_errors;` — ≥ 3 → **Provider hỏng** `status='error'`.
**Provider hỏng** (rate limit / đăng nhập / lỗi lặp; transaction riêng sau kết thúc): `K_CLAIM` → `UPDATE hub.jobs SET status = 'failed', error_code = 'ALL_PROVIDERS_EXHAUSTED', error_reason = $4, finished_at = now() WHERE status = 'queued' AND provider_key = $1 RETURNING id, run_id;` → `INSERT INTO hub.provider_state (provider_key, status, cooldown_until, last_error, updated_at) VALUES ($1, $2, $3, $5, now()) ON CONFLICT (provider_key) DO UPDATE SET status = EXCLUDED.status, cooldown_until = EXCLUDED.cooldown_until, last_error = EXCLUDED.last_error, updated_at = now();` → COMMIT → XADD `job.failed` từng job. `$2` ∈ `cooldown`/`logged_out`/`error`; `$3` = giờ reset khi `cooldown`, khác → NULL; `$4` = `quota` khi `cooldown`, khác → `provider_unavailable` (jobs trước provider_state theo §3.5).
**Khởi động lại:** `UPDATE hub.jobs SET status = 'failed', error_code = 'INTERNAL_ERROR', error_reason = 'orphaned', finished_at = now() WHERE worker_id = $1 AND status = 'running' RETURNING id, run_id, pgid;` → giết pgid còn sống → XADD `job.failed`. `worker_id` cố định (`AGENT_RT_WORKER_ID`). Rồi `UPDATE hub.provider_state SET status = 'ok', consecutive_errors = 0, cooldown_until = NULL, updated_at = now() WHERE provider_key = ANY($2::text[]) AND status IN ('error','logged_out');` (đăng nhập lại = `systemctl restart`).
**Manifest:** `INSERT INTO hub.agent_types (…7 cột, available) VALUES (…, true, now()) ON CONFLICT (key) DO UPDATE SET` mọi cột `= EXCLUDED.*`, `available = true`, `registered_at = now()`; rồi `UPDATE hub.agent_types SET available = false WHERE worker_id = $1 AND key <> ALL($2::text[]);` (không xoá).
**XADD:** `XADD run:<run_id> MAXLEN ~ 10000 * e <json>` + `EXPIRE run:<run_id> 86400` (pipeline).

### 5.5 Quét orphan (Hub và Runtime, mỗi 10 s)
`UPDATE hub.jobs SET status = 'failed', error_code = 'INTERNAL_ERROR', error_reason = 'orphaned', finished_at = now() WHERE status = 'running' AND heartbeat_at < now() - interval '60 seconds' RETURNING id, run_id, worker_id, pgid;` Bên nhận dòng XADD `job.failed` (chỉ một bên nhận được). Runtime: pgid của `worker_id` mình còn sống → giết group.

### 8. Trả lời `plan-runtime.md` §12 (chuyển từ `plan.md` §8)
Cột "Chỗ": §3.3, §5.4–5.5 là mục của file này; mục khác là của `plan.md`. Ràng buộc R1–R8 gửi Runtime: `plan.md` §8.

| # | Chốt | Chỗ |
|---|---|---|
| R1 | ✓ nhận | §2.2–2.6 |
| R2 | ✓ nhận, tên theo contract: `history[{role, content}]` (không `text`), `model` (nullable), **thêm** `max_turns` int 1–100 | §2.2 |
| R5 | ✓ nhận: retry 1 lần trong job rồi `job.failed{UPSTREAM_ERROR, reason:"invalid_output"}` | §8 R3 |
| R6 | ✓ nhận: `job_id`, `cache_read_tokens`, `cache_write_tokens` nullable; `input_tokens` = tổng gồm cache | §3.3, §5.4 Kết thúc |
| R7 | ✓ nhận, tên theo plan: `error_reason` (không `reason`); không có status `orphaned` (= `failed` + `error_reason='orphaned'`); `timed_out` là status | §2.5, §3.3 |
| R8 | ✓ nhận (heartbeat gộp theo `worker_id`; thêm SQL Provider OK/lỗi/hỏng, reset provider khi khởi động, `available`). Hết hạn `queued`: xem R11 | §5.4–5.5 |
| R10 | Một phần: `provider_state` giữ tên cột `status` (không `state`), có `consecutive_errors`; ✓ `agent_types.available`; **từ chối** unique 4 cột cho `cli_sessions` — `conversation_id` là uuid toàn cục, PK 3 cột + điều kiện `tenant_id` ở mọi SELECT/UPSERT đủ cho BR-06 | §3.3 |
| R11 | **Từ chối** `max_wait_s` ở payload/`providers`: chỉ Hub hết hạn job `queued` theo env `HUB_JOB_MAX_WAIT_S` (P8, §5.6 bước 5). Runtime không có env/logic `max_wait_s`; provider hỏng → Runtime fail ngay job `queued` của provider đó (Provider hỏng) | §1 P8, §5.6 |
| R12 | ✓ đã có, chặt hơn: AgentRunner đọc `jobs.status` mỗi 2 s khi im; Hub cũng quét orphan 10 s (heartbeat > 60 s) | §1 P7, §5.6 bước 4, §5.5 |
| R13 | ✓ nhận: một role `agent_runtime` (bỏ tên `agent_rt`), có SELECT `providers`; bảng Runtime không RLS | §3.4 |
