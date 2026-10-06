# Plan · H3b · DB (migration + SQL nguyên văn)

Phụ lục của [`plan.md`](plan.md) §3, §6. Hub TS dùng Drizzle `sql\`…\`` (tham số `${x}`); ở đây viết `$n` cho gọn. Mọi câu đọc/ghi `agent_grants`, `agent_entitlements`, `admin.groups`, `admin.users`, `jobs`, `usage_logs`, `audit_log` **có `tenant_id = T`** (R03 — bảng không RLS). Câu không ghi ở đây = **không đổi**.

## 1. Migration `packages/db/migrations-hub/0009_h3b_agent_grants.sql` (D1)
Viết tay, idempotent (như `0007`/`0008`). Chỉ **thêm**: 1 bảng, 1 index trên bảng có sẵn, GRANT. Không đổi cột/RLS bảng cũ (R22), không mất dữ liệu.

```sql
-- HUB-FR-78 · HUB-FR-87 · H3b-R08, R16, R22 (plan-db H3b §1): audit Hub append-only, quyền ghi grant cho hub_rw, index trace.
CREATE TABLE IF NOT EXISTS hub.audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid NOT NULL,
  actor_id uuid,
  actor_username text,
  actor_role text,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  entity_name text NOT NULL DEFAULT '',
  hub_config_version integer,
  before jsonb,
  after jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT hub_audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT hub_audit_log_seq_uq UNIQUE (seq),
  CONSTRAINT hub_audit_log_action_check CHECK (action IN ('grant', 'revoke', 'view_trace')),
  CONSTRAINT hub_audit_log_entity_check CHECK (entity IN ('agent_grant', 'run')),
  CONSTRAINT hub_audit_log_actor_role_check
    CHECK (actor_role IS NULL OR actor_role IN ('platform_admin', 'tenant_admin', 'member')),
  CONSTRAINT hub_audit_log_entity_name_check CHECK (char_length(entity_name) <= 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS hub_audit_log_tenant_seq_idx ON hub.audit_log (tenant_id, seq DESC);
CREATE INDEX IF NOT EXISTS hub_audit_log_entity_seq_idx ON hub.audit_log (entity, entity_id, seq DESC);
CREATE INDEX IF NOT EXISTS hub_audit_log_actor_seq_idx ON hub.audit_log (actor_id, seq DESC);
--> statement-breakpoint
-- Append-only cả với owner (như admin.audit_log M4-R11): UPDATE/DELETE theo hàng + TRUNCATE theo câu → P0001.
CREATE OR REPLACE FUNCTION hub.audit_log_append_only() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'hub.audit_log is append-only (%)', TG_OP;
END $$;
REVOKE ALL ON FUNCTION hub.audit_log_append_only() FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_audit_log_append_only'
                 AND tgrelid = 'hub.audit_log'::regclass) THEN
    CREATE TRIGGER hub_audit_log_append_only BEFORE UPDATE OR DELETE ON hub.audit_log
      FOR EACH ROW EXECUTE FUNCTION hub.audit_log_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'hub_audit_log_append_only_truncate'
                 AND tgrelid = 'hub.audit_log'::regclass) THEN
    CREATE TRIGGER hub_audit_log_append_only_truncate BEFORE TRUNCATE ON hub.audit_log
      FOR EACH STATEMENT EXECUTE FUNCTION hub.audit_log_append_only();
  END IF;
END $$;
--> statement-breakpoint
-- Trace (R18): usage theo run — usage_logs chỉ có index (tenant_id, at)/(job_id). Bảng nhỏ ở dev; prod: xem PRODUCTION-NOTES (I3).
CREATE INDEX IF NOT EXISTS usage_logs_run_idx ON hub.usage_logs (run_id) WHERE run_id IS NOT NULL;
--> statement-breakpoint
-- R08, R22 (PL2): hub_rw ghi grant + khoá/tăng hub_config_version (UPDATE chỉ một cột; FOR UPDATE cần quyền UPDATE).
GRANT INSERT, DELETE ON hub.agent_grants TO hub_rw;
GRANT UPDATE (hub_config_version) ON hub.config_meta TO hub_rw;
GRANT SELECT, INSERT ON hub.audit_log TO hub_rw;
```
Không GRANT `hub.audit_log` cho `admin_rw` / `agent_runtime` (PL6 — Admin đọc là CR-impact). Không RLS trên `hub.audit_log` (chỉ Hub ghi/đọc; cách ly ở repo — PL6). Cột identity không cần GRANT sequence (Postgres không kiểm `USAGE` sequence của identity) — D1 test xác nhận bằng `hub_api`.

`meta/_journal.json`: `{"idx": 9, "version": "7", "when": <ms sau 0008>, "tag": "0009_h3b_agent_grants", "breakpoints": true}`.

**Drizzle** (`packages/db/src/schema/hub.ts`): thêm `hubAuditLog = hub.table("audit_log", …)` (tên export tránh trùng `auditLog` của `ops.ts`) đúng cột trên (`seq` `bigint({mode:"number"}).generatedAlwaysAsIdentity()`); header file thêm `0009`. `agentGrants` **giữ ở `hub-readonly.ts`** (Q-K13): Hub ghi bằng cùng định nghĩa (`import { agentGrants } from "@ai/db"` như `config.repo.ts`); chỉ sửa một dòng comment đầu `hub-readonly.ts` ("Hub ghi `agent_grants` từ H3b") — không thêm cột.

**Test D1** `packages/db/src/hub-h3b.int.test.ts`: bảng + 3 index + `usage_logs_run_idx` có; `hub_api` INSERT `audit_log` được (identity tự sinh), UPDATE/DELETE/TRUNCATE → 42501 (hub_api) và P0001 (owner); CHECK chặn `action='x'`, `entity='x'`, `actor_role='x'`, `entity_name` 201 ký tự; `hub_api` INSERT/DELETE `agent_grants` được, UPDATE `agent_grants` → 42501; `hub_api` `UPDATE hub.config_meta SET hub_config_version = …` được, `UPDATE … SET id = 1` → 42501, `SELECT … FOR UPDATE` được; `admin_rw` SELECT `hub.audit_log` → 42501; chạy lại migration không lỗi; A51 (H1) + `ADM-NFR-06/migrate.int` xanh nguyên văn.

## 2. SQL `/agent-grants` (`modules/agent-grants/agent-grants.repo.ts`)
| Tên | SQL | Index |
|---|---|---|
| `TENANT_EXISTS` | `SELECT 1 FROM admin.tenants WHERE id = $1` (chỉ khi `platform_admin`) | PK |
| `AGENT_CHECK` | `SELECT a.id, a.key, a.name, EXISTS (SELECT 1 FROM hub.orchestrator_settings o WHERE o.agent_id = a.id) AS is_orch, (e.agent_id IS NOT NULL AND e.revoked_at IS NULL) AS entitled FROM hub.agents a LEFT JOIN hub.agent_entitlements e ON e.agent_id = a.id AND e.tenant_id = $1 WHERE a.id = $2` | PK agents, PK `(agent_id, tenant_id)` |
| `SUBJECT_GROUP` | `SELECT id, key, name FROM admin.groups WHERE id = $2 AND tenant_id = $1` | PK |
| `SUBJECT_USER` | `SELECT id, username, display_name FROM admin.users WHERE id = $2 AND tenant_id = $1` (cột hub_ro được GRANT) | PK |
| `ACTOR_NAME` | `SELECT username FROM admin.users WHERE id = $1` (actor = `JWT.sub`; vắng → NULL) | PK |
| `LOCK_META` | `SELECT hub_config_version AS v FROM hub.config_meta WHERE id = 1 FOR UPDATE` | PK |
| `INSERT_GRANT` | `INSERT INTO hub.agent_grants (agent_id, tenant_id, subject_type, subject_id, granted_by) VALUES ($2, $1, $3, $4, $5) ON CONFLICT (agent_id, tenant_id, subject_type, subject_id) DO NOTHING RETURNING id, granted_at` | `agent_grants_uq` |
| `FIND_GRANT` | `SELECT id, granted_by, granted_at FROM hub.agent_grants WHERE tenant_id = $1 AND agent_id = $2 AND subject_type = $3 AND subject_id = $4` | `agent_grants_uq` |
| `DELETE_GRANT` | `DELETE FROM hub.agent_grants WHERE tenant_id = $1 AND agent_id = $2 AND subject_type = $3 AND subject_id = $4 RETURNING id, granted_by, granted_at` | `agent_grants_uq` |
| `BUMP_META` | `UPDATE hub.config_meta SET hub_config_version = hub_config_version + 1 WHERE id = 1 RETURNING hub_config_version AS v` | PK |
| `NOTIFY` | `SELECT pg_notify('hub_config_changed', $1)` — `$1 = JSON.stringify({v: HUB_CONTRACT_VERSION, version})` (y hệt `seed.repo.ts` `notifyHubConfigChanged`) | — |
| `LIST_AGENTS` | `SELECT a.id, a.key, a.name, a.description, a.enabled, a.runtime FROM hub.agent_entitlements e JOIN hub.agents a ON a.id = e.agent_id WHERE e.tenant_id = $1 AND e.revoked_at IS NULL AND NOT EXISTS (SELECT 1 FROM hub.orchestrator_settings o WHERE o.agent_id = a.id) ORDER BY a.key LIMIT 201` (201 ⇒ cắt 200 + `truncated`) | `agent_entitlements_tenant_active_idx` |
| `LIST_GRANTS` | xem dưới | `agent_grants_subject_idx` (`tenant_id` đầu) |

```sql
-- LIST_GRANTS ($1 T, $2 uuid[] agent id của LIST_AGENTS, $3 subject_type|NULL, $4 subject_id|NULL)
SELECT g.id, g.agent_id, g.subject_type, g.subject_id, g.granted_at, gb.username AS granted_by,
       gr.key AS group_key, gr.name AS group_name, u.username, u.display_name
FROM hub.agent_grants g
LEFT JOIN admin.groups gr ON g.subject_type = 'group' AND gr.id = g.subject_id AND gr.tenant_id = $1
LEFT JOIN admin.users u ON g.subject_type = 'user' AND u.id = g.subject_id AND u.tenant_id = $1
LEFT JOIN admin.users gb ON gb.id = g.granted_by
WHERE g.tenant_id = $1 AND g.agent_id = ANY($2::uuid[])
  AND ($3::text IS NULL OR (g.subject_type = $3::text AND g.subject_id = $4::uuid))
  AND (gr.id IS NOT NULL OR u.id IS NOT NULL)            -- Q-K8: bỏ grant mồ côi
ORDER BY g.agent_id, CASE g.subject_type WHEN 'group' THEN 0 ELSE 1 END, coalesce(gr.key, u.username)
```
Mảng uuid: `sql.array(ids, 2951)`/Drizzle `${ids}::uuid[]` — bẫy postgres.js (CONVENTIONS §2): truyền mảng bằng `sql.array` khi dùng client thô. Mỗi agent cắt `grants` ở `AGENT_GRANTS_PER_AGENT_MAX` trong TS + `grants_total`.

## 3. Hàng audit (`lib/hub-audit.ts`, R16)
`INSERT INTO hub.audit_log (tenant_id, actor_id, actor_username, actor_role, action, entity, entity_id, entity_name, hub_config_version, before, after, summary) VALUES (…)` — jsonb bằng `sql.json`/`::jsonb` từ `JSON.stringify` (bẫy CONVENTIONS §2).

| action | entity · entity_id · entity_name | tenant_id | hub_config_version | before / after | summary |
|---|---|---|---|---|---|
| `grant` | `agent_grant` · id hàng mới · `<agent_key> → <group_key\|username>` (≤ 200, cắt) | `T` | version **sau** bump | `null` / `{agent_id, agent_key, subject_type, subject_id, subject_key}` | `{}` |
| `revoke` | `agent_grant` · id hàng đã xoá · như trên | `T` | sau bump | `{…như after của grant, granted_by, granted_at}` / `null` | `{}` |
| `view_trace` | `run` · `run.id` · `''` | `run.tenant_id` | `NULL` | `null` / `null` | `{run_user_id, run_status}` |

Không ghi nội dung tin, prompt, `detail`, secret (R16). `actor_role` = `JWT.role`.

## 4. SQL `/agent-grants/effective/:user_id` (R12–R15)
Tính trên **ảnh cache** (`ConfigCache.snapshot()` + `user()` + `tenant()`), không đọc `agent_grants` từ DB. Chỉ một câu DB lấy tên group cho `reasons`:
`GROUP_REFS`: `SELECT id, key, name FROM admin.groups WHERE tenant_id = $1 AND id = ANY($2::uuid[])` (PK). Group của user không còn trong `admin.groups` (đã xoá giữa hai lần nạp) → bỏ khỏi `reasons` (không 500).

## 5. SQL `/runs/:id/trace` (`modules/runs/trace/trace.repo.ts`, R17–R19)
Chạy trong **một** transaction `withHubScope`: nhánh (a) scope `user {tid, sub}`; nhánh (b) scope `system` **chỉ sau** khi `traceAccess` trả `platform` (plan §5.4). `$T` = `run.tenant_id` đọc ở câu đầu.

| Tên | SQL | Index |
|---|---|---|
| `TRACE_RUN` | `SELECT id, tenant_id, user_id, kind, status, error_code, error_message, error_hint, config_version, conversation_id, flow_id, user_message_id, answer_message_id, tokens_used, started_at, finished_at FROM hub.runs WHERE id = $1` (+ `ownedBy` ở scope user, như `runs.repo.findRun`) | PK |
| `TRACE_STEPS` | `SELECT s.id, s.seq, s.type, s.agent_id, a.key AS agent_key, s.workflow_id, s.provider_key, s.job_id, s.label_key, s.status, s.detail, s.started_at, s.finished_at FROM hub.run_steps s LEFT JOIN hub.agents a ON a.id = s.agent_id WHERE s.run_id = $1 AND s.tenant_id = $T ORDER BY s.seq LIMIT 201` | `run_steps_run_seq_uq` |
| `TRACE_JOBS` | `SELECT id, step_id, type, provider_key, status, attempts, error_code, error_reason, created_at, started_at, finished_at FROM hub.jobs WHERE run_id = $1 AND tenant_id = $T ORDER BY created_at, id LIMIT 201` (**không** `payload`, `result`, `token_hash`, `error_message`) | `jobs_run_idx` |
| `TRACE_USAGE` | `SELECT step_id, max(model) AS model, sum(input_tokens)::int AS input_tokens, sum(output_tokens)::int AS output_tokens, CASE WHEN count(cost_usd) = count(*) THEN sum(cost_usd)::text END AS cost_usd, CASE WHEN count(billable_usd) = count(*) THEN sum(billable_usd)::text END AS billable_usd FROM hub.usage_logs WHERE run_id = $1 AND tenant_id = $T GROUP BY step_id` | `usage_logs_run_idx` (mới) |
| `TRACE_MESSAGES` | `SELECT id, role, content, created_at FROM hub.messages WHERE tenant_id = $T AND id IN ($user_message_id, $answer_message_id)` | PK |
| `AUDIT_VIEW` | §3 `view_trace` — **sau** `TRACE_RUN` tìm thấy, **trước** các câu đọc còn lại, cùng transaction | — |

`jobs.error_message` không trả (có thể chứa thông điệp thô Runtime — R18; `error_code`/`error_reason` đủ). `usage_logs` `step_id` NULL (usage Orchestrator không gắn step) gộp vào `usage_total` của run, không vào step.
