# Plan · H2a · DB + SQL (phụ lục `plan.md`)

Quy ước cột, RLS mẫu, `withHubScope`, thứ tự khoá: H1 `plan.md` §3, §3.4, §3.5. Migration viết tay idempotent như H1 P1 (`IF NOT EXISTS`, ràng buộc qua `DO $$ … pg_constraint`), chạy được trên DB sạch và DB có stub (test khoá H1 A48 so hai đường). Không sửa `0000`/`0001` (CONVENTIONS §8).

## 1. `packages/db/migrations-hub/0002_h2a_dify.sql` (D1 + D2) · `schema/hub.ts` thêm kiểu
### 1.1 Cột / CHECK (D1)
```sql
ALTER TABLE hub.runs ADD COLUMN IF NOT EXISTS command_id uuid, ADD COLUMN IF NOT EXISTS feature_id uuid;
-- DO $$: thêm nếu chưa có
--   runs_kind_check    CHECK (kind IN ('orchestrated','command'))
--   runs_command_ck    CHECK ((kind = 'command') = (command_id IS NOT NULL))
ALTER TABLE hub.run_steps ADD COLUMN IF NOT EXISTS workflow_id uuid;
-- DO $$: DROP run_steps_type_check nếu định nghĩa cũ → ADD CHECK (type IN ('orchestrator','delegate','workflow','tool'))
--        run_steps_workflow_ck CHECK ((type IN ('workflow','tool')) = (workflow_id IS NOT NULL))
ALTER TABLE hub.jobs
  ADD COLUMN IF NOT EXISTS token_hash bytea,
  ADD COLUMN IF NOT EXISTS queued_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;
ALTER TABLE hub.jobs ALTER COLUMN agent_id DROP NOT NULL;
-- DO $$: jobs_type_check → IN ('agent.cli','agent.run','workflow.async')
--        jobs_agent_ck   CHECK (type = 'workflow.async' OR agent_id IS NOT NULL)
--        jobs_token_hash_ck CHECK (token_hash IS NULL OR octet_length(token_hash) = 32)
CREATE UNIQUE INDEX IF NOT EXISTS jobs_token_hash_uq ON hub.jobs (token_hash) WHERE token_hash IS NOT NULL;
-- DO $$: providers_vendor_check → IN ('anthropic','openai','google','fake','dify')
```
Đổi CHECK: `DROP CONSTRAINT IF EXISTS` + `ADD` trong một `DO` khi `pg_get_constraintdef` khác bản mới (lần 2 = không đổi). Không mất dữ liệu: chỉ nới tập giá trị / bỏ NOT NULL.

### 1.2 Bảng mới (D1)
```sql
CREATE TABLE IF NOT EXISTS hub.tool_confirmations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, user_id uuid NOT NULL,
  flow_id uuid NOT NULL, run_id uuid NOT NULL,
  agent_id uuid NOT NULL, workflow_id uuid NOT NULL,
  status text NOT NULL,
  decided_run_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz, consumed_at timestamptz,
  CONSTRAINT tool_confirmations_pkey PRIMARY KEY (id),
  CONSTRAINT tool_confirmations_status_check CHECK (status IN ('pending','confirmed','declined','consumed','expired')),
  CONSTRAINT tool_confirmations_decided_ck CHECK ((status IN ('confirmed','consumed')) <= (decided_run_id IS NOT NULL)),
  CONSTRAINT tool_confirmations_flow_id_fkey FOREIGN KEY (flow_id) REFERENCES hub.flows (id) ON DELETE CASCADE,
  CONSTRAINT tool_confirmations_run_id_fkey FOREIGN KEY (run_id) REFERENCES hub.runs (id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS tool_confirmations_open_uq
  ON hub.tool_confirmations (flow_id, agent_id, workflow_id) WHERE status IN ('pending','confirmed');
CREATE INDEX IF NOT EXISTS tool_confirmations_run_idx ON hub.tool_confirmations (run_id);
ALTER TABLE hub.tool_confirmations ENABLE ROW LEVEL SECURITY;
-- policy tool_confirmations_hub_rw: đúng biểu thức của 5 bảng hội thoại (H1 §3.4), FOR ALL TO hub_rw
GRANT SELECT, INSERT, UPDATE, DELETE ON hub.tool_confirmations TO hub_rw;

CREATE TABLE IF NOT EXISTS hub.workflow_flags (
  workflow_id uuid NOT NULL, side_effect boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_flags_pkey PRIMARY KEY (workflow_id)
);
GRANT SELECT ON hub.workflow_flags TO hub_rw;
GRANT SELECT, INSERT, UPDATE ON hub.cli_sessions TO hub_rw;   -- dify-agent (R14); mọi câu lọc tenant_id
```
`<=` trên boolean = "kéo theo". Không index `(flow_id) WHERE pending` riêng: `tool_confirmations_open_uq` có tiền tố `flow_id` phục vụ câu §3.1.

### 1.3 Hàm SECURITY DEFINER (D2 — P1, P2)
```sql
CREATE OR REPLACE FUNCTION hub.workflow_secret(p_workflow_id uuid)
RETURNS TABLE (secret_id uuid, ciphertext bytea, iv bytea, key_version smallint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT s.id, s.ciphertext, s.iv, s.key_version
  FROM admin.workflows w JOIN admin.secrets s ON s.id = w.secret_id
  WHERE w.id = p_workflow_id
$$;
REVOKE EXECUTE ON FUNCTION hub.workflow_secret(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hub.workflow_secret(uuid) TO hub_ro;

CREATE OR REPLACE FUNCTION hub.log_dify_usage(
  p_tenant_id uuid, p_run_id uuid, p_step_id uuid, p_user_id uuid, p_feature_id uuid, p_agent_id uuid,
  p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric, p_latency_ms integer)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO hub.usage_logs (tenant_id, run_id, step_id, user_id, feature_id, agent_id, provider_key, model,
    billing, input_tokens, output_tokens, cost_usd, billable_usd, overage, latency_ms)
  VALUES (p_tenant_id, p_run_id, p_step_id, p_user_id, p_feature_id, p_agent_id, 'dify', NULL,
    'dify', greatest(p_input_tokens, 0), greatest(p_output_tokens, 0), greatest(p_cost_usd, 0), NULL, false,
    p_latency_ms)
$$;
REVOKE EXECUTE ON FUNCTION hub.log_dify_usage(uuid, uuid, uuid, uuid, uuid, uuid, integer, integer, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hub.log_dify_usage(uuid, uuid, uuid, uuid, uuid, uuid, integer, integer, numeric, integer) TO hub_rw;
```
Chủ hàm = role chạy migration (owner DB, chủ `admin.*` và `hub.usage_logs`) → đọc `admin.secrets` bỏ qua RLS (không FORCE). Ghi `PRODUCTION-NOTES`: migration Hub phải chạy bằng chủ `admin.secrets`.

**Test D2** (`packages/db/src/hub-h2a.int.test.ts`, DB `ai_system_h1_test`): `has_table_privilege('hub_ro','admin.secrets','SELECT')` = false · `has_any_column_privilege('hub_ro','admin.secrets','SELECT')` = false · `SET ROLE hub_ro; select id from admin.secrets` → 42501 (giống test khoá M2) · `SET ROLE hub_ro; select * from hub.workflow_secret($wf)` → đúng 1 dòng, cột đúng 4 tên; uuid lạ → 0 dòng · `has_function_privilege` PUBLIC/`agent_runtime`/`admin_rw` = false · `pg_proc.prosecdef` = true, `proconfig` có `search_path` · `hub_api` INSERT `usage_logs` vẫn false (A51) nhưng `select hub.log_dify_usage(…)` được, dòng có `billing='dify'` · migration lần 2 = 0 · test int Admin (M2/M3 `db-rls`, `hub-view`) xanh nguyên văn.

## 2. SQL Hub (nguyên văn, tham số postgres.js)
**Token → job (MCP, system scope):** `SELECT id, tenant_id, user_id, run_id, step_id, agent_id, type, payload FROM hub.jobs WHERE token_hash = $1 AND status = 'running'` → MCP yêu cầu `type='agent.cli'`; credential yêu cầu `id = $job_id` ∧ `type='workflow.async'`. Mọi nhánh sai → 401 như nhau.
**Secret:** trong transaction `user`/`system` bất kỳ của `hub_api`: `SELECT secret_id, ciphertext, iv, key_version FROM hub.workflow_secret($1)` → 0 dòng → `NOT_CONFIGURED`; `decryptSecret(k, secret_id, {ciphertext, iv, keyVersion})` ném → `NOT_CONFIGURED` (log `secret_decrypt_failed` + `workflow_id`, không giá trị).
**Enqueue `workflow.async`** (system, §3.5): `INSERT INTO hub.jobs (id, tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type, provider_key, priority, payload) VALUES ($1,$2,$3,$4,$5,$6,NULL,'workflow.async','dify',100,$7)` + `SELECT pg_notify('job_enqueued', $8)`. Trước đó kiểm cache `providers['dify'].enabled`.
**Hết hạn queued (H1 §5.6 bước 5) — thay `created_at` bằng `queued_at`:** `UPDATE hub.jobs SET status='failed', error_code='ALL_PROVIDERS_EXHAUSTED', error_reason=$2, finished_at=now() WHERE id=$1 AND status='queued' AND queued_at < now() - make_interval(secs => $3)`.
**Requeue orphan** (Hub và Runtime, mỗi 10 s, **trước** câu `failed` của H1 `plan-db` §5.5):
```sql
UPDATE hub.jobs SET status = 'queued', worker_id = NULL, pgid = NULL, heartbeat_at = NULL, started_at = NULL,
  token_hash = NULL, dispatched_at = NULL, queued_at = now()
WHERE status = 'running' AND type = 'workflow.async' AND heartbeat_at < now() - make_interval(secs => $1)
  AND attempts < 3 AND cancel_requested_at IS NULL
  AND NOT (coalesce((payload->>'side_effect')::boolean, false) AND dispatched_at IS NOT NULL)
RETURNING id, run_id, worker_id, pgid;
```
Mỗi dòng: `pg_notify('job_enqueued', {v:1, job_id, provider_key:'dify'})`; Runtime giết `pgid` nếu `worker_id` là mình. Không XADD (job chưa kết thúc). `$1` (giây) = ngưỡng orphan của câu `failed` H1 cùng phía: **Hub `$1 = 60`** (cùng hằng `interval '60 seconds'` của `runner.repo.ts` H1; khai hằng `ORPHAN_S = 60` dùng chung hai câu) · **Runtime `$1 = AGENT_RT_ORPHAN_S`** (`Settings.orphan_s`, mặc định 60; test rút ngắn 5). Bản **khởi động lại** của Runtime: cùng câu, thay điều kiện heartbeat bằng `worker_id = $1`.
**`insertStep` (P11):**
```sql
INSERT INTO hub.run_steps (id, tenant_id, user_id, run_id, seq, type, agent_id, provider_key, job_id, workflow_id,
  label_key, status, detail)
SELECT $1, $2, $3, $4, coalesce(max(seq), 0) + 1, $5, $6, $7, $8, $9, $10, $11, $12
FROM hub.run_steps WHERE run_id = $4
RETURNING seq;
```
23505 `run_steps_run_seq_uq` → thử lại (≤ 3, rồi `INTERNAL_ERROR`). Index: `run_steps_run_seq_uq`.
**Phiên `dify-agent`:** đọc `SELECT session_id FROM hub.cli_sessions WHERE conversation_id=$1 AND agent_id=$2 AND provider_key='dify' AND tenant_id=$3`; ghi như UPSERT H1 `plan-db` §5.4 với `provider_key='dify'`, chỉ khi Dify trả `conversation_id`.

## 3. Xác nhận `side_effect` (R21–R22)
Bất biến: E12 quyết định **mọi** `pending` của flow; flow chỉ có một run `running` (`runs_flow_running_uq`) ⇒ `pending` thấy ở E12 luôn thuộc run ngay trước.

### 3.1 E12 (trong `createRunTx`, transaction `user`, sau `INSERT messages`, chỉ khi flow đã tồn tại)
```sql
UPDATE hub.tool_confirmations
SET status = CASE WHEN status = 'pending' AND $3 THEN 'confirmed'
                  WHEN status = 'pending' THEN 'declined' ELSE 'expired' END,
    decided_run_id = CASE WHEN status = 'pending' THEN $2 ELSE decided_run_id END,
    decided_at = coalesce(decided_at, now())
WHERE flow_id = $1 AND status IN ('pending', 'confirmed');
```
`$2` = run mới, `$3` = `isAgreeReply(content)` (tin `/lệnh` → false). `confirmed` của run trước chưa dùng → `expired`. Trace (`run_steps.detail` bước đầu của run mới): `confirmation: confirmed|declined` khi có dòng.

### 3.2 `tools/call` tool `side_effect` (transaction `user` theo tenant/user của job)
1. `UPDATE hub.tool_confirmations SET status='consumed', consumed_at=now() WHERE flow_id=$1 AND agent_id=$2 AND workflow_id=$3 AND status='confirmed' AND decided_run_id=$4 RETURNING id` — 1 dòng → COMMIT → gọi Dify (trace `consumed`).
2. 0 dòng → `INSERT INTO hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status) VALUES ($5,$6,$1,$4,$2,$3,'pending') ON CONFLICT (flow_id, agent_id, workflow_id) WHERE status IN ('pending','confirmed') DO UPDATE SET run_id = EXCLUDED.run_id, created_at = now() WHERE hub.tool_confirmations.status = 'pending'` → `insertStep(type='tool', status='failed', detail:{code:'CONFIRMATION_REQUIRED'})` → COMMIT → result `isError:true`, `content[0]` JSON + `content[1]` câu chỉ dẫn + `structuredContent` (plan §2.3; câu: `plan-errors` §5), **không** gọi Dify.
Thứ tự khoá: `run_steps → tool_confirmations` (H1 §3.5 + `plan.md` §3). `side_effect(workflow)` = cột `admin.workflows.side_effect` nếu cache phát hiện có cột, không thì `workflow_flags.side_effect` (R23).

## 4. Seed (D3, H1 §3.6)
| File | Thêm |
|---|---|
| `providers.yaml` | `dify`: `kind: api`, `vendor: dify`, `max_concurrency: 5`, không `dev_only` |
| `agents.yaml` | ví dụ `dify-tom` (`runtime: dify-workflow`, `runtime_options.workflow_key: tom` — workflow có đúng một input chuỗi bắt buộc, QA2-1; **không** trỏ `dich`: 2 input bắt buộc ⇒ `difyAgentInput` = null), `dify-tro-ly` (`dify-agent`, `tro-ly`); `profile` bắt buộc theo schema H1 (không dùng khi chạy) |
| `workflows.yaml` (mới) | `agent_workflows: [{agent, workflow}]` (upsert, không xoá) · `workflow_flags: {side_effect: [<key>…]}` (upsert `workflow_flags`) |

Luật seed (`seed.rules.ts`): `workflow_key`/`workflow` không có trong `admin.workflows` → bỏ dòng + cảnh báo (môi trường chưa nhập catalog, như grant Q8 H1); có mà `app_type` không khớp runtime (`dify-workflow`↔`workflow`, `dify-agent`↔`chat|agent`) hoặc `difyAgentInput` = null → **lỗi seed** (exit 1, R14). `runtime_options` thừa khoá → lỗi. Key workflow theo `CATALOG_KEY_RE` (gạch nối, không gạch dưới: tool AC-H22 = `create-trello-card`).

## 5. DB test
Test H2a dùng DB H1 `ai_system_h1_test` (`HUB_TEST_DATABASE_URL`). **Không** chạy `runHubMigrations` trên `TEST_DATABASE_URL` của Admin (H1 §7) — test khoá Admin không thấy hàm/bảng H2a.
