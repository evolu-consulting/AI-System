# Plan · H1-hub-core (BE TS + phần dùng chung)

Python: `plan-runtime.md`. Bảng Runtime + SQL Runtime: `plan-db.md`. Luật: spec §2. Chat: `C1 plan §2` (chỉ import).

## 1. Quyết định
| # | Quyết định | Lý do |
|---|---|---|
| P1 | Migration Hub ở `packages/db/migrations-hub/` (theo dõi `drizzle.__drizzle_migrations_hub`) + `migrations-hub-dev/` (mật khẩu login dev); hàm mới `runHubMigrations({url, appEnv}) → {hub, hubDev}`, CLI `db:migrate` gọi sau `runMigrations` (không đổi). SQL viết tay idempotent (`IF NOT EXISTS`, ràng buộc qua `DO $$ … pg_constraint`), không sửa stub; `schema/hub.ts` chỉ cho kiểu | Test khoá Admin (`ADM-NFR-06/migrate`, `M1–M3/db-schema`, `migrate.int.test.ts`, e2e `prepare-db`) gọi `runMigrations`, assert `{main: 9, dev: 3}` + đúng 3 bảng `hub.*` → xanh nguyên văn. DB sạch: main → hub; DB dev: main → stub → hub |
| P3 | Không FK `hub.* → admin.*`; `usage_logs` không FK, không RLS | Admin đọc toàn nền (`usage.repo.ts`) |
| P4 | JWT: **chép** phần verify (≈ 40 dòng, `jose` có sẵn) vào `apps/hub-api/src/lib/jwt.ts`, cùng `ISSUER="admin"`, `aud="ai-system"`, `EdDSA`; test vector theo dạng `signAccessToken`; AC-01 kiểm bằng token thật. TECH-DEBT (điều phối): gộp vào `packages/auth` | Không sửa Admin; import chéo `apps/*` vi phạm depcruise |
| P5 | Claim: **một** advisory lock toàn cục `K_CLAIM`, không theo provider | Slot tenant đếm chung mọi provider subscription: lock theo provider vẫn vượt `max_concurrent_sub`. Claim vài ms, H1 vài slot |
| P6 | Kết quả agent **đệm**: Runtime trả `job.result` khi xong; Hub cắt thành `delta` (H1-R09) | `partial/need_input` chỉ biết ở cuối; pass-through vẫn bỏ được một job Orchestrator |
| P7 | Hub và Runtime đều quét orphan (§5.5); AgentRunner đọc `jobs.status` mỗi 2 s khi im | AC-04: Runtime chết thì không ai quét |
| P8 | `max_wait_s`: AgentRunner hết hạn job `queued` của mình (§5.6) | Không Runtime nào sống vẫn ra `ALL_PROVIDERS_EXHAUSTED` đúng hạn |
| P9 | E12 và E13 cùng đọc `sse:<run_id>` từ Redis; chỉ `SseWriter` của instance chủ ghi | Id như nhau mọi instance |
| P10 | Redis TS `ioredis` 6.0.0 (ADR-0001); JSON Schema bằng `z.toJSONSchema` (zod 4); pydantic bằng `datamodel-code-generator` — ADR-0009 | §2.6 |

## 2. Contract `@ai/contracts/hub`
`packages/contracts/src/hub/{common,job,events,result,decision,manifest,notify,errors,export,index}.ts`; `package.json` thêm `"./hub"` (không đụng `src/index.ts`). Chỉ dùng `strictObject, literal, enum, discriminatedUnion, string min/max/regex, number int min/max, nullable, array min/max, z.uuid(), z.iso.datetime({offset:true})`; cấm `refine/transform/coerce/default` (test `z.toJSONSchema(s, {unrepresentable:"throw"})`).

### 2.1 Chung
`v: z.literal(1)` ở mọi payload/sự kiện/NOTIFY. `AgentKey` = `^[a-z][a-z0-9-]{1,47}$` (cả key provider/profile/agent_type). `AllowedTool` = `enum["Read","Grep","Glob"]` (H1-R21). `TokenUsage` = `{input_tokens, output_tokens: int ≥ 0}`.

### 2.2 `JobPayload` (`hub.jobs.payload`)
`discriminatedUnion("type", [AgentCliJob])`; `agent.run` thêm ở H2.

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `v` · `type` · `runtime` | `1` · `"agent.cli"` · `"agentic-cli"` | |
| `job_id, run_id, step_id, tenant_id, user_id, conversation_id, flow_id` | uuid | `step_id` = `run_steps.id` |
| `feature_id` · `agent_type_key` · `mcp` | nullable uuid · nullable AgentKey · `null` | H1 đều `null` |
| `agent` | `{id: uuid, key: AgentKey, role: enum[orchestrator, agent]}` | |
| `provider_key` · `model` · `step_index` | AgentKey · nullable 1–100 · int 0–4 | bước đang chạy (H1 `0`); `model` = `profile_steps[step_index].model`, null = mặc định CLI |
| `max_turns` | int 1–100 | `runtime_options.max_turns`; thiếu → agent 30, Orchestrator 3 (Hub điền, schema không `default`) |
| `profile_steps` | 1–5 × `{provider_key, model, on: enum["error","quota","timeout"][] 0–3}` | H1 1 bước |
| `system_prompt` · `prompt` | 0–20 000 · 1–200 000 | Orchestrator §6.2–6.3; agent `prompt` = `task` |
| `history` | 0–50 × `{role: enum[user, assistant], content: 0–64 000}` (tên `content` như `messages.content`) | `history_n` của flow; dùng khi không resume (H1-R23) |
| `use_session` · `allowed_tools` | boolean · AllowedTool[] 0–3 | agent `true` + `runtime_options.allowed_tools` (mặc định Read, Grep); Orchestrator `false` + `[]` |
| `output` · `timeout_s` | enum[agent_result, text] · int 10–3600 | `text` = nguyên văn, Hub parse |

### 2.3 Sự kiện `run:<run_id>` (Runtime XADD, field `e` = JSON)
Chung: `v`, `job_id`, `seq: int ≥ 1` (tăng theo job), `at: iso datetime`. `RunEvent = discriminatedUnion("type")`:

| `type` | Thêm | Luật |
|---|---|---|
| `job.started` | `worker_id: 1–64`, `provider_key` | sau commit claim |
| `job.progress` | `message: 1–200`, `percent: 0–100 \| null` | R8; Hub H1 chỉ coi là nhịp sống |
| `job.result` | `output: {kind:"agent_result", result: AgentResult} \| {kind:"text", text: 0–64 000}`, `usage`, `session_resumed: boolean` | sau commit `succeeded` |
| `job.failed` | `status: "failed"\|"cancelled"\|"timed_out"`, `code: HubJobErrorCode`, `reason: JobFailReason \| null`, `message: 1–500` (an toàn), `usage` | sau commit; mỗi job **đúng một** `job.result`/`job.failed` |

### 2.4 `AgentResult` (HUB-FR-27) · `OrchestratorDecision`
- `AgentResult` (`"status"`): `done{text: 1–64 000}` · `partial{text: 1–64 000, missing: 1–2 000}` · `need_input{question: 1–2 000, choices: (1–200)[] 0–6}` (= `AskSchema` chat).
- `OrchestratorDecision` (`"decision"`): `delegate{agent: AgentKey, task: 1–8 000}` · `answer{text: 1–64 000}` · `ask{question: 1–2 000, choices: 0–6}`.

### 2.5 Manifest, NOTIFY, mã
| Tên | Định nghĩa |
|---|---|
| `AgentTypeManifest` | `{key: AgentKey, runtime: enum["agentic-cli","llm","python"], description: {vi, en: 1–400}, config_schema: record<string, unknown>, version: int ≥ 1}` |
| `job_enqueued` (Hub, trong transaction INSERT) | `{v, job_id, provider_key}` |
| `job_cancel` (Hub) | `{v, job_id, run_id}` |
| `hub_config_changed` (`hub:seed`) | `{v, version: int ≥ 1}` |
| `config_changed` | Admin, `ConfigChangedPayloadSchema` có sẵn; Hub chỉ parse |
| `HUB_JOB_ERROR_CODES` | `ALL_PROVIDERS_EXHAUSTED, TIMEOUT, CANCELLED, UPSTREAM_ERROR, INTERNAL_ERROR` (test: ⊂ `CHAT_RUN_ERROR_CODES`) |
| `JOB_FAIL_REASONS` | `quota, tenant_slots, provider_busy, provider_unavailable, orphaned, crash, cancelled, timeout, invalid_payload, invalid_output, sandbox` |
| `JOB_STATUSES` | `queued, running, succeeded, failed, cancelled, timed_out` (orphaned = `failed` + `reason=orphaned`) |
| Hằng | tên 3 kênh, `runStreamKey(id)`, `sseStreamKey(id)`, `RUN_STREAM_FIELD="e"` |

### 2.6 Sinh pydantic (C2)
File sinh: `apps/agent-runtime/contracts/hub.schema.json` (gộp `$defs`, key sắp ổn định) · `apps/agent-runtime/src/agent_runtime/contracts/hub.py` (header `# GENERATED by bun run contracts:gen`).
| Lệnh | Việc |
|---|---|
| `bun run contracts:gen` | `tools/contracts-gen/hub.ts`: `HUB_JSON_SCHEMAS` (export.ts: JobPayload, RunEvent, AgentResult, OrchestratorDecision, AgentTypeManifest, 3 NOTIFY) → `z.toJSONSchema(s, {target:"draft-2020-12", io:"output"})` → `hub.schema.json` → `uv run datamodel-codegen --input-file-type jsonschema --output-model-type pydantic_v2.BaseModel --target-python-version 3.12 --use-annotated --field-constraints --extra-fields forbid --enum-field-as-literal all --disable-timestamp` → `hub.py` |
| `bun run contracts:check` | sinh vào thư mục tạm, so byte với bản commit (khác → exit 1) + `bun test packages/contracts/src/hub` + `uv run pytest src/agent_runtime/contracts` |
| Mẫu hai chiều | `packages/contracts/fixtures/hub/{valid,invalid}/*.json` (mỗi schema ≥ 2 + ≥ 2): zod và pydantic cùng nhận/cùng từ chối; `model_dump_json()` của pydantic → zod parse được |

## 3. Dữ liệu (`migrations-hub/0000_hub_core.sql`)
Quy ước: `id uuid DEFAULT gen_random_uuid()`, thời gian `timestamptz NOT NULL DEFAULT now()`, cột NOT NULL trừ khi ghi `null`, key CHECK regex AgentKey, enum = CHECK `IN`.

### 3.1 Cấu hình (`hub:seed` ghi; Studio H4)
| Bảng | Cột | Ràng buộc |
|---|---|---|
| `config_meta` | `id smallint PK CHECK id=1`, `hub_config_version int DEFAULT 0` | |
| `providers` | `id, key, kind (subscription\|api), vendor (anthropic\|openai\|google\|fake), base_url null, secret_id uuid null, max_concurrency int DEFAULT 1 CHECK 1–100, enabled DEFAULT true, dev_only DEFAULT false, updated_at` | `providers_key_uq` |
| `model_profiles` | `id, key, steps jsonb [{provider_key, model, on[]}] 1–5, updated_at` | `key` unique. `provider_key` thay `provider_id` (BA): seed không phụ thuộc uuid |
| `agents` | `id, key, name jsonb {vi,en}, description CHECK len 20–400, runtime (agentic-cli\|llm\|python\|dify-workflow\|dify-agent), agent_type_key null (không FK), profile_id FK model_profiles RESTRICT, system_prompt DEFAULT '', runtime_options jsonb DEFAULT '{}', timeout_s DEFAULT 600 CHECK 10–3600, token_budget int null, enabled DEFAULT true, version DEFAULT 1, created_at, updated_at` | `key` unique |
| `orchestrator_settings` | `id smallint PK CHECK id=1, agent_id FK agents RESTRICT, max_steps DEFAULT 5 CHECK 1–20, token_budget DEFAULT 200000, history_n DEFAULT 10 CHECK 1–50, on_no_match DEFAULT 'answer' (answer\|ask), version, updated_by null, updated_at` | |
| `agent_entitlements` | `agent_id FK agents CASCADE, tenant_id, granted_by null, granted_at, revoked_at null` | PK `(agent_id, tenant_id)`; `(tenant_id) WHERE revoked_at IS NULL` |
| `agent_grants`, `agent_workflows` (stub) | giữ nguyên cột/CHECK/index | thêm FK `agent_id → agents ON DELETE CASCADE NOT VALID` (dòng cũ của test dev không bị kiểm) |

### 3.2 Hội thoại (hub-api, RLS §3.4)
| Bảng | Cột | Index (câu dùng) |
|---|---|---|
| `conversations` | `id, tenant_id, user_id, title CHECK 1–200, title_norm (bỏ dấu + lower, cho q), created_at, updated_at, deleted_at null` | `(tenant_id, user_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL` (E5 + cursor; `q` = `title_norm LIKE` trên tập của user) |
| `flows` | `id, tenant_id, user_id, conversation_id FK CASCADE, title, agent_id null FK agents SET NULL, pending_ask DEFAULT false, message_count DEFAULT 0, created_at, last_active_at` | `(conversation_id, created_at, id)` (E10) |
| `messages` | `id, tenant_id, user_id, conversation_id FK CASCADE, flow_id FK CASCADE, role (user\|assistant), content, run_id null, ask jsonb null, created_at` | `(flow_id, created_at, id)` (E11 flow, history); `(conversation_id, created_at, id)` (E11) |
| `runs` | `id, tenant_id, user_id, conversation_id FK CASCADE, flow_id FK CASCADE, kind DEFAULT 'orchestrated', status (running\|finished\|failed\|cancelled), config_version, user_message_id, answer_message_id (sinh lúc tạo; tin assistant INSERT khi kết thúc), owner null, lease_until null, last_seq DEFAULT 0, tokens_used DEFAULT 0, error_code null, error_message null, error_hint null, started_at, finished_at null` | `runs_flow_running_uq UNIQUE (flow_id) WHERE status='running'` (H1-R11); `(lease_until) WHERE status='running'` (sweeper). CHECK: `status<>'running' ⇔ finished_at IS NOT NULL`; `error_code ∈ CHAT_RUN_ERROR_CODES` ⇔ status failed/cancelled |
| `run_steps` | `id, tenant_id, user_id, run_id FK CASCADE, seq, type (orchestrator\|delegate), agent_id null, provider_key null, job_id null, label_key, status (running\|ok\|failed\|skipped), detail jsonb null (trace, không nội dung file), started_at, finished_at null` | `UNIQUE (run_id, seq)` |

### 3.3 Runtime (Python ghi, ADR-0007 #9)
`jobs, cli_sessions, provider_state, agent_types`, `usage_logs` (+ `job_id, cache_read_tokens, cache_write_tokens` nullable), `hub.tenant_sub_limit`: **`plan-db.md` §3.3**.

### 3.4 Role, GRANT, RLS
| Role | Quyền |
|---|---|
| `hub_rw` (NOLOGIN) | USAGE hub; CRUD 5 bảng §3.2; SELECT §3.1 + `provider_state, agent_types`; SELECT/INSERT/UPDATE `jobs`; SELECT `usage_logs` |
| `hub_api` (LOGIN, NOBYPASSRLS; mật khẩu dev ở `migrations-hub-dev`) | `GRANT hub_rw, hub_ro` → một URL `HUB_DATABASE_URL` |
| `agent_runtime` (LOGIN, NOBYPASSRLS; mật khẩu dev ở `migrations-hub-dev`) — role Runtime **duy nhất**, không role nhóm | USAGE hub; SELECT/UPDATE `jobs`; SELECT/INSERT `usage_logs`; CRUD `cli_sessions`; SELECT/INSERT/UPDATE `provider_state, agent_types`; SELECT `providers`; EXECUTE `tenant_sub_limit`. Không `admin.*`, không bảng hội thoại (bảng §3.3 không RLS ⇒ claim xuyên tenant) |
| `admin_rw` | `GRANT SELECT` lại 3 bảng stub (idempotent), không thêm |

RLS (`ENABLE` + policy `TO hub_rw`, mẫu `0002`) trên 5 bảng §3.2: `USING/WITH CHECK (current_setting('app.scope', true) = 'system' OR (current_setting('app.scope', true) = 'user' AND tenant_id = NULLIF(current_setting('app.tenant_id', true),'')::uuid AND user_id = NULLIF(current_setting('app.user_id', true),'')::uuid))`. `packages/db/src/hub-scope.ts`: `withHubScope(db, {kind:"user", tenantId, userId} | {kind:"system"}, fn)` (như `withScope`); `system` chỉ cho việc nền (runner, lease, quét). Bảng §3.3 không RLS; câu Hub vẫn lọc `tenant_id` (Q7).

### 3.5 Thứ tự khoá (mọi transaction ghi)
`[advisory K_CLAIM] → conversations → flows → runs → run_steps → messages → jobs → usage_logs → cli_sessions → provider_state`. Bỏ bước không cần, **không đảo**. Kết thúc/huỷ run phải `SELECT … FROM flows WHERE id=$f FOR UPDATE` **trước** `UPDATE runs`: E12 khoá flows rồi INSERT runs, và unique partial index `runs_flow_running_uq` chờ hàng run đang đổi — đảo là deadlock (bài học STATE). Test int: 50 vòng E12 ∥ kết thúc ∥ huỷ cùng flow, `deadlocks` không tăng.

### 3.6 Seed (D3)
`apps/hub-api/seed/*.yaml` + `bun run hub:seed` (owner): zod → một transaction upsert theo `key` (không xoá) → `hub_config_version + 1` → `pg_notify('hub_config_changed')`. `dev_only` chỉ khi `APP_ENV ∈ {development,test}`. Grant `{agent, tenant_key, subject: "user:<username>" | "group:<key>"}`; thiếu → bỏ + cảnh báo (Q8). Mặc định: `claude-sub`, `fake-cli` (cả hai subscription, max 2; fake `dev_only`); profile `claude-sub-1`, `fake-1`; agent `orchestrator` (profile = `HUB_SEED_PROFILE`, test `fake-1`) + `assistant`; entitlement `assistant` cho `acme`, `beta`; grant group `beta-testers` (trigger 0006 luôn tạo).

## 4. hub-api
`src/`: `app.ts, server.ts, config/env.ts, lib/{db,redis,logger,errors,jwt,auth.middleware}.ts`, `modules/{config,agents,conversations,flows,messages,runs,runner,orchestrator,seed}/` (`CONVENTIONS §2`).

| Endpoint | Ghi chú |
|---|---|
| E5–E11 | đúng `C1 plan §2.4`; E9 xoá mềm + huỷ run đang chạy (§5.7) |
| E12 | §5.1 |
| E13 | §5.3 |
| E14 | `last_event_id`: `runs.last_seq` (đã xong) / `XREVRANGE sse:<id> + - COUNT 1` |
| E15 | §5.7 |
| GET `/health` | `HealthResponseSchema`, không auth; DB/Redis lỗi → 503 |

Middleware: request_id → logger → auth (`verifyAccessToken`; tenant/user không hoạt động hoặc `locked_by_tenant` theo cache → 401 `AUTH_EXPIRED`). Repo nhận `ctx` từ JWT trong `withHubScope(user)`; không thấy → 404 mọi role. Lỗi theo `CHAT_API_ERRORS`. CORS `HUB_CORS_ORIGINS`.

Cache (`modules/config`): `admin.tenants(id, active, max_concurrent_sub)`, `admin.users(id, tenant_id, active, locked_by_tenant, locale)`, `admin.group_members`, `hub.*` cấu hình; LISTEN 2 kênh trên kết nối riêng (`config_changed` có `tenant_id` → nạp tenant đó), poll 60 s, user lạ → đọc rồi cache; run chụp `ConfigSnapshot{version}` (H1-R15).

## 5. Luồng và SQL khoá
### 5.1 E12 (một transaction `user`)
1. `SELECT 1 FROM conversations WHERE id=$c AND tenant_id=$t AND user_id=$u AND deleted_at IS NULL` → 404.
2. Có `flow_id`: `UPDATE flows SET message_count=message_count+2, last_active_at=now() WHERE id=$f AND conversation_id=$c` (0 dòng → 404); không: `INSERT flows (title=deriveTitle, message_count=2)`.
3. `INSERT messages (user)`. 4. `INSERT runs (running, owner=$me, lease_until=now()+30s, config_version, answer_message_id)` — 23505 `runs_flow_running_uq` → 409 `FLOW_BUSY`. 5. `UPDATE conversations SET updated_at=now()`.
Commit → `run.started` (id 1) → trả stream (P9) → vòng Orchestrator chạy nền. Run lỗi vẫn INSERT tin assistant (`run.failed` có `message_id`).

### 5.2 `SseWriter` (instance chủ)
`seq` trong bộ nhớ từ `runs.last_seq`. `XADD sse:<id> <seq>-0 e <json{event,data}>`; lần đầu `EXPIRE 86400`. Lỗi "ID equal or smaller" ⇒ instance khác đã chiếm run → dừng (fencing). Kết thúc: transaction `system` theo §3.5 (`flows FOR UPDATE` → `runs` status/`last_seq`/lỗi → `run_steps` → `INSERT messages(assistant, content, ask)` → `flows` `agent_id/pending_ask`) **rồi** XADD sự kiện kết thúc + `EXPIRE sse:<id> 600` (`RUN_EVENTS_RETENTION_S`) + `DEL run:<id>`. Lease mỗi 10 s: `UPDATE hub.runs SET lease_until=now()+interval '30 seconds' WHERE id=ANY($1) AND owner=$2 AND status='running'`.

### 5.3 E13
Run của user (404) → `n` = `parseLastEventId` (chat rules) → `eventsExpired` hoặc key mất → 410 → `XRANGE sse:<id> (<n>-0 +` rồi theo dõi qua `SseReader` (`XREAD BLOCK 1000` multiplex) tới sự kiện kết thúc; `: ping` 15 s. DB đã kết thúc mà stream thiếu sự kiện kết thúc → XADD dựng từ DB, `seq = last+1` (trùng id = đã có người làm).

### 5.4 SQL Runtime · 5.5 Quét orphan
Nguyên văn: **`plan-db.md` §5.4–5.5** (claim khoá toàn cục `K_CLAIM`, pgid, heartbeat, kết thúc + usage, provider, khởi động lại, manifest, XADD; quét orphan Hub và Runtime mỗi 10 s).

### 5.6 AgentRunner (`modules/runner`)
`interface AgentRunner { run(task: AgentTask, signal: AbortSignal): AsyncIterable<RunEvent> }`; `JobAgentRunner`:
1. `provider_state` = cooldown chưa hết / `logged_out` / `error` → `ALL_PROVIDERS_EXHAUSTED` (`provider_unavailable`) ngay, không tạo job.
2. Transaction `system`: `INSERT hub.jobs` + `SELECT pg_notify('job_enqueued', $1)`.
3. Theo dõi `run:<run_id>` qua `RunStreamReader` (multiplex), lọc `job_id`.
4. Im 2 s → đọc `jobs.status/error_*/result` theo id; đã kết thúc mà chưa có sự kiện → dựng từ DB.
5. Còn `queued` sau `HUB_JOB_MAX_WAIT_S` (30) từ `created_at`: `UPDATE hub.jobs SET status = 'failed', error_code = 'ALL_PROVIDERS_EXHAUSTED', error_reason = $2, finished_at = now() WHERE id = $1 AND status = 'queued'` (0 dòng = vừa được claim; **chỉ Hub** chạy — Runtime không hết hạn job `queued`, R11); `$2 = queueTimeoutReason(…)`.

### 5.7 Huỷ (E15, E9)
Transaction `system`, §3.5: `flows FOR UPDATE` → `UPDATE runs SET status='cancelled', error_code='CANCELLED', finished_at=now() WHERE id=$1 AND status='running'` (0 dòng → 200 + `Run` hiện tại, không phát gì) → `UPDATE hub.jobs SET status='cancelled', cancel_requested_at=now(), finished_at=now() WHERE run_id=$1 AND status='queued'` → `UPDATE hub.jobs SET cancel_requested_at=now() WHERE run_id=$1 AND status='running' AND cancel_requested_at IS NULL RETURNING id` → `pg_notify('job_cancel')` mỗi id → tin assistant → COMMIT → `run.failed CANCELLED` (chủ qua `AbortSignal`; instance khác XADD `seq` kế, fencing §5.2).

### 5.8 Sweeper lease (mọi instance, 10 s)
Ứng viên **không khoá**: `SELECT id, flow_id FROM hub.runs WHERE status='running' AND lease_until < now() LIMIT 20` → mỗi run một transaction: `flows FOR UPDATE` → `UPDATE runs SET status='failed', error_code='INTERNAL_ERROR', owner=$me, finished_at=now() WHERE id=$1 AND status='running' AND lease_until < now()` → huỷ job như §5.7 → tin assistant → COMMIT → XADD `run.failed` (`seq` = cuối stream + 1).

## 6. Orchestrator (`modules/orchestrator`)
### 6.1 Vòng
```
steps=0 tokens=0 delegates=0 hadPartial=false answered=null
loop:
  budgetExceeded → budgetOutcome(answered)                                   // H1-R07
  d = callOrchestrator()      // 1 step; JSON hỏng → gọi lại 1 lần (cùng step, có nhắc); vẫn hỏng → UPSTREAM_ERROR
  answer → emit chunkText(text) → finish ;  ask → emit ask → finish(ask)
  delegate ∉ visibleAgents (tính lại mỗi lần) → step 'skipped' (detail.reason='not_allowed'), steps++ → continue
  r = runAgent(d)             // 1 step; delegates++; tokens += usage; job lỗi → run.failed (mã của job)
  done ∧ canPassThrough → emit chunkText(r.text); flows.agent_id = agent → finish
  need_input → emit ask; flows.agent_id = agent, pending_ask = true → finish
  partial (hadPartial=true) / done khác → đưa vào <steps>; answered = r.text → continue
```
Kết thúc khác `need_input` → `pending_ask=false`. Nhãn step (`users.locale`): "Đang phân tích yêu cầu…" / "Đang xử lý…" (en: "Analyzing your request…" / "Working on it…").

### 6.2 `prompt` của job Orchestrator
Các khối theo thứ tự, nội dung JSON: `<agents>` (`visibleAgents`: key, description) · `<flow_hint>` (`last_agent`, `waiting_for`: key|null) · `<history>` (`history_n` của flow trừ tin hiện tại, mỗi tin ≤ 4000 ký tự) · `<steps>` (kết quả trong run: agent, status, text/missing/question/reason) · `<steps_left>` · `<message>`.
### 6.3 Khối định dạng (nối cuối `system_prompt`)
"Chỉ trả về MỘT object JSON theo JSON Schema sau, không chữ khác, không code fence: `<z.toJSONSchema(OrchestratorDecision)>`. `delegate` chỉ key trong <agents>; không agent phù hợp → `answer`; mơ hồ → `ask`; `waiting_for` khác null và tin là câu trả lời → `delegate` agent đó." Nhắc khi thử lại: "Lần trước không phải JSON hợp lệ theo schema. Chỉ trả JSON."

### 6.4 Hàm thuần (chữ ký chốt, qc viết test trước)
| File | Chữ ký |
|---|---|
| `orchestrator.rules.ts` | `parseDecision(raw: string): {ok: true; decision: OrchestratorDecision} \| {ok: false; reason: "not_json" \| "schema"}` (trim, bỏ fence, `{` đầu → `}` cuối) · `budgetExceeded(s: {steps; maxSteps; tokens; tokenBudget: number}): boolean` (`steps ≥ maxSteps ∨ tokens ≥ tokenBudget`) · `budgetOutcome(answered: string \| null, locale: "vi" \| "en"): {kind: "fail"; code: "BUDGET_EXCEEDED"} \| {kind: "finish"; text: string}` · `canPassThrough(s: {delegates: number; hadPartial: boolean}, r: AgentResult): boolean` (`done ∧ delegates === 1 ∧ !hadPartial`) · `chunkText(text: string, max = 40): string[]` (theo từ, 1–40 ký tự, nối lại = text) |
| `agents/agent-access.rules.ts` | `visibleAgents(i: {agents; entitlements; grants; tenantId; userId; groupIds: ReadonlySet<string>; orchestratorId: string}): AgentRef[]` = `enabled ∧ entitlement(tenant, revoked_at null) ∧ (grant user ∨ grant group ∈ groupIds) ∧ id ≠ orchestratorId`, sắp `key` |
| `runs/runs.rules.ts` | `eventsExpired(r: {status; finishedAt: Date \| null}, now: Date, retentionS: number): boolean` · `leaseExpired(leaseUntil: Date \| null, now: Date): boolean` · `queueTimeoutReason(c: {tenantRunning: number; tenantLimit: number \| null}): "tenant_slots" \| "provider_busy"` |
| `lib/jwt.ts` | `verifyAccessToken(key: CryptoKey, token: string): Promise<AccessClaims \| null>` (như Admin + `role ∈ ROLES`) |

## 7. Hiệu năng · env
Claim ≤ 20 ms p95 (10 000 queued) · E5/E10/E11 < 300 ms p95 (5 000 bản ghi/user) · 2 kết nối chặn Redis/instance.
Env hub-api: `HUB_PORT=4000`, `HUB_DATABASE_URL` (`hub_api`), `REDIS_URL`, `JWT_PUBLIC_KEY`, `HUB_INSTANCE_ID` (mặc định `hostname:pid`), `HUB_JOB_MAX_WAIT_S=30`, `HUB_CORS_ORIGINS`, `APP_ENV`, `LOG_LEVEL`. Seed: `DATABASE_URL` (owner), `HUB_SEED_PROFILE`. Runtime: `AGENT_RT_DATABASE_URL` (`agent_runtime`), `AGENT_RT_WORKER_ID`.

## 8. Ràng buộc gửi plan-runtime
| # | Ràng buộc |
|---|---|
| R1 | SQL `plan-db.md` §5.4–5.5 nguyên văn; role `agent_runtime`; không đọc `admin.*` (dùng `hub.tenant_sub_limit`) |
| R2 | Mỗi job đúng một sự kiện kết thúc, XADD **sau** commit; commit 0 dòng → không XADD |
| R3 | `output="agent_result"`: trích + retry theo `plan-runtime §4` (hỏng → `UPSTREAM_ERROR`, `invalid_output`); `output="text"`: nguyên văn |
| R4 | `fake-cli` + `output="text"` in JSON `OrchestratorDecision` theo `#fake:delegate=<key>`, `#fake:answer`, `#fake:ask`, `#fake:badjson=<n>` (n lần đầu hỏng — HUB-H1-AC-10) |
| R5 | `use_session=false` → không đụng `cli_sessions`; resume lỗi → dựng từ `history`, `session_resumed=false` |
| R6 | `datamodel-code-generator` = dev dep (ADR-0009, không lặp ở ADR-0008); `hub.py` qua `pyright` strict bằng cờ codegen, không `type: ignore` |
| R7 | `usage_logs` cho cả job Orchestrator (`agent_id` = agent orchestrator) |
| R8 | `job.progress.message` không đường dẫn/nội dung file/prompt |

**Trả lời `plan-runtime.md` §12** (Runtime theo cột "Chốt"; R3, R4, R9 không có trong §12):
| # | Chốt | Chỗ |
|---|---|---|
| R1 | ✓ nhận | §2.2–2.6 |
| R2 | ✓ nhận, tên theo contract: `history[{role, content}]` (không `text`), `model` (nullable), **thêm** `max_turns` int 1–100 | §2.2 |
| R5 | ✓ nhận: retry 1 lần trong job rồi `job.failed{UPSTREAM_ERROR, reason:"invalid_output"}` | §8 R3 |
| R6 | ✓ nhận: `job_id`, `cache_read_tokens`, `cache_write_tokens` nullable; `input_tokens` = tổng gồm cache | `plan-db` §3.3, §5.4 Kết thúc |
| R7 | ✓ nhận, tên theo plan: `error_reason` (không `reason`); không có status `orphaned` (= `failed` + `error_reason='orphaned'`); `timed_out` là status | §2.5, `plan-db` §3.3 |
| R8 | ✓ nhận (heartbeat gộp theo `worker_id`; thêm SQL Provider OK/lỗi/hỏng, reset provider khi khởi động, `available`). Hết hạn `queued`: xem R11 | `plan-db` §5.4–5.5 |
| R10 | Một phần: `provider_state` giữ tên cột `status` (không `state`), có `consecutive_errors`; ✓ `agent_types.available`; **từ chối** unique 4 cột cho `cli_sessions` — `conversation_id` là uuid toàn cục, PK 3 cột + điều kiện `tenant_id` ở mọi SELECT/UPSERT đủ cho BR-06 | `plan-db` §3.3 |
| R11 | **Từ chối** `max_wait_s` ở payload/`providers`: chỉ Hub hết hạn job `queued` theo env `HUB_JOB_MAX_WAIT_S` (P8, §5.6 bước 5). Runtime không có env/logic `max_wait_s`; provider hỏng → Runtime fail ngay job `queued` của provider đó (Provider hỏng) | §1 P8, §5.6 |
| R12 | ✓ đã có, chặt hơn: AgentRunner đọc `jobs.status` mỗi 2 s khi im; Hub cũng quét orphan 10 s (heartbeat > 60 s) | §1 P7, §5.6 bước 4, `plan-db` §5.5 |
| R13 | ✓ nhận: một role `agent_runtime` (bỏ tên `agent_rt`), có SELECT `providers`; bảng Runtime không RLS | §3.4 |
