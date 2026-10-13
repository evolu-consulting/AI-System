---
spec: H4b2-models
part: backend
owner: backend-lead
status: plan (2026-10-13; đã sửa theo readiness lần 1, chờ chạy lại)
requirements: [HUB-FR-66, HUB-FR-67, HUB-FR-77, HUB-FR-78, HUB-BR-17, HUB-FR-31 (phần lúc giao job, Q4)]
---

# Plan backend · H4b-2 Models + Quyền agent

Contract: spec §3. Dữ liệu: spec §4. Câu hỏi: spec §9 + `spec-decisions.md` (Q4–Q8). File này: quyết định, file, hàm thuần (qc test trước), luồng, thứ tự task.

## 0. Quyết định (D)
| # | Quyết định | Lý do |
|---|---|---|
| D1 | Không bảng mới; chỉ cột `version` + GRANT cột + audit CHECK (0030) | Bảng đã có từ 0000; người dùng ưu tiên tối giản |
| D2 | Entitlement Studio **gọi lại** `AgentSettingsService.putEntitlement` (không viết lại ghi/khôi phục/audit) | CR-054 đã có đủ: khôi phục `revoked_at = null`, `AGENT_IS_DEFAULT`, bump + audit + NOTIFY |
| D3 | HUB-BR-17 không đổi code: `/agent-grants` đã trả `NOT_ENTITLED` (`agent-grants.rules.ts`); thu hồi không xoá grant (`setEntitlement` chỉ đặt `revoked_at`) | Đọc code thật; AC-H4b2-05/06 kiểm hành vi sẵn có |
| D4 | `GET /providers`, `/model-profiles` cũ chỉ **thêm** trường; chi tiết + ghi ở path con | Không vỡ test khoá H4a A17 (R13) và FE Agent Forge đang đọc list |
| D5 | Mọi ghi provider/profile qua `withConfigWrite` (scope `system`; khoá `config_meta` → khoá hàng `FOR UPDATE` → kiểm version → ghi → bump → audit → NOTIFY) | HUB-FR-69, mẫu agents/secrets; snapshot cấu hình Hub nạp lại ≤ 5 s |
| D6 | Khoá lạc quan bằng cột `version` (không dùng `updated_at`) | Nhất quán `VERSION_CONFLICT{current, updated_at}` của Studio |
| D7 | "Kiểm tra key" (api): đọc key qua `HubSecretReader.useSecret({id, kind:"provider_api_key", tenantId:null})`, gọi hãng **ngoài** transaction, rồi một transaction ngắn ghi audit `check` (không bump) | Không giữ khoá DB khi chờ mạng; mẫu K1 `kh.check.service.ts` |
| D8 | Vendor `fake` kiểm trong tiến trình (không fetch); HTTP hãng thật qua `deps.fetch` tiêm được (mặc định `globalThis.fetch`) | Dev/test không gọi dịch vụ trả tiền; test nhánh HTTP bằng stub |
| D9 | "Kiểm tra lại" (subscription) = `UPDATE provider_state SET last_probe_at = NULL, last_ok_at = NULL WHERE provider_key = $k` (không đụng `status`/`updated_at`); không hàng ⇒ no-op (Runtime coi `status None` là đến hạn) | `probe_due` (`quota_rules.py:117-131`): `last_ok_at` gần đây ⇒ KHÔNG probe (R12) nên phải xoá cả hai; `last_probe_at` null ⇒ `_elapsed` đúng. Cooldown chưa hết hạn ⇒ Runtime không probe ⇒ trả `requested` (giới hạn, spec §3 A). Không sửa Python; rào R15 giữ |
| D10 | `pickStep` (Q4) là hàm thuần dùng chung cho `active_step` (Studio, `agentHasOwnModel=false`) và giao job (`job-agent-runner`, truyền theo `agent.model`) | Một luật, hai nơi đọc — dòng tóm tắt "lúc này chạy bằng" khớp thực tế |
| D11 | Hàng vendor `dify` = `readonly`: mọi ghi/kiểm ⇒ 409 `PROVIDER_READONLY`; không chọn được trong bước profile | Provider `dify` không thuộc profile, app-key ở Admin (seed comment) |
| D12 | Lỗi mới ở hằng riêng `STUDIO_MODEL_ERRORS`; `INVALID_REFERENCE` chỉ **thêm** giá trị enum | Không sửa `STUDIO_ERRORS` đã khoá (mẫu `HUB_ADMIN_AGENT_ERRORS`) |
| D13 | `message` của check: thân lỗi hãng (chuỗi `error.message` nếu JSON, không thì text) → `redactKey` → cắt 500. Audit/log **không** chứa `message` | Lỗi nguyên văn cho người dùng (UI P7) mà không lộ key (OpenAI vọng lại key đã che một phần) |
| D14 | Không ADR: không thư viện mới (`fetch` + `AbortSignal.timeout` sẵn trong Bun) | Luật PLAN #4 |

## 1. File
| File | Việc | Task |
|---|---|---|
| `packages/contracts/src/studio/models.ts` (+ `index.ts`, test cạnh) | `ProviderCreate/Update/EnabledPatch/Detail`, `ProviderCheckResult`, `ProviderState`, `ModelProfileWrite/Update`, `ModelProfile`, `Ref`, `KeyTakenDetailsSchema {field:"key"}`, item/`ModelProfile` `steps: ProfileStepSchema[]`, `STUDIO_PROVIDER_VENDORS`, `STUDIO_MODEL_ERRORS` + details; thêm trường vào `ProviderItemSchema`/`ModelProfileItemSchema` (`catalog.ts`); mở rộng `StudioInvalidReferenceDetailsSchema` (`errors.ts`) | B1 |
| `packages/contracts/src/studio/entitlements.ts` | Ma trận, ô, PUT body/response | B1 |
| `packages/db/migrations-hub/0030_h4b2_models.sql` + `meta/_journal.json` | spec §4 #1–#5 | B1 |
| `packages/db/src/schema/hub.ts` · `schema/hub-models.ts` (mới) | `version` 2 bảng; `MODELS_AUDIT_ENTITIES` trải vào `HUB_AUDIT_ENTITY_VALUES` | B1 |
| `packages/db/src/hub-h4b2.int.test.ts` | GRANT cột (UPDATE `key` bằng `hub_api` ⇒ 42501), audit CHECK, default version | B1 |
| `apps/hub-api/src/modules/studio/models/models.rules.ts` | §2.1 | B2 |
| `apps/hub-api/src/modules/studio/models/provider-check.rules.ts` | §2.2 | B2 |
| `apps/hub-api/src/modules/runner/profile-step.rules.ts` | §2.3 (`pickStep`) | B2 |
| `…/studio/models/providers.{repo,map,service,routes}.ts` | CRUD + PATCH enabled + chi tiết; list thêm `version`, `slots_in_use` (`studio-read.{service,repo,map}.ts`); path param không phải uuid ⇒ 400 `VALIDATION_ERROR` (3 nhóm route) | B3 |
| `…/studio/models/provider-check.ts` · `app.ts` | `ProviderChecker.check(actor, id)` (§3.2); `AppDeps.fetch/sleep` | B4 |
| `…/studio/models/profiles.{repo,map,service,routes}.ts` · `studio-read.{service,repo,map}.ts` | CRUD profile; list thêm `version`, `active_step`, `all_subscription`, `agent_count` | B5 |
| `apps/hub-api/src/modules/seed/seed.repo.ts` | upsert có đổi ⇒ `version = version + 1` | B5 |
| `apps/hub-api/src/modules/runner/runner.rules.ts` · `runner/job/job-agent-runner.ts` · `runner/job/runner.repo.ts` | `buildJobPayload` nhận bước đã chọn; `run` đọc state mọi provider của profile (`providerStatesOf(tx, keys)`) → `pickStep` | B6 |
| `…/studio/entitlements/entitlements.{repo,map,service,routes}.ts` | GET ma trận, GET ô; PUT ủy quyền `AgentSettingsService` | B7 |
| `apps/hub-api/src/app.h4a.ts` · `app.ts` (`AppDeps` thêm `fetch?`, `sleep?`) · `studio/README.md` | mount 3 nhóm route; `H4aDeps` thêm `fetch?`, `sleep?`; `appEnv`, reader secret qua deps sẵn có | B3, B4 (deps), B5, B7 |
| `tools/scripts/src/done-h4b2.ts` + script `done:h4b2` (alias `done:h4b`) | Lệnh xong mốc, 6 bước test-plan §6 | B8 |

## 2. Hàm thuần (qc viết test trước)

### 2.1 `models.rules.ts`
```ts
export type Env = { dev: boolean }; // APP_ENV ∈ {development, test}
export type ShapeProblem = { path: "secret_id" | "base_url"; reason: "required" | "forbidden" | "invalid" | "not_https" };
/** null = hợp lệ. https không userinfo/?/#; http chỉ dev + host ∈ {localhost,127.0.0.1,[::1]}; null luôn hợp lệ. */
export function baseUrlProblem(raw: string | null, env: Env): "invalid" | "not_https" | null;
/** api ⇒ secret_id ≠ null (else required); subscription ⇒ secret_id = null, base_url = null (else forbidden); rồi baseUrlProblem. */
export function providerShapeProblem(p: { kind: "api" | "subscription"; base_url: string | null; secret_id: string | null }, env: Env): ShapeProblem | null;
/** Secret tham chiếu: không có ⇒ not_found; kind ≠ provider_api_key hoặc tenant_id ≠ null ⇒ wrong_kind. */
export function secretRefProblem(row: { kind: string; tenantId: string | null } | undefined): "not_found" | "wrong_kind" | null;
export const isReadonlyProvider = (vendor: string): boolean => vendor === "dify";
/** Thứ tự: readonly ⇒ PROVIDER_READONLY; profiles.length > 0 ⇒ PROVIDER_IN_USE; hasJobs ⇒ PROVIDER_HAS_HISTORY; else null. */
export function providerDeleteBlock(p: { vendor: string; profiles: readonly Ref[]; hasJobs: boolean }): "PROVIDER_READONLY" | "PROVIDER_IN_USE" | "PROVIDER_HAS_HISTORY" | null;
/** Bước i: provider không có ⇒ not_found; readonly ⇒ readonly; trùng (provider_key, model) ⇒ duplicate; `on` trùng ⇒ duplicate. Trả lỗi đầu tiên. */
export function stepsProblem(steps: readonly ProfileStep[], providers: ReadonlyMap<string, { vendor: string }>): { index: number; reason: "not_found" | "readonly" | "duplicate" } | null;
/** Mọi bước có kind 'subscription' (provider không có ⇒ coi như không phải subscription). */
export function allSubscription(steps: readonly ProfileStep[], kindOf: (key: string) => string | undefined): boolean;
/** Trường sửa được đổi gì (audit + "không đổi ⇒ không bump"). */
export function providerChanged(before: ProviderEditable, after: ProviderEditable): (keyof ProviderEditable)[];
```
Map lỗi: `required|forbidden|invalid|not_https` ⇒ 400 `VALIDATION_ERROR` path; `not_found|wrong_kind` (secret) và `not_found|readonly` (bước) ⇒ 400 `INVALID_REFERENCE`; `duplicate` ⇒ 400 `VALIDATION_ERROR` path `steps.<i>`.

### 2.2 `provider-check.rules.ts`
```ts
export const CHECK_TIMEOUT_MS = 10_000;
export type CheckHit = { status: number; body: string } | "timeout" | "network";
/** Bảng hãng (Q3). null = unsupported. base mặc định khi base_url null. */
export function vendorCheckRequest(vendor: string, baseUrl: string | null, key: string): { url: string; headers: Record<string, string> } | null;
//   anthropic: GET {base ?? https://api.anthropic.com}/v1/models · x-api-key, anthropic-version: 2023-06-01
//   openai:    GET {base ?? https://api.openai.com}/v1/models · Authorization: Bearer <key>
//   google:    GET {base ?? https://generativelanguage.googleapis.com}/v1beta/models · x-goog-api-key (KHÔNG để key ở query)
//   fake: không có request (fakeCheck); khác ⇒ null
/** fake: key bắt đầu "fake-ok" ⇒ {status:200, body:"{}"}; khác ⇒ {status:401, body:'{"error":{"message":"invalid x-api-key (fake)"}}'}. */
export function fakeCheck(key: string): CheckHit;
/** Thay mọi lần xuất hiện của key, mọi chuỗi con ≥ 8 ký tự liền của key, và mẫu /(sk-|sk_|AIza)[A-Za-z0-9_-]{6,}/ bằng "***". */
export function redactKey(text: string, key: string): string;
/** JSON {error:{message}} | {error:string} | {message} ⇒ chuỗi đó; không thì text thô. Rồi redactKey, cắt 500. Rỗng ⇒ null. */
export function errorMessageOf(body: string, key: string): string | null;
/** 2xx ⇒ ok; 401/403 ⇒ error/auth_failed; khác ⇒ http_error; "timeout"|"network" ⇒ error/<đó>, http_status null. */
export function checkOutcome(hit: CheckHit, key: string, latencyMs: number, now: Date): ProviderCheckResult;
/** Lỗi fetch: e.name ∈ {TimeoutError, AbortError} ⇒ "timeout"; còn lại ⇒ "network". */
export function hitOfFetchError(e: unknown): "timeout" | "network";
/** Subscription: state undefined hoặc lastProbeAt null/< t0 ⇒ null (chưa có probe mới). Có probe mới: status ok|busy ⇒ ok; khác ⇒ error, message = redactKey(lastError ?? "", "") cắt 500 (rỗng ⇒ null). error_code/http_status null, latency_ms = now - t0. */
export function subscriptionOutcome(state: { status: string; lastProbeAt: Date | null; lastError: string | null } | undefined, t0: Date, now: Date): ProviderCheckResult | null;
```
`checkOutcome`: `latency_ms` = ms thực cho mọi nhánh (timeout/network gồm); `secret_unreadable`/`unsupported` do service dựng, `latency_ms` null.

### 2.3 `runner/profile-step.rules.ts` (Q4)
```ts
export type StepView = { enabled: boolean; state: { status: string; cooldownUntil: Date | null } | undefined };
export type Pick = { ok: true; index: number; skipped: { index: number; why: "disabled" | "quota" | "error" }[] }
                 | { ok: false; reason: "quota" | "provider_unavailable" };
/** Trigger khi provider đang chặn (khớp providerBlocked/blockedReason của runner.rules): cooldown chưa hết ⇒ quota; logged_out|error ⇒ error; còn lại null. */
export function blockedTrigger(s: StepView["state"], now: Date): "quota" | "error" | null;
/**
 * Duyệt bước theo thứ tự: provider vắng (vd dev_only bị bỏ) hoặc tắt ⇒ bỏ qua vô điều kiện (why "disabled");
 * blockedTrigger null ⇒ chọn bước này; trigger ∈ steps[i].on ⇒ bỏ qua; trigger ∉ on ⇒ dừng {ok:false, reason: quota|provider_unavailable}.
 * Hết bước ⇒ {ok:false, reason: lý do của bước bị chặn cuối, chỉ có bước tắt ⇒ "provider_unavailable"}.
 */
export function pickStep(steps: readonly ProfileStep[], view: (key: string) => StepView | undefined, now: Date, agentHasOwnModel: boolean): Pick;
```
`agentHasOwnModel = true` (agent có `agent.model`, CR-054; spec §9 Q4 "Không dự phòng"): chỉ xét bước 0, **không** chuyển bước, `skipped` luôn `[]`. Bước 0 vắng/tắt ⇒ `{ok:false, reason:"provider_unavailable"}`; bị chặn ⇒ `{ok:false, reason: quota (cooldown) | provider_unavailable (logged_out|error)}` bất kể `on`; không chặn ⇒ `{ok:true, index:0}`. Payload dùng `agent.model`, không dùng `step.model`.
`active_step` (Studio) = `pickStep(...).ok ? index : null`. Bảng ca cho qc: (1) bước 0 ok ⇒ 0; (2) bước 0 tắt ⇒ 1; (3) bước 0 cooldown + `on:[quota]` ⇒ 1, skipped quota; (4) bước 0 cooldown + `on:[]` ⇒ ok:false quota; (5) bước 0 logged_out + `on:[error]` ⇒ 1; (6) cooldown đã hết hạn (`cooldownUntil ≤ now`) ⇒ 0; (7) mọi bước tắt ⇒ provider_unavailable; (8) 2 bước, cả hai cooldown, on:[quota] ⇒ quota. **Agent có model riêng (`agentHasOwnModel=true`):** (9) bước 0 ok ⇒ 0; (10) bước 0 tắt, bước 1 ok ⇒ ok:false provider_unavailable; (11) bước 0 cooldown + on:[quota], bước 1 ok ⇒ ok:false quota, skipped []; (12) bước 0 logged_out + on:[error], bước 1 ok ⇒ ok:false provider_unavailable; (13) bước 0 cooldown đã hết hạn ⇒ 0.

### 2.4 `entitlements.map.ts`
`toMatrix(agents, tenants, ents, grantCounts, version, limit=200)` — gom `grants` theo `(agent_id, tenant_id)` thành `{group, user, tenant}` (thiếu ⇒ 0), `truncated` khi agents hoặc tenants > 200. `only_tenant_id` = `orchestrator_settings.tenant_id` khi agent là Orchestrator riêng.

## 3. Luồng service
### 3.1 Provider (`providers.service.ts`)
| Thao tác | Bước |
|---|---|
| POST | parse → `providerShapeProblem` (400) → `withConfigWrite`: key trùng (`KEY_TAKEN`; 23505 ⇒ cùng mã) → `secret_id` ⇒ đọc `hub.secrets(kind, tenant_id)` → `secretRefProblem` → INSERT (`dev_only = vendor==='fake'`) → audit `create` → 201 chi tiết |
| PUT / PATCH | `withConfigWrite`: `SELECT … FOR UPDATE` (vắng ⇒ 404) → readonly ⇒ 409 → `version` lệch ⇒ `VERSION_CONFLICT{current, updated_at}` → hình dạng với `kind` DB → secret ref → `providerChanged` rỗng ⇒ trả hiện tại, audit null (không bump) → UPDATE `version+1, updated_at=now()` → audit `update` (PATCH: `enable`/`disable`) |
| DELETE | `withConfigWrite`: khoá hàng → version → `profilesUsing(key)` + `hasJobs(key)` → `providerDeleteBlock` → DELETE (cascade state/models) → audit `delete`; 23503 ⇒ `PROVIDER_HAS_HISTORY` |
| GET :id | REPEATABLE READ read only (mẫu `studio-read.service`): hàng + secret `{id,name}` (JOIN cột meta, không ciphertext) + state + `slots_in_use` + `used_by_profiles` |

### 3.2 Kiểm tra (`provider-check.ts`)
1. Đọc provider (scope system, ngoài transaction ghi). Vắng ⇒ 404; readonly ⇒ 409.
2. `subscription` ⇒ `t0 = now()` (DB) → `withHubScope(system)`: `UPDATE provider_state SET last_probe_at = NULL, last_ok_at = NULL` (D9) → ngoài transaction, lặp `deps.sleep(500)` tới khi **đồng hồ** quá `CHECK_TIMEOUT_MS` (10 s) kể từ `t0`: đọc `provider_state`; `last_probe_at ≥ t0` ⇒ `subscriptionOutcome(state, t0, now)` (`ok|busy` ⇒ ok; khác ⇒ error, `message = redact(last_error)`); hết hạn ⇒ `requested`. Hàm thuần `subscriptionOutcome` (§2.2) ở `provider-check.rules.ts`. `sleep` tiêm được (test không chờ thật).
3. `api`: `reader.useSecret({id: secret_id, kind:"provider_api_key", tenantId:null}, async (key) => …)` — trong callback: `fake` ⇒ `fakeCheck`; khác ⇒ `vendorCheckRequest` (null ⇒ `unsupported`) → `deps.fetch(url, {headers, redirect:"error", signal: AbortSignal.timeout(CHECK_TIMEOUT_MS)})` → đọc body ≤ 64 KB → `checkOutcome` (key chỉ sống trong callback). `SecretUseError` (`key_missing` ⇒ 409 `NOT_CONFIGURED`; `secret_missing|decrypt_failed` ⇒ `error/secret_unreadable`, `latency_ms` null). Lỗi `fetch` ⇒ `hitOfFetchError`. 404/409 không ghi audit.
4. Transaction ngắn: audit `provider.check` `after = {status, error_code, http_status}` (không bump, không `message`). Trả kết quả.
Log: chỉ `{provider_key, status, error_code, http_status, latency_ms}`.

### 3.3 Profile (`profiles.service.ts`)
POST/PUT: parse (`ProfileStepSchema` 1..5) → `withConfigWrite`: (PUT khoá hàng + version) → đọc `providers` (key, vendor, kind) → `stepsProblem` → INSERT/UPDATE (`version+1`) → audit `create|update` (`before/after = {steps}`); steps giống hệt ⇒ không bump. DELETE: khoá + version → `agentsUsing(id)` ≥ 1 ⇒ `PROFILE_IN_USE{agents}`; 23503 ⇒ cùng mã → DELETE → audit `delete`. GET list/:id: 1 câu profiles + 1 câu providers⋈state (cho `pickStep`, `allSubscription`) + 1 câu đếm agents.

### 3.4 Giao job (`job-agent-runner.run`, B6)
Thay `providerStateOf(tx, steps[0].provider_key)` bằng `providerStatesOf(tx, keys của profile)` (1 câu `WHERE provider_key = ANY($1)`) → `pickStep(profile.steps, k ⇒ {enabled: snapshot.providers[k]?.enabled, state}, now, agent.model != null)`. **Agent có `agent.model` riêng ⇒ chỉ bước 0, không dự phòng** (spec §9 Q4, người dùng chốt); không có ⇒ dự phòng và dùng `step.model` → `ok:false` ⇒ `syntheticFailed(ALL_PROVIDERS_EXHAUSTED, reason)` như cũ; `ok` ⇒ `buildJobPayload({...i, step: steps[index]})` (`profile_steps` = [bước đó], `step_index 0` — contract job không đổi). Khi `skipped` ≠ ∅: `log.info("job.fallback", {run_id, skipped:[{index, why, provider_key}], to: provider_key})`. Không đổi luồng enqueue/follow. `job-agent-runner.ts` đang 371 dòng: phần chọn bước tách hàm `#pickStep` ≤ 25 dòng, nếu quá 400 thì chuyển `#payload` + chọn bước sang `job-payload.ts`.

### 3.5 Entitlement (`entitlements.service.ts`)
Path `/studio/api/agent-entitlements` (đề nghị FE C5–C7). GET ma trận: REPEATABLE READ read only, 4 câu (agents ⋈ orchestrator_settings; `admin.tenants` order key limit 201; entitlements `revoked_at IS NULL`; `agent_grants` group by) + `configVersion`. GET ô: agent + tenant (404 nếu vắng) + hàng entitlement (có thể đã thu hồi) + grants ⋈ `admin.groups`/`admin.users` (tên; `tenant` ⇒ tên tenant) order `granted_at` limit 201. PUT/DELETE `/:agent_id/:tenant_id`: `AgentSettingsService.putEntitlement(actor, tenant_id, agent_id, PUT)` (D2) — lỗi giữ nguyên mã; sau đó đếm `agent_grants` của cặp ⇒ `affected_grants` (đọc sau commit, chỉ để hiển thị).

## 4. Deps & env
`AppDeps` (`app.ts`) và `H4aDeps` thêm `fetch?: typeof fetch` (mặc định global) và `sleep?: (ms) => Promise<void>` (chờ probe, §3.2). `appEnv` (đã có) ⇒ `Env.dev`. Reader secret: `new HubSecretReader({ db, key: deps.hubSecretsKey ?? null, log })` như K1. Không biến môi trường mới.

## 5. Kiểm "không lộ" (gợi ý cho qc, AC-H4b2-02)
- Key `fake-ok-<uuid>` / `fake-bad-<uuid>`: grep response list, chi tiết, audit (`before/after/summary`), log stdout ⇒ không có chuỗi key; `message` của check sai = `invalid x-api-key (fake)`.
- Stub `fetch` trả body vọng key (`"Incorrect API key provided: <key>"`) ⇒ `message` chứa `***`, không chứa key hay chuỗi con ≥ 8 ký tự.
- `GET /providers` (list) vẫn không có `secret_id`/`last_error` (A17 H4a xanh).
- Kiểm tra lại: `provider_state.updated_at` không đổi, `last_probe_at` = NULL.

## 6. Rủi ro
| Rủi ro | Giảm |
|---|---|
| Key lộ qua thân lỗi hãng / log / audit | D13 `redactKey` + audit không `message` + log trường cố định; test §5 |
| SSRF/lộ key tới `base_url` lạ | Chỉ `platform_admin`; `baseUrlProblem` (https; http chỉ loopback dev); `redirect:"error"`; key chỉ ở header |
| Đổi luồng giao job (B6) làm hỏng run đang chạy được | `pickStep` với profile 1 bước, provider bật, không chặn ⇒ đúng hành vi cũ (ca 1); chạy lại `runner.test.ts` + `runner.int.test.ts` |
| Seed ghi đè sửa của Studio | Seed tăng `version` (FE nhận 409); PRODUCTION-NOTES: không chạy lại seed provider/profile trên prod sau khi sửa ở Studio |
| `hub.ts` vượt 400 dòng | Rút comment; mảng audit ở `hub-models.ts` |
| Thứ tự khoá | Mọi ghi: `config_meta` trước, rồi hàng đích (như agents) — không khoá `provider_state` trong `withConfigWrite` (D9 chạy transaction riêng) |

## 7. Thứ tự task BE
B1 → B2 → (B3, B5, B7 song song được) → B4 (sau B3) → B6 (sau B2) → B8. Chi tiết, cột Đọc/Rủi ro/Model: `tasks.md`.
