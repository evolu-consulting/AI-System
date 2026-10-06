# Plan · H3b-agent-grants (Hub TS)

SQL nguyên văn + migration: [`plan-db.md`](plan-db.md). Luật: spec §2 (H3b-R01…R23). Người dùng chốt: `spec-decisions` U1–U6 (Q-U1…Q-U4 = A). Chính xác hoá spec trong PLAN: `spec-decisions` "Quyết định trong lúc làm" PL1–PL17. Không Python, không frontend, **không ADR** (không thư viện mới). Code đã đọc 2026-10-06: `modules/{agents,config,seed,runs}`, `lib/{http,errors,auth.middleware}`, `app.ts`, `config/env.ts`, `packages/db/{schema,migrations-hub}`, `packages/contracts/src/{access,grants,groups}`, admin-api `access.rules`.

## 1. Quyết định
| # | Quyết định | Lý do / nguồn |
|---|---|---|
| P1 | Q-U1…Q-U4 = A; Q-K1…Q-K14 = mặc định, trừ chi tiết ghi PL | U6 |
| P2 | Contract mới ở subpath **`@ai/contracts/hub-admin`** (`packages/contracts/src/hub-admin/`); `chat`, `hub`, `hub-internal` **không đổi** (R21) | Q-K12 |
| P3 | Migration `0009_h3b_agent_grants.sql`: bảng `hub.audit_log` + trigger append-only + `GRANT INSERT, DELETE agent_grants`, **`GRANT UPDATE (hub_config_version) ON config_meta`**, `GRANT SELECT, INSERT audit_log` cho `hub_rw` + index `usage_logs_run_idx` | R08, R16, R22; PL2, PL7 |
| P4 | Module mới `modules/agent-grants/` (routes/service/repo/rules/effective); trace ở thư mục con `modules/runs/trace/` (thư mục `runs/` đã > 10 mục) | CONVENTIONS §2, §4 |
| P5 | Hai helper dùng chung ≥ 2 module → `lib/`: `hub-audit.ts` (grant + trace), `hub-config-write.ts` (khoá/bump/NOTIFY bằng Drizzle). `seed.repo.ts` **không sửa** (postgres.js thô, CLI) — trùng 2 câu ⇒ TECH-DEBT | P5 · Luật 4 (không refactor ngoài phạm vi) |
| P6 | Thứ tự trong transaction ghi grant: **`LOCK_META` (FOR UPDATE) trước** → ghi `agent_grants` → (có đổi) `BUMP_META` → audit → NOTIFY. Trùng/không có hàng ⇒ commit không bump/audit/NOTIFY | R06–R08; cùng thứ tự `seed` (config_meta trước) ⇒ seed ∥ POST không deadlock (PL3) |
| P7 | `targetTenant` (R02) là hàm thuần chạy **một lần** ở route; service nhận `T` đã chốt, mọi repo nhận `T` làm tham số đầu | R02, R03 |
| P8 | `parseQuery` hiện **bỏ** `tenant_id`/`user_id` (H1-R03). `/agent-grants*` dùng hàm mới `parseAdminQuery` (giữ `tenant_id`, schema strict); `parseQuery` không đổi | `lib/http.ts` (PL4) |
| P9 | Effective tính trên ảnh cache (R12) bằng hàm thuần `effectiveAgents` dựng trên **cùng** `accessInput`/`orchestratorIds`/`RUNNABLE_RUNTIMES`; `GET /agent-grants` (R11) đọc **DB** (thấy ngay sau POST, UI Admin refetch) | R11, R12 (PL5) |
| P10 | Trace: hàm thuần `traceAccess` quyết nhánh **trước** khi mở scope `system`; audit `view_trace` cùng transaction, ghi ngay sau khi thấy run, trước khi đọc phần còn lại | R17, R19 |
| P11 | Che `detail` bằng hàm thuần `redactTraceDetail` (khoá nhạy cảm + chuỗi dạng token) — lưới thứ hai; nguồn ghi `detail` đã che (`maskInputs` MCP, upstream Dify đã che) | R18 (PL9) |
| P12 | Lỗi ghi (bump/audit) tiêm được qua `AppDeps.hubAudit?: HubAuditWriter` (mặc định ghi DB) — qc dùng cho AC-04 "lỗi giữa transaction" và AC-11 | AC-04, AC-11 (PL10) |
| P13 | CORS: **không đổi code** (`cors({origin: cfg.corsOrigins})` đã danh sách trắng, mặc định chỉ chat-web). Chỉ `.env.example` thêm `http://localhost:3000` + `docs/guides/hub-dev.md` | R23, Q-K2 |
| P14 | **Không ADR** | WORKFLOW "Đề xuất công nghệ" |

## 2. Contract `@ai/contracts/hub-admin`
File: `packages/contracts/src/hub-admin/{index,errors,agent-grants,effective,trace}.ts` + `hub-admin.test.ts`; `packages/contracts/package.json` `exports["./hub-admin"]`. Tái dùng từ gốc: `UuidSchema`, `IsoDateTime`, `UpdatedBySchema`, `GrantSubjectSchema` (M3 grants — `{type:"group",group:GroupRef}` \| `{type:"user",user:{id,username,display_name}}`), `GroupRefSchema` (thêm `is_beta = key === BETA_GROUP_KEY`; SQL chỉ lấy `id, key, name`), `UserBlocker` (M3 access); từ `hub`: `AgentKeySchema`.

### 2.1 Lỗi
```ts
/** Mã riêng của API quản trị Hub (status theo Admin `API_ERRORS`). Không thêm vào CHAT_API_ERRORS (test khoá C1: đúng 6 mã). */
export const HUB_ADMIN_ERRORS = { FORBIDDEN: 403, TENANT_REQUIRED: 400, INVALID_REFERENCE: 400, NOT_ENTITLED: 409, AGENT_NOT_GRANTABLE: 409 } as const;
export const InvalidReferenceDetailsSchema = z.strictObject({ field: z.enum(["agent_id", "subject_id"]) });
export const NotEntitledDetailsSchema = z.strictObject({ agent_ids: z.array(UuidSchema).min(1).max(1) });
```
Dùng kèm mã chat có sẵn: `VALIDATION_ERROR` 400 (`details.issues`), `AUTH_EXPIRED` 401, `NOT_FOUND` 404, `INTERNAL_ERROR` 500. `AGENT_NOT_GRANTABLE` không `details`. Message tiếng Anh cố định (`lib/errors.ts` `ERROR_MESSAGES`): "Forbidden", "tenant_id is required", "Invalid reference", "Not entitled", "Agent cannot be granted".

### 2.2 `/agent-grants` (R04–R11)
| Schema | Trường (kiểu · ràng buộc) |
|---|---|
| `AgentGrantTenantQuerySchema` | `tenant_id?: uuid` (strict) |
| `AgentGrantListQuerySchema` | `tenant_id?: uuid`, `subject_type?: "group"\|"user"`, `subject_id?: uuid`; refine: `subject_type` và `subject_id` cùng có hoặc cùng vắng |
| `AgentGrantCreateSchema` (body) | `agent_id: uuid`, `subject_type: "group"\|"user"`, `subject_id: uuid` (strict — `tenant_id` trong body ⇒ 400) |
| `AgentGrantDeleteQuerySchema` | `tenant_id?: uuid`, `agent_id: uuid`, `subject_type`, `subject_id: uuid` (strict) |
| `HubAgentRefSchema` | `id: uuid`, `key: AgentKeySchema`, `name: {vi: string 1–100, en: string 1–100}` |
| `AgentGrantSchema` | `id: uuid`, `tenant_id: uuid`, `agent: HubAgentRef`, `subject: GrantSubject`, `granted_by: UpdatedBySchema` (username \| null), `granted_at: IsoDateTime` |
| `AgentGrantWriteResponseSchema` (POST 200/201) | `{grant: AgentGrant, hub_config_version: int ≥ 0}` (201: version sau bump; 200: version hiện tại, không đổi) |
| `AgentGrantListItemSchema` | `agent: HubAgentRef & {description: string ≤ 2000, enabled: bool, runnable: bool}`, `grants: AgentGrantRow[]` (≤ `AGENT_GRANTS_PER_AGENT_MAX` = 500), `grants_total: int ≥ 0` |
| `AgentGrantRowSchema` | `id`, `subject: GrantSubject`, `granted_by`, `granted_at` (không lặp `agent`, `tenant_id`) |
| `AgentGrantListResponseSchema` | `{tenant_id: uuid, items: AgentGrantListItem[] (≤ 200, sắp agent.key), truncated: bool, hub_config_version: int}` |

DELETE → **204** không thân. `runnable` = `RUNNABLE_RUNTIMES.has(runtime)` (Hub tính).

### 2.3 Effective (R12–R15) — dạng `EffectiveFeature`/`EffectiveCommand` M3
```ts
export const AGENT_MISSING = ["user_inactive", "tenant_locked", "agent_disabled", "runtime_unavailable", "no_entitlement", "no_grant"] as const; // thứ tự cố định R14
export const AgentAccessReasonSchema = z.discriminatedUnion("code", [
  z.strictObject({ code: z.literal("grant_user") }),
  z.strictObject({ code: z.literal("grant_group"), group: GroupRefSchema }),
]);
export const EffectiveAgentSchema = z.strictObject({
  agent: HubAgentRefSchema, visible: z.boolean(),
  reasons: z.array(AgentAccessReasonSchema), missing: z.array(z.enum(AGENT_MISSING)),
}).refine((a) => a.visible === (a.missing.length === 0), { path: ["visible"] });
export const EffectiveAgentsResponseSchema = z.strictObject({
  user: z.strictObject({ id: UuidSchema, tenant_id: UuidSchema }),
  agents: z.array(EffectiveAgentSchema).max(200),   // sắp agent.key
  hub_config_version: z.number().int().min(0),
});
```
`reasons` sắp: `grant_user` trước, rồi `grant_group` theo `group.key`. Mã `user_inactive`/`tenant_locked` trùng nghĩa M3 (`!active` · `!tenant.active ∨ locked_by_tenant`) để Admin gộp (CR-impact).

### 2.4 Trace (R18)
```ts
export const TRACE_STEPS_MAX = 200; export const TRACE_JOBS_MAX = 200; export const MASK = "••••";
StepUsage = { model: string|null, input_tokens: int≥0, output_tokens: int≥0, cost_usd: DecimalString|null, billable_usd: DecimalString|null }
RunTraceSchema = strictObject({
  run: { id, tenant_id, user_id, kind: string, status: string, error_code: string|null, error_message: string|null,
         config_version: int, conversation_id, flow_id, tokens_used: int, started_at: Iso, finished_at: Iso|null },
  messages: { user: TraceMessage|null, answer: TraceMessage|null },          // TraceMessage = {id, content, created_at}
  steps: TraceStep[] (≤ 200, theo seq),
  jobs: TraceJob[] (≤ 200),
  usage_total: StepUsage (model = null),
  truncated: bool,                                                             // steps hoặc jobs > 200
})
TraceStep = { id, seq: int, type: "orchestrator"|"delegate"|"workflow"|"tool", agent: {id, key}|null, workflow_id: uuid|null,
              provider_key: string|null, job_id: uuid|null, label_key: string, status: string,
              started_at: Iso, finished_at: Iso|null, ms: int|null, detail: Record<string,unknown>|null, usage: StepUsage|null }
TraceJob  = { id, step_id, type: string, provider_key: string, status: string, attempts: int, error_code: string|null,
              error_reason: string|null, created_at: Iso, started_at: Iso|null, finished_at: Iso|null }
```
`DecimalString` = `/^-?\d+(\.\d+)?$/` (numeric → text, như M4 usage). `kind`/`status` để `string` (không khoá enum Hub vào contract quản trị — thêm giá trị mới không phá). Không có trường nào chứa `payload`, `result`, `token`, `Authorization`.

## 3. Endpoint × lỗi
Mọi route qua `requireAuth` (thêm `"/agent-grants"` vào `PROTECTED_PREFIXES`); `/runs/:id/trace` nằm sẵn dưới `/runs`.

| Endpoint | Thành công | Lỗi (thứ tự kiểm) |
|---|---|---|
| `GET /agent-grants` | 200 `AgentGrantListResponse` | 401 · member **403 `FORBIDDEN`** · 400 `VALIDATION_ERROR` (query) · tenant_admin `tenant_id ≠ tid` **404** · platform_admin thiếu `tenant_id` 400 `TENANT_REQUIRED` · tenant không tồn tại 404 |
| `POST /agent-grants` | 201 mới / 200 trùng — `AgentGrantWriteResponse` | 401 · 403 · 400 body/query · 404/400 tenant (như trên) · 400 `INVALID_REFERENCE {field:"agent_id"}` · 409 `AGENT_NOT_GRANTABLE` · 409 `NOT_ENTITLED {agent_ids:[id]}` · 400 `INVALID_REFERENCE {field:"subject_id"}` · 500 (lỗi ghi — rollback) |
| `DELETE /agent-grants?…` | 204 (có hoặc không có hàng) | 401 · 403 · 400 query · 404/400 tenant |
| `GET /agent-grants/effective/:user_id` | 200 `EffectiveAgentsResponse` | 401 · 403 · 400 query · 404/400 tenant · `user_id` không phải uuid / không có / khác `T` → **404** |
| `GET /runs/:id/trace` | 200 `RunTrace` | 401 · 404 (`id` không uuid, không có, tenant khác, không phải chủ ∧ không platform_admin — thân giống hệt) · 500 `INTERNAL_ERROR` (ghi audit lỗi — không thân trace) |

Member bị 403 **trước** parse body/query (R01: không đọc DB). Đúng thứ tự R04: kiểm agent trước subject (lỗi agent che lỗi subject).

## 4. Luật thuần (QC viết test trước — `tests/acceptance/H3b/rules/`)
### 4.1 `modules/agent-grants/agent-grants.rules.ts`
```ts
/** H3b-R01/R02 · quyết tenant đích một lần (chưa kiểm tồn tại — service làm với platform_admin). */
export type TargetTenant = { ok: true; tenantId: string } | { ok: false; code: "FORBIDDEN" | "TENANT_REQUIRED" | "NOT_FOUND" };
export function targetTenant(user: { role: Role; tenantId: string }, queryTenantId: string | undefined): TargetTenant;
```
`member` ⇒ `FORBIDDEN` · `tenant_admin`: `q` vắng hoặc `q === tid` ⇒ `tid`; khác ⇒ `NOT_FOUND` · `platform_admin`: `q` vắng ⇒ `TENANT_REQUIRED`; có ⇒ `q`. Role lạ ⇒ `FORBIDDEN`.

```ts
/** H3b-R04 · thứ tự lỗi khi cấp (đầu vào đã đọc từ DB; null = cấp được). */
export type GrantCheck = { agent: { isOrchestrator: boolean; entitled: boolean } | null; subjectInTenant: boolean };
export function grantProblem(c: GrantCheck): "AGENT_NOT_FOUND_REF" | "AGENT_NOT_GRANTABLE" | "NOT_ENTITLED" | "SUBJECT_NOT_FOUND_REF" | null;
```
`agent = null` ⇒ `AGENT_NOT_FOUND_REF` (→ 400 `INVALID_REFERENCE agent_id`) · `isOrchestrator` ⇒ `AGENT_NOT_GRANTABLE` · `!entitled` ⇒ `NOT_ENTITLED` · `!subjectInTenant` ⇒ `SUBJECT_NOT_FOUND_REF` (→ 400 `INVALID_REFERENCE subject_id`). Không phụ thuộc role (R04: platform_admin không bỏ qua).

### 4.2 `modules/agent-grants/agent-effective.rules.ts`
```ts
export type EffectiveInput = {
  snapshot: AccessSnapshot & { agents: readonly (AgentRow & { runtime: string; name: { vi: string; en: string } })[] };
  tenantId: string;
  tenantActive: boolean;
  user: { id: string; active: boolean; lockedByTenant: boolean; groupIds: ReadonlySet<string> };
};
export type EffectiveAgentCalc = {
  agentId: string; key: string; visible: boolean;
  reasons: ({ code: "grant_user" } | { code: "grant_group"; groupId: string })[];
  missing: AgentMissing[];
};
export function effectiveAgents(i: EffectiveInput): EffectiveAgentCalc[];
```
- Phạm vi (R13): agent ∈ `snapshot.agents` có (entitlement `tenantId = T ∧ revokedAt = null`) **hoặc** (≥ 1 grant `tenantId = T` bất kỳ subject); loại `orchestratorIds(snapshot)`; sắp `key`.
- `reasons`: grant `T` có `subject = user.id` ⇒ `grant_user`; mỗi grant `T` có `subject ∈ groupIds` ⇒ `grant_group{groupId}` (khử trùng).
- `missing` theo đúng thứ tự `AGENT_MISSING`: `!user.active` ⇒ `user_inactive`; `!tenantActive ∨ user.lockedByTenant` ⇒ `tenant_locked`; `!agent.enabled` ⇒ `agent_disabled`; `!RUNNABLE_RUNTIMES.has(runtime)` ⇒ `runtime_unavailable`; không entitlement chưa thu hồi ⇒ `no_entitlement`; `reasons = []` ⇒ `no_grant`. `visible ⇔ missing = []`.
- Bất biến (qc test chéo, R12): với user active ∧ tenant active, `{a.agentId | visible}` = `{x.id | x ∈ visibleAgents(accessInput(snapshot, {tenantId, userId, groupIds}))}`.

### 4.3 `modules/runs/trace/trace.rules.ts`
```ts
/** H3b-R17 · quyết TRƯỚC khi mở scope system. `ownRun` = đã tìm thấy run bằng scope user {tid, sub}. */
export function traceAccess(user: { role: Role }, ownRun: boolean): "own" | "platform" | "not_found";
/** H3b-R18 · bản sao đã che: khoá khớp SENSITIVE_KEY_RE → MASK; chuỗi khớp SENSITIVE_VALUE_RE → MASK; sâu > 6 → MASK; JSON > 16 KiB → {truncated: true}; view `own` bỏ khoá gốc `message`, `upstream` (PL15). */
export const SENSITIVE_KEY_RE = /(api[_-]?key|secret|token(?!s)|password|passwd|authorization|cookie|credential|private[_-]?key)/i;
export const SENSITIVE_VALUE_RE = /(^bearer\s+\S+|\bapp-[A-Za-z0-9]{16,}|\bsk-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
export function redactTraceDetail(detail: unknown, view: "own" | "platform"): Record<string, unknown> | null;
/** ms = finished − started (≥ 0), null khi chưa xong. */
export function stepMs(startedAt: Date, finishedAt: Date | null): number | null;
```
`traceAccess`: `ownRun` ⇒ `own` (kể cả platform_admin — Q-U4 không audit) · `role = platform_admin` ⇒ `platform` · còn lại ⇒ `not_found` (Q-U2: tenant_admin cũng vậy). `redactTraceDetail(null|không phải object) ⇒ null` (mảng gốc ⇒ `{items: […đã che]}`). PL15: "sâu > 6" tính gốc = mức 1; 16 KiB = 16 384 byte UTF-8 của `JSON.stringify` sau khi che (`> 16384` ⇒ truncated). PL16: `token(?!s)` giữ `input_tokens`/`output_tokens`/`extra_tokens`.

## 5. Luồng
### 5.1 Tầng chung (`lib/`)
| File | Nội dung |
|---|---|
| `lib/errors.ts` | `HubErrorCode` ∪ `keyof HUB_ADMIN_ERRORS`; `HUB_ERRORS`/`ERROR_MESSAGES` thêm 5 mã (§2.1) |
| `lib/http.ts` | `parseAdminQuery(c, schema)` = `parseWith(schema, c.req.query())` (không bỏ `tenant_id`); comment vì sao chỉ dùng cho API quản trị |
| `lib/admin-role.middleware.ts` | `requireAdminRole()`: `role ∉ {tenant_admin, platform_admin}` ⇒ ném `FORBIDDEN` (trước mọi parse) |
| `lib/hub-config-write.ts` | `lockHubConfig(tx): Promise<number>` (`LOCK_META`), `bumpHubConfig(tx): Promise<number>` (`BUMP_META`), `notifyHubConfig(tx, version)` (payload như seed) |
| `lib/hub-audit.ts` | `type HubAuditRow` (§plan-db 3), `interface HubAuditWriter { insert(tx, row): Promise<void> }`, `dbHubAudit` (mặc định). `AppDeps.hubAudit?` ghi đè cho test (P12) |

### 5.2 `POST /agent-grants` (service `grant(actor, T, body)`)
`withHubScope(db, {kind:"user", tenantId: T, userId: sub})` (retry 40P01/40001 an toàn vì NOTIFY chỉ giao khi commit — Q-K7):
1. (platform_admin) `TENANT_EXISTS` → vắng ⇒ 404.
2. `AGENT_CHECK`, `SUBJECT_*` → `grantProblem` → ném lỗi tương ứng (không ghi gì).
3. `lockHubConfig` → `INSERT_GRANT … ON CONFLICT DO NOTHING RETURNING`.
4. 0 hàng ⇒ `FIND_GRANT` → trả **200** `{grant, hub_config_version: v_khoá}`; commit (không bump/audit/NOTIFY).
5. 1 hàng ⇒ `bumpHubConfig` → `ACTOR_NAME` → `hubAudit.insert(grant)` → `notifyHubConfig` → **201**.

### 5.3 `DELETE` / `GET` / effective
- **DELETE**: (1) như 5.2 → `lockHubConfig` → `DELETE_GRANT RETURNING` → 0 hàng ⇒ 204 (commit trống) · 1 hàng ⇒ bump → audit `revoke` → NOTIFY → 204. Không kiểm entitlement/Orchestrator (thu hồi luôn được).
- **GET list**: (1) → `LIST_AGENTS` → `LIST_GRANTS` → ghép; `hub_config_version` đọc trong cùng transaction (REPEATABLE READ, read only — như `loadHubSnapshot`).
- **Effective**: (1) (platform_admin: `TENANT_EXISTS`) → `config.user(user_id)`; vắng ∨ `tenantId ≠ T` ⇒ 404 → `config.tenant(T)` → `config.snapshot()` → `effectiveAgents` → `GROUP_REFS` cho các `groupId` trong `reasons` → map sang contract; `hub_config_version = snapshot.version`. Chỉ đọc, không audit (R15).

### 5.4 `GET /runs/:id/trace` (`modules/runs/trace/{trace.routes,trace.service,trace.repo,trace.rules}.ts`, mount `app.route("/runs", traceRoutes(...))` trong `mountProtected`)
1. `parseIdParam` (không uuid ⇒ 404).
2. Transaction A — scope `user {tid, sub}`: `TRACE_RUN` (ownedBy). Thấy ⇒ đọc §plan-db 5 trong **cùng** transaction ⇒ 200, không audit.
3. Không thấy ⇒ `traceAccess(role, false)`: `not_found` ⇒ **404** (không mở scope system).
4. `platform` ⇒ transaction B — scope `system`: `TRACE_RUN` (không ownedBy) → vắng ⇒ 404, **0 audit** · có ⇒ `hubAudit.insert(view_trace)` (lỗi ⇒ ném ⇒ rollback ⇒ 500, không trả trace — R19) → đọc steps/jobs/usage/messages lọc `tenant_id = run.tenant_id` → commit → 200.
5. Map: `detail` qua `redactTraceDetail(detail, view)` (`view` = kết quả `traceAccess`); `ms` qua `stepMs`; usage gắn theo `step_id`; `usage_total` = tổng mọi hàng.

### 5.5 Gắn vào app
`app.h3b.ts` (`mountH3b(app, {db, config, hubAudit})`, mẫu `app.h2b.ts`) gọi trong `mountProtected` khi có `db` + `config`: `/agent-grants` (routes grant + effective) và `/runs` trace. `app.ts` chỉ thêm prefix + một dòng gọi (file đang 227 dòng).

## 6. Thứ tự khoá & đồng thời
`[advisory user (E12)] → [K_CLAIM] → conversations → … → provider_state` (H3a §5) **không đổi**. Nhánh cấu hình Hub (tách biệt, không chạm bảng hội thoại): **`config_meta` → `agent_grants` → `audit_log`** (audit INSERT không khoá hàng khác).

| Đường | Khoá | Ghi chú |
|---|---|---|
| POST/DELETE grant | `config_meta` (FOR UPDATE, đầu tiên) → hàng `agent_grants` | Mọi ghi grant tuần tự hoá ở `config_meta` ⇒ 2 POST trùng: cái sau chờ, rồi `ON CONFLICT DO NOTHING` ⇒ 200 (AC-05); không bao giờ chờ unique index khi đang giữ hàng khác |
| Seed (`hub:seed`, owner) | `config_meta` (UPDATE) → agents… → `agent_grants` | Cùng chiều ⇒ seed ∥ POST không chu trình (PL3) |
| Trace (platform) | không khoá (SELECT + INSERT audit) | — |
| Cache nạp lại | REPEATABLE READ read only | không khoá |

Int bắt buộc chạy lại khi BUILD chạm: H1 `concurrency`, A37 `lock-order`, H1/H2a/H2b `seed.int` (bump/NOTIFY), H2b `agents-menu.int`.

## 7. Hiệu năng (spec §6 — đo `test:perf`, không chặn)
| Truy vấn | Index |
|---|---|
| `LIST_AGENTS` | `agent_entitlements_tenant_active_idx` (partial `revoked_at IS NULL`) |
| `LIST_GRANTS`, `INSERT/FIND/DELETE_GRANT` | `agent_grants_subject_idx (tenant_id, subject_type, subject_id)`, `agent_grants_uq` |
| `TRACE_*` | PK runs/messages, `run_steps_run_seq_uq`, `jobs_run_idx`, **`usage_logs_run_idx` (mới)** |
| Effective | 0 query cấu hình (cache) + 1 `GROUP_REFS` (PK) |
Grant 2xx → hiệu lực ≤ 5 s: NOTIFY khi commit → `ConfigCache` LISTEN `hub_config_changed` nạp lại (đường seed H1 đã đo).

## 8. Env, công cụ, lệnh xong
- Env Hub: **không biến mới**. `.env.example`: `HUB_CORS_ORIGINS=http://localhost:3100,http://localhost:3000` + comment "admin-web dev"; `docs/guides/hub-dev.md` mục "Admin gọi Hub" (origin, JWT dev mỗi role, `curl` 3 endpoint). Mặc định trong `env.ts` giữ chat-web (R23: không mở ngầm).
- `bun run done:h3b` (`tools/scripts/src/done-h3b.ts` + `done-h3b.test.ts`, mẫu `done-h3a.ts`): mọi bước `h3aSteps()` + unit `tests/acceptance/H3b/rules` (nối vào bước `bun test …`) + int `tests/acceptance/H3b/` (nối vào bước `bun --env-file=.env.local --config=bunfig.int.toml … tests/acceptance/H3a/` bằng `extend`) + `packages/db` int (đã có trong bước int) — không stack mới, không perf. `package.json`: `"done:h3b": "bun --env-file=.env.local tools/scripts/src/done-h3b.ts"`. `test:contract:chat` (41), `test:lock:verify`, `trace --check`, `check:size`, `depcruise` có sẵn trong chuỗi.

## 9. Rủi ro thêm (ngoài spec §10)
| # | Rủi ro | Giảm thiểu |
|---|---|---|
| K8 | Query `tenant_id` trong `parseQuery` bị bỏ âm thầm ⇒ platform_admin luôn nhận `TENANT_REQUIRED`, hoặc ngược lại ai đó "sửa" `parseQuery` làm hỏng H1-R03 | P8: hàm riêng `parseAdminQuery`; test khoá H1 A7 giữ nguyên |
| K9 | `GRANT UPDATE` mở cho `hub_rw` trên `config_meta` | Chỉ cột `hub_config_version` (PL2); D1 test `UPDATE … SET id` → 42501 |
| K10 | Trace qua scope `system` đọc nhầm `jobs`/`usage_logs` (không RLS) tenant khác | Mọi câu trace lọc `run_id` **và** `tenant_id = run.tenant_id`; reviewer kiểm |
| K11 | `detail` lọt secret do nguồn ghi mới sau này | P11 lưới `redactTraceDetail` + AC-10 quét chuỗi mẫu; nguồn ghi giữ `maskInputs` |
| K12 | `CREATE INDEX usage_logs_run_idx` khoá ghi `usage_logs` lúc migrate trên prod lớn | Dev/test nhỏ; ghi PRODUCTION-NOTES (I3): tạo `CONCURRENTLY` thủ công trước khi migrate |
| K13 | Hai câu bump/NOTIFY trùng giữa `seed.repo.ts` (postgres.js) và `lib/hub-config-write.ts` (Drizzle) | TECH-DEBT khi BUILD B1; payload cùng hằng `HUB_CONFIG_CHANNEL`/`HUB_CONTRACT_VERSION` |

## 10. Câu hỏi (Luật 2 không tự giải trọn — có mặc định, không chặn)
| # | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| QP1 | Actor (tenant_admin) bị khoá/vô hiệu nhưng JWT còn hạn có được cấp grant? | Đã có: `auth.middleware.ts:26` kiểm `accountUsable` từ cache ⇒ 401 sau khi cache nạp lại (≤ 5 s); đóng G12, không cần ca mới |
| QP2 | `granted_by` hiện username của platform_admin (tenant khác) cho tenant_admin xem | Có (như M3 `UpdatedBy`); không coi là lộ dữ liệu tenant |

## 11. Task: [`tasks.md`](tasks.md).
