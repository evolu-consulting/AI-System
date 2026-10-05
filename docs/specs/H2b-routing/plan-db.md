# Plan · H2b · DB + SQL (phụ lục `plan.md` §3)

Luật: **không sửa migration đã commit** (`0000`–`0005`); mọi thay đổi ở `0006` mới, viết tay, idempotent (`IF NOT EXISTS`, đổi CHECK qua `DO $$ … pg_constraint`), chạy được trên DB sạch và DB đã có `0005`. Chỉ nới tập giá trị / thêm cột NULL / thêm index — không mất dữ liệu. `meta/_journal.json` thêm `idx 6`, tag `0006_h2b_routing`.

## 1. `packages/db/migrations-hub/0006_h2b_routing.sql` (D1) · `schema/hub.ts` thêm cột
```sql
-- runs: run gọi thẳng (kind='direct'), Orchestrator theo tenant, responder (Q1=B)
ALTER TABLE hub.runs ADD COLUMN IF NOT EXISTS agent_id uuid,
  ADD COLUMN IF NOT EXISTS orchestrator_tenant_id uuid,
  ADD COLUMN IF NOT EXISTS responder_key text,
  ADD COLUMN IF NOT EXISTS responder_name text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_kind_check' AND conrelid = 'hub.runs'::regclass
                 AND pg_get_constraintdef(oid) LIKE '%''direct''%') THEN
    ALTER TABLE hub.runs DROP CONSTRAINT IF EXISTS runs_kind_check;
    ALTER TABLE hub.runs ADD CONSTRAINT runs_kind_check CHECK (kind IN ('orchestrated', 'command', 'direct'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_direct_ck' AND conrelid = 'hub.runs'::regclass) THEN
    ALTER TABLE hub.runs ADD CONSTRAINT runs_direct_ck CHECK ((kind = 'direct') = (agent_id IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_responder_ck' AND conrelid = 'hub.runs'::regclass) THEN
    ALTER TABLE hub.runs ADD CONSTRAINT runs_responder_ck CHECK (
      (kind = 'direct') = (responder_key IS NOT NULL)
      AND (responder_key IS NULL) = (responder_name IS NULL)
      AND (responder_name IS NULL OR char_length(responder_name) BETWEEN 1 AND 100));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_orch_tenant_ck' AND conrelid = 'hub.runs'::regclass) THEN
    ALTER TABLE hub.runs ADD CONSTRAINT runs_orch_tenant_ck CHECK (
      orchestrator_tenant_id IS NULL OR (kind = 'orchestrated' AND orchestrator_tenant_id = tenant_id));
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS runs_user_running_idx ON hub.runs (tenant_id, user_id) WHERE status = 'running';
--> statement-breakpoint
-- orchestrator_settings: hàng mặc định id=1 (tenant_id NULL), hàng tenant id từ sequence (R13–R15, P6)
ALTER TABLE hub.orchestrator_settings ADD COLUMN IF NOT EXISTS tenant_id uuid;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS hub.orchestrator_settings_id_seq AS smallint START WITH 2 MINVALUE 2
  OWNED BY hub.orchestrator_settings.id;
--> statement-breakpoint
ALTER TABLE hub.orchestrator_settings ALTER COLUMN id SET DEFAULT nextval('hub.orchestrator_settings_id_seq');
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE hub.orchestrator_settings DROP CONSTRAINT IF EXISTS orchestrator_settings_id_check;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orchestrator_settings_scope_ck'
                 AND conrelid = 'hub.orchestrator_settings'::regclass) THEN
    ALTER TABLE hub.orchestrator_settings ADD CONSTRAINT orchestrator_settings_scope_ck
      CHECK ((id = 1) = (tenant_id IS NULL));
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_settings_tenant_uq ON hub.orchestrator_settings (tenant_id)
  WHERE tenant_id IS NOT NULL;
--> statement-breakpoint
-- jobs: lý do `refused` (F4, R27) — tập 0004 + refused
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_error_reason_check'
                 AND conrelid = 'hub.jobs'::regclass AND pg_get_constraintdef(oid) LIKE '%''refused''%') THEN
    ALTER TABLE hub.jobs DROP CONSTRAINT IF EXISTS jobs_error_reason_check;
    ALTER TABLE hub.jobs ADD CONSTRAINT jobs_error_reason_check CHECK (
      error_reason IS NULL
      OR error_reason IN ('quota', 'tenant_slots', 'provider_busy', 'provider_unavailable', 'orphaned', 'crash',
                          'cancelled', 'timeout', 'invalid_payload', 'invalid_output', 'sandbox', 'credential',
                          'upstream', 'refused'));
  END IF;
END
$$;
```
Tập `error_reason` phải **bằng** `JOB_FAIL_REASONS` sau C2 (D1 đối chiếu với `0004` khi viết). Không GRANT mới: `runs` đã GRANT mức bảng cho `hub_rw` (`0000:453`); `orchestrator_settings` chỉ owner ghi (seed), `hub_rw` SELECT có sẵn; RLS `runs` không đổi (đếm R16 chạy trong scope `user` của E12 — chỉ thấy run của chính user).

`schema/hub.ts`: `runs` + `agentId`, `orchestratorTenantId`, `responderKey`, `responderName`; `orchestratorSettings` + `tenantId`. Kiểu `kind` thêm `"direct"`.

## 2. SQL E12 (`runs/create-run.ts`, transaction `user`, postgres.js/drizzle `sql`)
| Bước | Câu |
|---|---|
| Khoá user (đầu tiên, P8) | `SELECT pg_advisory_xact_lock(hashtext('hub.runs.user'), hashtext($user_id::text));` |
| Hội thoại / flow | H1 §5.1 (`touchConversation` → 404; `touchFlow` → 404 / `insertFlow`) |
| `flowRunning` (chỉ khi `flow_id` gửi lên) | `SELECT EXISTS (SELECT 1 FROM hub.runs WHERE flow_id = $1 AND status = 'running') AS busy;` → true ⇒ `FLOW_BUSY` |
| `countRunning` | `SELECT count(*)::int AS n FROM hub.runs WHERE tenant_id = $1 AND user_id = $2 AND status = 'running';` (index `runs_user_running_idx`) → `n >= limit` ⇒ `TOO_MANY_RUNS` |
| INSERT runs | H1 + `kind`, `agent_id`, `orchestrator_tenant_id`, `responder_key`, `responder_name` |
| Sau đó | INSERT messages → `decideConfirmations` (§3) — như H2a |

Lỗi ném trong transaction ⇒ ROLLBACK (không message, không run — R17). 23505 `runs_flow_running_uq` vẫn ⇒ `FLOW_BUSY` (chốt chặn). Đọc E10/E11: câu `conversations.repo` lấy thêm `r.kind, r.responder_key, r.responder_name` khi join `runs`.

## 3. Xác nhận với tag (R12) — `runs/confirm.repo.ts`
`$agree` = `isAgreeReply(nội dung R04)`; `$tag_agent` = uuid khi tag đơn, NULL khi không tag; `$multi` = true khi ≥ 2 tag.
```sql
UPDATE hub.tool_confirmations
SET status = CASE
      WHEN status = 'pending' AND $agree AND NOT $multi
           AND ($tag_agent::uuid IS NULL OR agent_id = $tag_agent::uuid) THEN 'confirmed'
      WHEN status = 'pending' THEN 'declined'
      ELSE 'expired' END,
    decided_run_id = CASE WHEN status = 'pending' THEN $run_id::uuid ELSE decided_run_id END,
    decided_at = coalesce(decided_at, now())
WHERE flow_id = $flow_id AND status IN ('pending', 'confirmed')
RETURNING agent_id, workflow_id, status, decided_run_id = $run_id::uuid AS from_pending;
```
Bước `tool` `skipped` + `detail.confirmation` như H2a. Tiêu thụ ở `tools/call` không đổi (H2a-R22).

## 4. Seed `orchestrator_tenants` (`seed.repo.ts`, transaction seed H1)
```sql
INSERT INTO hub.orchestrator_settings (tenant_id, agent_id, max_steps, token_budget, history_n, on_no_match)
SELECT $tenant_id, a.id, $max_steps, $token_budget, $history_n, $on_no_match FROM hub.agents a WHERE a.key = $agent
ON CONFLICT (tenant_id) WHERE tenant_id IS NOT NULL DO UPDATE SET agent_id = excluded.agent_id,
  max_steps = excluded.max_steps, token_budget = excluded.token_budget, history_n = excluded.history_n,
  on_no_match = excluded.on_no_match, version = hub.orchestrator_settings.version + 1, updated_at = now()
WHERE (hub.orchestrator_settings.agent_id, hub.orchestrator_settings.max_steps, hub.orchestrator_settings.token_budget,
       hub.orchestrator_settings.history_n, hub.orchestrator_settings.on_no_match)
  IS DISTINCT FROM (excluded.agent_id, excluded.max_steps, excluded.token_budget, excluded.history_n, excluded.on_no_match);
DELETE FROM hub.orchestrator_settings WHERE tenant_id = $tenant_id;   -- remove: true
```
`upsertOrchestrator` (mặc định) đổi `on conflict (id)` → giữ nguyên `id = 1` (không đổi câu). `config.repo` đọc: `SELECT … FROM hub.orchestrator_settings` (mọi hàng) → `id=1` → `orchestrator`, còn lại → `orchestratorTenants`.

## 5. DB test (D1, `packages/db/src/hub-h2b.int.test.ts`)
| Ca | Kỳ vọng |
|---|---|
| `kind='direct'` thiếu `agent_id` / thiếu `responder_*` | 23514 `runs_direct_ck` / `runs_responder_ck` |
| `kind='orchestrated'` có `responder_key` | 23514 `runs_responder_ck` |
| `orchestrator_tenant_id ≠ tenant_id` · `kind='command'` có `orchestrator_tenant_id` | 23514 `runs_orch_tenant_ck` |
| `kind='workflow'` | 23514 `runs_kind_check` (giữ H2a `db.int:92`) |
| INSERT settings `(1, agent, …)` không `tenant_id` (như H1 `_hub.ts:73`) | ok |
| INSERT settings `tenant_id=X` không `id` | `id ≥ 2`; lần hai cùng X → 23505 `orchestrator_settings_tenant_uq` |
| `id=1` có `tenant_id` · `id=5` không `tenant_id` | 23514 `orchestrator_settings_scope_ck` |
| `jobs.error_reason='refused'` | ok; `'nope'` → 23514 |
| Chạy `0006` hai lần | không lỗi (idempotent) |
| `EXPLAIN` `countRunning` | dùng `runs_user_running_idx` |
| Test khoá H1 A48–A51, H2a `db.int` | xanh nguyên văn |
