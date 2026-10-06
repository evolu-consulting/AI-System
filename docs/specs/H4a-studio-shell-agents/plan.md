# Plan · H4a-studio-shell-agents — phần Backend (Hub TS)

Luật: spec §2 (H4a-R01…R14). Mặc định Q1–Q10 (spec §9) giữ nguyên; câu hỏi mới QB1–QB7 ở §11 (có mặc định, plan đã viết theo mặc định). Phần FE: `plan-frontend.md` (frontend-lead). Code đã đọc 2026-10-06: `lib/{hub-audit,hub-config-write,admin-role.middleware,auth.middleware,errors,http}.ts`, `app.ts`, `app.h3b.ts`, `modules/{agent-grants,config,seed,runner/runner.rules,agents/agent-access.rules}`, `packages/db/{schema/hub*.ts,migrations-hub/0000,0006,0009}`, `packages/contracts/src/{hub-admin,hub/common,common,version-conflict}.ts`. **Không ADR** (không thư viện mới: `hono/bun` `serveStatic` có sẵn trong hono 4.13; không thêm ajv — QB7).

## 1. Quyết định
| # | Quyết định | Lý do / nguồn |
|---|---|---|
| P1 | Contract mới ở subpath **`@ai/contracts/studio`** (`packages/contracts/src/studio/{index,errors,common,agents,orchestrator,catalog}.ts` + `studio.test.ts`; `package.json` `exports["./studio"]`). `chat`, `hub`, `hub-admin` **không đổi** | Q4; mẫu H3b P2 |
| P2 | Module `apps/hub-api/src/modules/studio/` chia thư mục con (≤ 10 file/thư mục): `studio/` (README, `studio.routes.ts` me + đọc, `studio-read.service.ts`, `studio-read.repo.ts`, `studio-static.ts`, `studio-write.ts`), `studio/agents/` (routes/service/repo/rules/map), `studio/orchestrator/` (routes/service/repo/rules) | CONVENTIONS §2, §4 |
| P3 | Mount ở **`app.h4a.ts`** (`mountH4a(app, deps)`, mẫu `app.h3b.ts`); `app.ts` (246 dòng) chỉ thêm `"/studio/api"` vào `PROTECTED_PREFIXES` + 1 dòng gọi | giữ `app.ts` ≤ 250 |
| P4 | Role: `requirePlatformAdmin()` mới cạnh `requireAdminRole()` trong `lib/admin-role.middleware.ts`; gắn `app.use("/studio/api/*")` **sau** `requireAuth` ⇒ thứ tự 401 → 403 → 400/404 | R01; mẫu PL8 H3b |
| P5 | Mọi ghi Studio qua **một** helper `studio-write.ts` `withConfigWrite(db, actor, fn)`: `withHubScope(system)` → `lockHubConfig` → `fn` (đọc FOR UPDATE, kiểm `version`, ghi) → `bumpHubConfig` → `hubAudit.insert` → `notifyHubConfig`. Không đổi gì (body trùng giá trị cũ) vẫn bump (đơn giản, UI luôn gửi khi có đổi) | R09, FR-69; tái dùng H3b |
| P6 | Scope **`system`** cho mọi transaction Studio: bảng cấu hình không RLS, nhưng kiểm `AGENT_HAS_HISTORY` đọc `runs`/`run_steps` (RLS) — scope `user` sẽ thấy 0 hàng ⇒ xoá nhầm agent có lịch sử | R06; 0001_hub_rls |
| P7 | `AppDeps.hubAudit?` (H3b P12) dùng lại cho Studio ⇒ qc tiêm lỗi audit giữa transaction (AC-03, R09 "audit lỗi ⇒ rollback") | P12 H3b |
| P8 | Ràng buộc trường theo **CHECK DB hiện có** (key, description 20–400, timeout 10–3600, history_n 1–50), không theo con số lệch trong R03/R07 | QB2 |
| P9 | Orchestrator chỉ nhận agent runtime ∈ `ORCHESTRATOR_RUNTIMES` = `["agentic-cli"] as const` — **định nghĩa ở `@ai/contracts/studio` `common.ts`** (K2); hub-api `config.rules.ts` import lại cho `orchestratorProblem`/`pickOrchestrator`, FE lọc select Orchestrator theo cùng hằng (một nguồn). Mở `llm` sau = sửa hằng | QB1 (người dùng chốt 2026-10-06) |
| P10 | `key`, `runtime` bất biến sau tạo (body PUT strict, không có hai trường) | QB5 |
| P11 | `dify-*`: ghi **cả** `runtime_options.workflow_key` (Runtime H2a đọc) **và** 1 dòng `agent_workflows` (Admin đọc để chặn xoá workflow); đọc ra `workflow_ids` từ `agent_workflows`, thiếu thì suy từ `workflow_key` (agent seed cũ) | QB3, R04 |
| P12 | Serve tĩnh: `studio-static.ts` (`serveStatic` từ `hono/bun`) chỉ khi `HUB_STUDIO_DIST` có `index.html`; mount **sau** route API ⇒ `/studio/api/*` không bao giờ rơi vào SPA fallback | FR-72, Q5, AC-11 |

## 2. Contract `@ai/contracts/studio`
Tái dùng: `UuidSchema`, `IsoDateTime`, `versionConflictDetailsSchema` (gốc); `AgentKeySchema` (= `^[a-z][a-z0-9-]{1,47}$`), `ALLOWED_TOOLS` (`hub`); `ErrorResponseSchema`.

### 2.1 Lỗi (`studio/errors.ts`)
```ts
export const STUDIO_ERRORS = { FORBIDDEN: 403, INVALID_REFERENCE: 400, VERSION_CONFLICT: 409, KEY_TAKEN: 409,
  BASH_ACK_REQUIRED: 422, AGENT_IN_USE_AS_ORCHESTRATOR: 409, AGENT_HAS_HISTORY: 409, AGENT_HAS_ACCESS: 409,
  AGENT_NOT_ORCHESTRATABLE: 409, ORCHESTRATOR_EXISTS: 409, ORCHESTRATOR_DEFAULT_PROTECTED: 409, TENANT_INACTIVE: 409,
} as const satisfies Record<string, 400 | 403 | 409 | 422>;
```
`FORBIDDEN`/`INVALID_REFERENCE` trùng tên + status với `HUB_ADMIN_ERRORS` (gộp vào `HUB_ERRORS` không xung đột). Dùng kèm: `VALIDATION_ERROR` 400 (`details.issues`), `AUTH_EXPIRED` 401, `NOT_FOUND` 404, `INTERNAL_ERROR` 500. Message EN cố định trong `lib/errors.ts` `ERROR_MESSAGES`.

| Mã | `details` (strict) |
|---|---|
| `INVALID_REFERENCE` | `{field: "profile_id"\|"workflow_ids"\|"agent_type_key"\|"agent_id"\|"tenant_id", ids?: uuid[] ≤ 20, reason?: "not_found"\|"disabled"\|"app_type"\|"no_input"\|"runtime_mismatch"\|"unavailable"}` |
| `VERSION_CONFLICT` | agent: `versionConflictDetailsSchema(AgentSchema)`; orchestrator: `versionConflictDetailsSchema(OrchestratorSchema)` (`{current, updated_at}` — modal xung đột mẫu Admin CR-008/016) |
| `AGENT_IN_USE_AS_ORCHESTRATOR` | `{scopes: ({tenant_id: null} \| {tenant_id: uuid, tenant_key: string})[] ≥ 1}` |
| `AGENT_HAS_ACCESS` | `{entitlements: int ≥ 0, grants: int ≥ 0}` (tổng > 0) |
| `AGENT_NOT_ORCHESTRATABLE` | `{reason: "disabled"\|"runtime_unsupported"}` |
| `KEY_TAKEN` | `{field: "key"}` (E8; tên mã theo Admin `KEY_TAKEN`, không `AGENT_KEY_EXISTS`) |
| khác | không `details` |

### 2.2 Chung (`studio/common.ts`)
| Schema | Trường |
|---|---|
| `LocalizedNameSchema` | `{vi: string trim 1–100, en: string trim 1–100}` strict |
| `AgentRuntimeSchema` | enum `llm \| agentic-cli \| dify-workflow \| dify-agent \| python` |
| `ORCHESTRATOR_RUNTIMES` | `["agentic-cli"] as const` (K2/QB1) |
| `STUDIO_CLI_TOOLS` | `["Read","Grep","Glob","Write","Edit","Bash"]` (⊇ `ALLOWED_TOOLS`; Runtime chỉ chạy phần giao — QB7) |
| `MeSchema` | `{user_id: uuid, tenant_id: uuid, tenant_key, username, display_name, role: "platform_admin", hub_config_version: int ≥ 0}` (E9) |
| Hằng (E11) | `AGENT_RUNTIMES`, `CLI_KINDS`, `STUDIO_CLI_TOOLS`, `CWD_MODES = ["job"]`, `ON_NO_MATCH_VALUES` |
| Hàm thuần dùng chung FE + Hub (`studio/overlap.ts`) | `descriptionTokens`, `descriptionOverlap`, `similarAgents` (§4.1 — **một** cài đặt, FE dùng cho badge danh sách) · `formatAgentForOrchestrator({key, description}) = JSON.stringify({key, description})` = đúng phần tử `<agents>` của `orchestrator.prompt.ts:56` (Hub dùng lại hàm này — E7) |
| `ListMeta` | mọi list: `{items, total: int ≥ 0, truncated: bool, hub_config_version: int}` |

### 2.3 Agent (`studio/agents.ts`)
`runtime_options` theo runtime (strict, ≤ 16 KiB JSON):

| Runtime | `runtime_options` | `profile_id` | `agent_type_key` | `workflow_ids` |
|---|---|---|---|---|
| `agentic-cli` | `{cli: "claude"\|"codex"\|"gemini" (mặc định claude), allowed_tools: STUDIO_CLI_TOOLS[] unique ≤ 6 (mặc định ["Read","Grep"]), mcp: bool (mặc định false), cwd_mode: "job" (mặc định), max_turns?: int 2–100}` | uuid **bắt buộc** | null | uuid[] unique 0–20 |
| `llm` | `{}` | uuid **bắt buộc** | null | uuid[] unique 0–20 |
| `dify-workflow` / `dify-agent` | không gửi (server tự đặt `{workflow_key}`) | **vắng/null** | null | đúng **1** |
| `python` | `record<string, unknown>` | uuid? (tuỳ chọn) | `AgentKeySchema` **bắt buộc** | 0–20 |

| Schema | Trường |
|---|---|
| `AgentCreateSchema` | discriminatedUnion `runtime` (bảng trên) + chung: `key: AgentKeySchema`, `name: LocalizedName`, `description: string trim 20–400`, `system_prompt: string ≤ 20000` (mặc định ""), `timeout_s: int 10–3600` (mặc định 600), `token_budget: int 1–10 000 000 \| null` (mặc định null), `enabled: bool` (mặc định true), `bash_ack?: bool` |
| `AgentUpdateSchema` | như Create **bỏ** `key`, `runtime` (P10; gửi ⇒ 400) + `version: int ≥ 1`. Runtime để chọn nhánh union lấy từ hàng DB: route parse thô `{runtime}` từ DB rồi `agentUpdateSchemaFor(runtime)` |
| `AgentEnabledSchema` (PATCH) | `{enabled: bool, version: int ≥ 1}` |
| `AgentDeleteQuerySchema` | `{version: coerce int ≥ 1}` |
| `AgentListQuerySchema` | `q?: string trim 1–100` (ILIKE key/name.vi/name.en), `runtime?`, `enabled?: "true"\|"false"`, `limit: 1–200 = 200` (K3/G1), `offset: 0–10 000 = 0` |
| `AgentSchema` (chi tiết) | `id, key, name, description, runtime, agent_type_key: string\|null, profile_id: uuid\|null, system_prompt, runtime_options: record, workflow_ids: uuid[], timeout_s, token_budget: int\|null, enabled, version, created_at, updated_at, runnable: bool` (= `RUNNABLE_RUNTIMES`), `orchestrator_of: {default: bool, tenant_ids: uuid[]}`, `workflows: {id, key, name, app_type, description, enabled}[]` (ghép catalog lúc đọc, không lưu — E2; id đã mất khỏi catalog chỉ còn trong `workflow_ids`), `warnings: AgentWarning[]` |
| `AgentWarningSchema` | union: `{code:"description_overlap", agent_id: uuid, agent_key, score: number 0–1}` · `{code:"runtime_not_ready"}` (codex/gemini, `llm`, `python`) · `{code:"tools_not_supported", tools: string[]}` (Edit/Bash — Runtime chưa chạy) |
| `AgentListItemSchema` | `id, key, name, description, runtime, enabled, version, updated_at, profile: {id, key}\|null, workflow_count: int, entitled_tenant_count: int` (`revoked_at IS NULL`; 0 ⇒ "Chưa cấp"), `orchestrator_of: {default, tenant_ids}`, `runnable: bool` — **không** cột 24 giờ (R11). `ListMeta.truncated = (offset + items.length < total)`: `false` khi vừa đủ (A05: ≤ 200 agent ⇒ `false`); FE khi `true` hiện Alert + chuyển tìm sang `?q=` (plan-frontend) |
| `AgentWriteResponseSchema` | `{agent: Agent, hub_config_version: int}` (POST 201, PUT/PATCH 200); DELETE **204** |

### 2.4 Orchestrator (`studio/orchestrator.ts`)
| Schema | Trường |
|---|---|
| `OrchestratorInputSchema` | `agent_id: uuid`, `max_steps: int 1–20`, `token_budget: int 1000–10 000 000`, `history_n: int 1–50`, `on_no_match: "answer"\|"ask"` (strict) |
| `OrchestratorPutSchema` | Input + `version: int ≥ 1` |
| `OrchestratorTenantCreateSchema` | Input + `tenant_id: uuid` |
| `OrchestratorDeleteQuerySchema` | `{version: coerce int ≥ 1}` |
| `OrchestratorSchema` | `id: int, tenant: {id, key, name}\|null` (null = mặc định), `agent: {id, key, name, runtime, enabled}`, `max_steps, token_budget, history_n, on_no_match, version, updated_by: uuid\|null, updated_at, warnings: ("agentic_cli_slow")[]` (R08) |
| `OrchestratorListSchema` (GET) | `{default: Orchestrator, tenants: Orchestrator[] (≤ 200, sort tenant.key), hub_config_version}` |
| `OrchestratorWriteResponseSchema` | `{orchestrator, hub_config_version}`; DELETE 204 |

### 2.5 Đọc catalog (`studio/catalog.ts`) — tất cả `ListMeta`, query `q?` (1–100), `limit 1–200 = 200`
| Endpoint | Item |
|---|---|
| `agent-types` | `key, runtime ("agentic-cli"\|"llm"\|"python"), description: LocalizedName, config_schema: record, version, available` |
| `model-profiles` | `id, key, steps: {provider_key, model, on: string[]}[]` |
| `providers` | `id, key, kind, vendor, base_url\|null, has_secret: bool, max_concurrency, enabled, dev_only, state: {status, cooldown_until\|null, utilization: number\|null}\|null` — **không** `secret_id`, ciphertext, `last_error` (R13) |
| `workflows` | chỉ `enabled = true`: `id, key, name, description, app_type, usable_for: ("tool"\|"dify-workflow"\|"dify-agent")[]` (dify-* cần `difyAgentInput(input_schema) ≠ null`); query thêm `app_type?` |
| `tenants` | `id, key, name, active, has_orchestrator: bool` |

## 3. Endpoint × lỗi (mọi route: 401 `AUTH_EXPIRED` → 403 `FORBIDDEN` trước parse)
| Method · path | OK | Lỗi riêng |
|---|---|---|
| `GET /studio/api/me` | 200 `Me` | — |
| `GET /studio/api/agents` | 200 list | 400 query |
| `POST /studio/api/agents` | 201 | 400 `VALIDATION_ERROR`/`INVALID_REFERENCE`, 409 `KEY_TAKEN`, 422 `BASH_ACK_REQUIRED` |
| `GET /studio/api/agents/:id` | 200 `Agent` | 404 (id không uuid ⇒ 404 như `parseIdParam`) |
| `PUT /studio/api/agents/:id` | 200 | 400, 404, 409 `VERSION_CONFLICT`/`AGENT_IN_USE_AS_ORCHESTRATOR` (tắt qua PUT), 422 |
| `PATCH /studio/api/agents/:id/enabled` | 200 | 404, 409 `VERSION_CONFLICT`/`AGENT_IN_USE_AS_ORCHESTRATOR` |
| `DELETE /studio/api/agents/:id?version=` | 204 | 404, 409 `VERSION_CONFLICT` → `AGENT_IN_USE_AS_ORCHESTRATOR` → `AGENT_HAS_HISTORY` → `AGENT_HAS_ACCESS` (thứ tự kiểm) |
| `GET /studio/api/orchestrator` | 200 | — (thiếu hàng mặc định ⇒ 500, như `orchestratorProblem`) |
| `PUT /studio/api/orchestrator/default` | 200 | 400 `INVALID_REFERENCE{agent_id}`, 409 `VERSION_CONFLICT`/`AGENT_NOT_ORCHESTRATABLE` |
| `DELETE /studio/api/orchestrator/default` | — | 409 `ORCHESTRATOR_DEFAULT_PROTECTED` (luôn) |
| `POST /studio/api/orchestrator/tenants` | 201 | 400 `INVALID_REFERENCE{tenant_id\|agent_id}`, 409 `TENANT_INACTIVE`/`ORCHESTRATOR_EXISTS`/`AGENT_NOT_ORCHESTRATABLE` |
| `PUT /studio/api/orchestrator/tenants/:tenant_id` | 200 | 404 (chưa có bản), 409 như PUT default + `TENANT_INACTIVE` |
| `DELETE /studio/api/orchestrator/tenants/:tenant_id?version=` | 204 | 404, 409 `VERSION_CONFLICT` |
| `GET /studio/api/{agent-types,model-profiles,providers,workflows,tenants}` | 200 | 400 query |
| `GET /studio`, `/studio/*` (không `/studio/api`) | 200 file / `index.html` | 404 JSON khi `HUB_STUDIO_DIST` vắng hoặc file có đuôi không tồn tại |

Không có endpoint login (R14): Studio gọi `admin-api POST /auth/login`.

## 4. Luật thuần (QC viết test trước — `tests/acceptance/H4a/rules/`)
### 4.1 `modules/studio/agents/agents.rules.ts`
| Hàm | Hợp đồng |
|---|---|
| `workflowProblem(runtime: AgentRuntime, wfs: readonly WorkflowRef[], requestedIds: readonly string[]): WorkflowProblem \| null` · `WorkflowProblem = {reason: "not_found"; ids: string[]} \| {reason: "disabled" \| "app_type" \| "no_input"; ids?: string[]}` (G5: `ids` bắt buộc chỉ với `not_found` = id thiếu) | `WorkflowRef = {id, key, enabled, appType, hasDifyInput}`. Thứ tự: id không có trong `wfs` ⇒ `{reason:"not_found", ids}` → `enabled=false` ⇒ `disabled` → dify-workflow & appType ≠ workflow, dify-agent & appType ∉ {chat, agent} ⇒ `app_type` → dify-* & !hasDifyInput ⇒ `no_input` → null. Số lượng đã chặn ở zod |
| `needsBashAck(before: readonly string[] \| null, after: readonly string[]): boolean` | `after` có `Bash` ∧ (`before` null ∨ không có `Bash`) — chỉ khi **thêm mới** Bash (R05) |
| `deleteBlocker(x: {orchestratorScopes: number; hasHistory: boolean; activeEntitlements: number; grants: number}): "AGENT_IN_USE_AS_ORCHESTRATOR" \| "AGENT_HAS_HISTORY" \| "AGENT_HAS_ACCESS" \| null` | đúng thứ tự đó (R06) |
| `disableBlocked(orchestratorScopes: number, nextEnabled: boolean): boolean` | `!nextEnabled ∧ orchestratorScopes > 0` |
| `difyOptions(runtime, wf: {key}): {workflow_key: string} \| null` | dify-* ⇒ `{workflow_key: wf.key}`; khác ⇒ null |
| `descriptionTokens(s: string): Set<string>` · `descriptionOverlap(a, b): number` · `similarAgents(target: {id, description}, others: readonly {id, key, description, enabled}[], threshold = 0.6): {agent_id: string; agent_key: string; score: number}[]` (G4) — định nghĩa ở `@ai/contracts/studio` `overlap.ts`, rules re-export | token = `s.normalize("NFC").toLowerCase().split(/[^\p{L}\p{N}]+/u)` lọc độ dài ≥ 3; Jaccard \|A∩B\|/\|A∪B\| (hai tập rỗng ⇒ 0); bỏ chính nó + agent tắt; sắp score giảm, tối đa 5 (R08) |
| `agentWarnings(a: {runtime: AgentRuntime; runtime_options: Record<string, unknown>}): AgentWarning[]` (G3; không gồm `description_overlap` — do `similarAgents`) | `runtime_not_ready` khi runtime ∈ {`llm`, `python`} (∉ `RUNNABLE_RUNTIMES`) ∨ (`agentic-cli` ∧ `runtime_options.cli` ∈ {codex, gemini}); G7: `dify-workflow`/`dify-agent` **không** có `runtime_not_ready`; `agentic-cli` mặc định/claude ⇒ `[]`; `tools_not_supported` = allowed_tools \ `ALLOWED_TOOLS` (khác rỗng) |

### 4.2 `modules/studio/orchestrator/orchestrator-settings.rules.ts`
| Hàm | Hợp đồng |
|---|---|
| `orchestratorAgentProblem(a: {enabled, runtime} \| undefined): "not_found" \| "disabled" \| "runtime_unsupported" \| null` | vắng ⇒ not_found (→ 400 `INVALID_REFERENCE{agent_id}`); !enabled ⇒ disabled; runtime ∉ `ORCHESTRATOR_RUNTIMES` ⇒ runtime_unsupported (→ 409) |
| `orchestratorWarnings(runtime): ("agentic_cli_slow")[]` | `agentic-cli` ⇒ `["agentic_cli_slow"]` |
| `tenantOrchestratorProblem(t: {active} \| undefined, exists: boolean): "not_found" \| "inactive" \| "exists" \| null` | thứ tự đó (R07) |

### 4.3 Chung
`isStudioRole(role: Role): boolean` (`lib/admin-role.middleware.ts`) = `role === "platform_admin"` (R01).

## 5. Luồng
### 5.1 `studio-write.ts`
`withConfigWrite<T>(deps: {db, audit}, actor: Actor, fn: (tx, v0) => Promise<{result: T; audit: Omit<HubAuditRow, "hubConfigVersion"|actor*> } | {result: T; audit: null}>)` : `withHubScope(db, {kind:"system"})` → `v0 = lockHubConfig(tx)` → `fn` → (audit ≠ null) `v1 = bumpHubConfig` → `ACTOR_NAME` (config cache `user(actor.userId)?.username`) → `audit.insert({...row, hubConfigVersion: v1})` → `notifyHubConfig(tx, v1)`. Ném bất kỳ ⇒ rollback cả gói (R09). Retry 40P01/40001 an toàn (NOTIFY chỉ giao khi commit — Q-K7 H3b).

Audit (`hub.audit_log`, migration §6): `tenant_id` = **null** cho agent + Orchestrator mặc định, = `tenant_id` đích cho Orchestrator tenant; `entity` `agent`\|`orchestrator`; `action` `create`\|`update`\|`delete`\|`enable`\|`disable`; `entity_name` = `agent.key` / `orchestrator:default` / `orchestrator:<tenant_key>`; `before`/`after` = bản `Agent` (bỏ `warnings`, `runnable`, `orchestrator_of`) / `Orchestrator` (bỏ `warnings`); `summary` = `{fields: string[]}` (khoá đổi) + `{bash_ack: true}` khi R05 kích hoạt.

### 5.2 Agent
| Thao tác | Bước trong `fn` (sau `lockHubConfig`) |
|---|---|
| POST | `FIND_KEY` → có ⇒ `KEY_TAKEN` · `PROFILE` (llm/agentic-cli/python có id) vắng ⇒ `INVALID_REFERENCE{profile_id}` · python: `AGENT_TYPE` vắng/`available=false`/runtime lệch ⇒ `INVALID_REFERENCE{agent_type_key}` · `WF_BY_IDS` (admin.workflows) → `workflowProblem` · `needsBashAck(null, tools) ∧ !bash_ack` ⇒ 422 · `INSERT agents … RETURNING` (dify-*: `profile_id NULL`, `runtime_options = difyOptions`) → `INSERT agent_workflows (agent_id, workflow_id, created_by)` → audit `create` (before null) |
| PUT | `AGENT_FOR_UPDATE` (vắng ⇒ 404) → `version` lệch ⇒ `VERSION_CONFLICT{current}` → `ORCH_SCOPES` ∧ `disableBlocked` ⇒ 409 → kiểm tham chiếu như POST → `needsBashAck(before.tools, after.tools)` → `UPDATE agents SET …, version = version + 1, updated_at = now()` → đồng bộ `agent_workflows` (DELETE id ∉ mới, INSERT … ON CONFLICT DO NOTHING) → audit `update` |
| PATCH enabled | `AGENT_FOR_UPDATE` → version → (tắt) `ORCH_SCOPES` → `UPDATE enabled, version+1` → audit `enable`/`disable` |
| DELETE | `AGENT_FOR_UPDATE` → version → `ORCH_SCOPES`, `HAS_HISTORY` (`EXISTS runs WHERE agent_id` ∨ `EXISTS run_steps WHERE agent_id`), `ACCESS_COUNTS` → `deleteBlocker` → `DELETE agents` (cascade `agent_workflows`, entitlement đã thu hồi; `flows.agent_id` SET NULL) → audit `delete` (after null) |
| GET list | REPEATABLE READ read only: `LIST_AGENTS` (lọc + `limit/offset` + `count(*) over()`), `WF_COUNTS`, `ENT_COUNTS`, `ORCH_AGENT_IDS`, `PROFILE_KEYS` cho trang hiện tại (`agent_id = ANY($ids)`) |
| GET :id | `AGENT` + `AGENT_WF_IDS` + `ORCH_SCOPES` + `ENABLED_DESCRIPTIONS` (cho `similarAgents`) |

### 5.3 Orchestrator
| Thao tác | Bước |
|---|---|
| PUT default | `ORCH_FOR_UPDATE(id=1)` → version → `AGENT(agent_id)` → `orchestratorAgentProblem` → `UPDATE … version+1, updated_by = actor, updated_at = now()` → audit `update` (tenant null) |
| POST tenant | `TENANT(id)` (admin.tenants, `hub_ro`) → `ORCH_BY_TENANT` → `tenantOrchestratorProblem` → agent check → `INSERT` (id từ sequence; **không** `ON CONFLICT` — bẫy `nextval` REVIEW 1 seed) → audit `create` (tenant = đích) |
| PUT tenant | `ORCH_BY_TENANT FOR UPDATE` (vắng ⇒ 404) → version → `TENANT` inactive ⇒ `TENANT_INACTIVE` → agent check → `UPDATE` → audit |
| DELETE tenant | `ORCH_BY_TENANT FOR UPDATE` → version → `DELETE` → audit `delete` (tenant đã khoá vẫn xoá được) |
Run mới của tenant đổi bản trong ≤ 5 s qua NOTIFY → `ConfigCache` (R10, đường H2b/H3b đã đo); run đang chạy giữ snapshot (BR-06) — không code mới.

### 5.4 Đọc, `me`, tĩnh
- `me`: từ `c.var.user` + `config.snapshot().version` (không query).
- Catalog: một transaction read only mỗi request; providers ghép `provider_state` theo `key`.
- `studio-static.ts`: `GET /studio` ⇒ 308 `/studio/`; `/studio/*` khác `/studio/api/*`: file có trong dist ⇒ trả (`/studio/static/*`: `Cache-Control: public, max-age=31536000, immutable`); không thấy ∧ path không có đuôi ⇒ `index.html` (`Cache-Control: no-cache`); có đuôi ⇒ 404 JSON. Header mọi phản hồi tĩnh: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. Chặn path chứa `..`/`%2e%2e` ⇒ 404 (lưới thứ hai ngoài `serveStatic`).

## 6. DB — migration `packages/db/migrations-hub/0010_h4a_studio.sql` (+ `meta/_journal.json` idx 10)
| # | Thay đổi | Lý do | Dữ liệu cũ |
|---|---|---|---|
| D1 | `GRANT SELECT, INSERT, UPDATE, DELETE ON hub.agents, hub.agent_workflows TO hub_rw`; `GRANT INSERT, UPDATE, DELETE ON hub.orchestrator_settings TO hub_rw`; `GRANT USAGE ON SEQUENCE hub.orchestrator_settings_id_seq TO hub_rw` | Hub ghi từ API (trước chỉ `hub:seed` owner) | — |
| D2 | `ALTER TABLE hub.agents ALTER profile_id DROP NOT NULL` + `agents_profile_required_ck CHECK (runtime NOT IN ('llm','agentic-cli') OR profile_id IS NOT NULL)` | R03 (dify-* không profile) — QB4 | không đổi hàng nào |
| D3 | `hub.audit_log`: `tenant_id DROP NOT NULL`; thay CHECK `action IN ('grant','revoke','view_trace','create','update','delete','enable','disable')`, `entity IN ('agent_grant','run','agent','orchestrator')` (DROP + ADD trong `DO $$` idempotent) | FR-69, QB6 | hàng cũ thoả CHECK mới |
| D4 | `CREATE INDEX IF NOT EXISTS runs_agent_idx ON hub.runs (agent_id) WHERE agent_id IS NOT NULL`; `run_steps_agent_idx` tương tự | `HAS_HISTORY` (CONVENTIONS §6) | prod: `CONCURRENTLY` thủ công (PRODUCTION-NOTES, như K12 H3b) |

Drizzle: `schema/hub.ts` — `agents.profileId` nullable, `hubAuditLog.tenantId` nullable, `HUB_AUDIT_ACTION_VALUES`/`HUB_AUDIT_ENTITY_VALUES` thêm giá trị; `schema/hub-readonly.ts` sửa comment (Hub ghi `agent_workflows` từ H4a). Ripple kiểu: `config.rules.ts` `AgentConfig.profileId: string \| null`; `job-agent-runner.ts:174` profile vắng ⇒ đường lỗi `NOT_CONFIGURED` sẵn có; `lib/hub-audit.ts` `tenantId: string \| null`.
**RLS:** không bảng mới, không policy mới. Bảng cấu hình (`agents`, `orchestrator_settings`, `agent_workflows`, `audit_log`) không RLS — cách ly bằng **role** (`requirePlatformAdmin` mọi route) + audit `tenant_id` null không lộ qua đọc theo tenant (`WHERE tenant_id = $T`, H3b PL6). `admin.*` đọc bằng `hub_ro` (đã có default privileges). Seed: không đổi (`hub:seed` vẫn bump `version` khi đè — xem R-K3).

## 7. Thứ tự khoá & đồng thời
Nhánh cấu hình Hub (H3b §6) mở rộng: **`config_meta` (FOR UPDATE, đầu tiên)** → hàng `agents` \| `orchestrator_settings` (FOR UPDATE) → `agent_workflows` → `audit_log` (INSERT). Mọi ghi Studio + grant H3b + seed cùng khoá `config_meta` trước ⇒ tuần tự hoá, không chu trình; kiểm `version`, `KEY_TAKEN`, `ORCHESTRATOR_EXISTS` không race (unique index chỉ là lưới thứ hai: 23505 ⇒ map `KEY_TAKEN`/`ORCHESTRATOR_EXISTS`). Đọc `admin.workflows`/`admin.tenants` không khoá (Admin tắt workflow đồng thời: chấp nhận — lần lưu sau báo `disabled`). Int bắt buộc chạy lại khi BUILD: H1 `concurrency`, A37 `lock-order`, H1/H2a/H2b `seed.int`, H3b `agent-grants` int.

## 8. Hiệu năng (CONVENTIONS §6; spec §6 — đo, không chặn)
| Truy vấn | Index |
|---|---|
| `FIND_KEY`, sort list theo key | `agents_key_uq` |
| `WF_COUNTS`, `AGENT_WF_IDS` | PK `agent_workflows (agent_id, workflow_id)` |
| `ENT_COUNTS`, `ACCESS_COUNTS` | PK `agent_entitlements (agent_id, tenant_id)`; grants `agent_grants_uq (agent_id, …)` |
| `HAS_HISTORY` | **`runs_agent_idx`, `run_steps_agent_idx` (mới, D4)** |
| `ORCH_*` | PK + `orchestrator_settings_tenant_uq` |
| `WF_BY_IDS`, catalog | PK / `workflows_key_uq` admin |
API CRUD p95 < 300 ms với 5 000 agent; list ≤ 200; ghi ≤ 8 câu + audit. `similarAgents` O(n) trên agent bật (n ≤ 5 000, token hoá ≤ 400 ký tự) — < 20 ms.

## 9. Env, app, lệnh xong
- `config/env.ts`: `HUB_STUDIO_DIST` (tuỳ chọn, đường dẫn tuyệt đối; có mà thiếu `index.html` ⇒ log `warn studio-dist-missing`, không mount). `HUB_CORS_ORIGINS` không đổi code — `.env.example` thêm `http://localhost:3200`. `docs/guides/hub-dev.md` mục "Studio dev".
- `AppDeps.studioDist?: string` (test truyền thư mục fixture).
- `done:h4a` (`tools/scripts/src/done-h4a.ts`, mẫu `done-h3b.ts`) do qc (I1): bước H3b + `tests/acceptance/H4a/rules` + int `tests/acceptance/H4a/` + studio-web.

## 10. Rủi ro
| # | Rủi ro | Giảm thiểu |
|---|---|---|
| R-K1 | Lưu Orchestrator mặc định bằng agent runtime Runtime chưa chạy ⇒ Hub mất định tuyến mọi tenant | P9: `AGENT_NOT_ORCHESTRATABLE`; `ORCHESTRATOR_RUNTIMES` một nguồn với `orchestratorProblem` |
| R-K2 | Xoá agent khi kiểm lịch sử dưới scope sai (RLS che hàng) ⇒ mất tham chiếu run | P6 scope `system`; int: agent có run của tenant khác ⇒ 409 |
| R-K3 | `hub:seed` chạy lại đè sửa đổi từ Studio (không audit) | seed bump `version` ⇒ tab Studio cũ nhận 409; PRODUCTION-NOTES: không chạy `hub:seed` trên DB đã sửa bằng Studio (I3) |
| R-K4 | `GRANT` ghi `agents` cho `hub_rw` mở rộng bề mặt: endpoint chat lỡ ghi cấu hình | Chỉ module `studio` gọi INSERT/UPDATE/DELETE `agents` (depcruise: chỉ `modules/studio/**` import repo ghi); reviewer kiểm |
| R-K5 | SPA fallback nuốt `/studio/api/*` sai ⇒ 200 HTML thay 404/401 | P12 mount sau + loại prefix; AC-11 int |
| R-K6 | Đổi `profileId` nullable lan kiểu sang runner | ripple §6; `bun run typecheck` toàn repo + H1/H2b int |
| R-K7 | `before/after` audit chứa `system_prompt` dài | ≤ 20 000 ký tự; không phải secret (không có secret trong `agents`) |

## 11. Câu hỏi mới — **QB1–QB7: người dùng chấp nhận 2026-10-06** (QB1 chốt: chỉ `agentic-cli`, hằng `ORCHESTRATOR_RUNTIMES` ở contracts; G1–G13 cũng chấp nhận)
| # | Câu hỏi | Mặc định | Nếu đổi |
|---|---|---|---|
| QB1 ✔ chấp nhận 2026-10-06 | R07 cho `llm` làm Orchestrator, nhưng Hub chỉ chạy Orchestrator `agentic-cli` (`config.rules` `orchestratorProblem`) — lưu `llm` làm mặc định sẽ làm hỏng định tuyến toàn hệ thống | **Chỉ `agentic-cli`** tới khi `llm` chạy được (H2d/LLM gateway); 409 `AGENT_NOT_ORCHESTRATABLE{runtime_unsupported}`. Mở thêm = sửa một hằng | Cho lưu `llm` = Hub lên với `orchestrator_problem` |
| QB2 ✔ chấp nhận 2026-10-06 | R03/R07 lệch CHECK DB (key không cho `_`, description 1–1000 vs 20–400, timeout 1 vs 10, history_n 0 vs 1) | **Theo DB** (khớp ui §13 mô tả 20–400, khớp Runtime `timeout_s ≥ 10`) | Nới = migration đổi CHECK + Runtime |
| QB3 ✔ chấp nhận 2026-10-06 | `dify-*` lưu workflow ở đâu? | **Cả hai**: `runtime_options.workflow_key` (Runtime H2a) + `agent_workflows` (Admin chặn xoá); `dify-agent` nhận app `chat`\|`agent` (như seed H2a) | Chỉ `agent_workflows` = sửa Runtime H2a |
| QB4 ✔ chấp nhận 2026-10-06 | `agents.profile_id` NOT NULL nhưng R03 bỏ profile với `dify-*` | Migration D2 cho NULL + CHECK bắt buộc với `llm`/`agentic-cli` | Giữ NOT NULL = server tự gán profile giả |
| QB5 ✔ chấp nhận 2026-10-06 | Đổi `key`/`runtime` sau tạo? | **Bất biến** (đổi runtime = tạo agent mới, Nhân bản R12) | Cho đổi = kiểm lại workflow/Orchestrator mỗi lần |
| QB6 ✔ chấp nhận 2026-10-06 | `audit_log.tenant_id` cho cấu hình toàn hệ thống | **NULL** (D3); bản Orchestrator tenant ghi tenant đích | Dùng tenant của actor = tenant_admin tenant đó thấy cấu hình platform |
| QB7 ✔ chấp nhận 2026-10-06 | Tool `Edit`/`Bash` và `runtime_options` của `python` | Lưu được, cảnh báo (`tools_not_supported`, `runtime_not_ready`); Runtime chỉ chạy `ALLOWED_TOOLS`. `python`: Hub **không** kiểm JSON Schema (không thêm ajv/ADR) — Runtime kiểm khi chạy | Kiểm ở Hub = ADR thêm ajv |

## 12. Trả lời đề xuất FE (plan-frontend §10)
Nhận: E1 (tên trường theo FE, `limit` 200), E2, E4, E6 (`current` = bản đầy đủ; không `updated_by.display_name`), E7, E9, E10, E11, E12. Khác FE: **E3** — không tính `active_step` ở H4a (logic Gateway, H4b); `providers.state` có sẵn, FE ẩn dòng "Lúc này chạy bằng". **E5** — tenant trả `active` (cột thật), không `locked`; Orchestrator trả `tenant{id,key,name}`. **E8** — `KEY_TAKEN{field}`; tenant khoá ⇒ 409 `TENANT_INACTIVE`, tenant không có ⇒ 400 `INVALID_REFERENCE{tenant_id}`, agent không làm được Orchestrator ⇒ 409 `AGENT_NOT_ORCHESTRATABLE{reason}`; validation giữ dạng Hub `details.issues[{path, code, message}]` (không `details.fields`).

## 13. Task: [`tasks.md`](tasks.md) (B1–B6).
