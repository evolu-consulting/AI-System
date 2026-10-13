---
id: H4b2-models
title: H4b-2 · Models (provider, profile, trạng thái sống) + Quyền agent (entitlement agent × tenant)
milestone: H4b-2 (phần còn lại của H4b; mở 2026-10-13 sau CR-074 bỏ K2)
status: ready-for-gate
requirements: [HUB-FR-66, HUB-FR-67, HUB-FR-78, HUB-FR-77, HUB-BR-17, AC-H04, AC-H4b2-01, AC-H4b2-02, AC-H4b2-03, AC-H4b2-04, AC-H4b2-05, AC-H4b2-06, AC-H4b2-07]
design:
  - docs/design/agent-hub/ba-agent-hub.md HUB-FR-66, HUB-FR-67 (dòng ~209–210) · HUB-FR-77, HUB-FR-78 (~227–228) · HUB-BR-17 (~359) · AC-H04 · bảng `providers`, `provider_state` (~378, ~388)
  - docs/design/agent-hub/ui-agent-studio.md §8 Models (dòng 120) · §9 Quyền agent (130) · flow F3, F5 · §13 Validation & trạng thái
  - canvas: docs/design/agent-hub/canvas/Models.dc.html (§8), Access.dc.html (§9)
  - nền: docs/specs/H4b1-secrets/spec.md (kho `hub.secrets`, `provider_api_key`, `useSecret`, "Được dùng bởi") · H4a (Studio khung, audit, `hub_config_version`)
owner: backend-lead + frontend-lead + qc
---

# H4b-2 · Models + Quyền agent

## 1. Phạm vi
**Làm:**
- CRUD **provider** (key, loại `api`|`subscription-cli`, hãng, base URL, `max_concurrency`, `enabled`) và gắn `providers.secret_id` → secret `provider_api_key` của H4b-1 (HUB-FR-66). Xoá secret đang được provider dùng bị chặn (đã có "Được dùng bởi" ở H4b-1).
- Trạng thái sống `provider_state` (ok/busy/cooldown/error/logged_out, slot dùng/tổng, `cooldown_until`, `last_error`) hiện ở bảng Providers.
- **"Kiểm tra key"** (loại `api`) và **"Kiểm tra lại"** (subscription): kết quả ok/lỗi nguyên văn trong khối "Chi tiết" (ui-admin P7); không ghi key vào log/audit.
- CRUD **model profile**: chuỗi bước (provider + model) sắp xếp bằng Lên/Xuống (kéo-thả → TECH-DEBT), điều kiện chuyển `error|quota|timeout`; cảnh báo profile toàn subscription (HUB-FR-67; AC-H04).
- **Entitlement agent × tenant** (HUB-FR-78 phần `platform_admin`): ma trận + drawer xem grant + thu hồi (ConfirmDialog), hiệu lực ≤ 5 s, grant giữ lại khi thu hồi; audit + tăng `hub_config_version`. Kiểm quyền dùng agent (HUB-FR-77) chỉ là bối cảnh — logic đã có ở `agent-grants`; spec này thêm nguồn ghi entitlement và không đổi công thức.
- HUB-BR-17: `tenant_admin` chỉ cấp agent đã có entitlement (kiểm lại khi thu hồi; không đổi UI Admin › Groups).

**Không làm:** tab **Đơn giá** (`price_book`, Studio §8) — không thuộc FR của mốc, để mốc cost/quota; chạy thật provider `api` (chờ H2d; dev dùng `fake-*`); đăng nhập CLI subscription (runbook Worker, chỉ hiện hướng dẫn); cấp grant (ở Admin, HUB-FR-78 phần `tenant_admin`); nạp tri thức vào KH (K2 đã bỏ, CR-074).

## 2. Nghiệp vụ
Nguồn: BA HUB-FR-66/67/77/78, HUB-BR-17; UI §8, §9.

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| Vendor tạo ở Studio | `fake` chọn được cho tạo, luôn `dev_only = true` (không có ở production); `dify` không chọn được | Q3 |
| Quyền thao tác | Chỉ `platform_admin` (tenant `platform`) CRUD provider/profile và đổi entitlement; role khác → 403 | HUB-FR-78 |
| Provider `api` | Bắt buộc `secret_id` trỏ secret `provider_api_key` còn tồn tại; loại `subscription-cli` không có secret, có `max_concurrency` ≥ 1 | HUB-FR-66, H4b-1 |
| Xoá provider | Chặn nếu còn profile dùng (409 kèm danh sách profile); chỉ tắt (`enabled=false`) thì profile tự dự phòng bước kế | HUB-FR-67 (đề xuất, Q2) |
| Profile | ≥ 1 bước; mỗi bước (provider, model, điều kiện chuyển); thứ tự = thứ tự thử; dòng tóm tắt "lúc này chạy bằng" tính từ `provider_state` | UI §8 |
| Thu hồi entitlement | Grant giữ nguyên (khôi phục khi cấp lại) nhưng không còn hiệu lực; run đang chạy xong; agent tắt: entitlement vẫn giữ, cột mờ | HUB-FR-78, UI §9 |
| Nhật ký | Mọi ghi → audit (không có giá trị secret) + `hub_config_version` +1 | HUB-FR-69, HUB-FR-78 |

## 3. Contract (backend-lead)
Tái dùng tối đa: bảng `hub.providers`/`model_profiles`/`provider_state`/`agent_entitlements` **đã có** (0000); ghi entitlement **đã có** (`AgentSettingsService.putEntitlement`, CR-054); HUB-BR-17 **đã có** (`/agent-grants` ⇒ `NOT_ENTITLED`); `GET /studio/api/providers` + `/model-profiles` **đã có** (chỉ thêm trường). File mới: `packages/contracts/src/studio/models.ts`, `studio/entitlements.ts` (export qua `@ai/contracts/studio`). Mọi object `strictObject`. Luật/hàm: `plan.md` §2–§3.

**Kiểu chung**
| Tên | Định nghĩa |
|---|---|
| `PROVIDER_KINDS` | `["subscription","api"]` (giá trị DB; UI ghi "Subscription"/"API" — BA "subscription-cli" = `subscription`) |
| `STUDIO_PROVIDER_VENDORS` | `["anthropic","openai","google","fake"]` — `dify` không chọn được (hàng `dify` = `readonly`, do seed quản) |
| `ProviderKeySchema` | `AgentKeySchema` (`^[a-z][a-z0-9-]{1,47}$`) |
| `BaseUrlSchema` | `string().trim().max(300).nullable()`; luật `baseUrlProblem` (plan §2.1): `https:` không userinfo/query/hash; `http:` chỉ khi APP_ENV dev/test **và** host loopback ⇒ sai: 400 path `base_url` |
| `ProfileStepSchema` | có sẵn (`hub/job.ts`): `{ provider_key, model: string(1..100) \| null, on: ("error"\|"quota"\|"timeout")[] ≤ 3 }`; `on` của bước i = điều kiện **rời** bước i sang i+1 (HUB-FR-31); bước cuối: `on` được lưu nhưng bỏ qua |
| `RefSchema` | `{ id: uuid, key: string }` |
| `ProviderStateSchema` | `{ status: "ok"\|"busy"\|"cooldown"\|"error"\|"logged_out", cooldown_until, last_probe_at, last_ok_at: ISO \| null, utilization: number \| null, last_error: string ≤ 500 \| null }` (chỉ ở **chi tiết**) |

**A. Provider** (`/studio/api/providers*`, chỉ `platform_admin` — 403 trước parse, sẵn ở `mountH4a`)
| Method · path | Request | 2xx | Lỗi |
|---|---|---|---|
| `GET /providers` (có) | như cũ | 200 list cũ; item **thêm** `version: int ≥ 1`, `slots_in_use: int ≥ 0` (job `running`). Giữ H4a-R13: **không** `secret_id`/`last_error` ở list | 400 |
| `GET /providers/:id` | — | 200 `ProviderDetail` = item list + `secret: { id, name } \| null`, `readonly: bool` (vendor `dify`), `updated_at`, `state: ProviderState \| null`, `used_by_profiles: Ref[] ≤ 50` | 404 |
| `POST /providers` | `ProviderCreate` `{ key, kind, vendor, base_url, secret_id: uuid \| null, max_concurrency: int 1..100 = 1, enabled: bool = true }` | 201 `ProviderDetail` (`version 1`; vendor `fake` ⇒ `dev_only = true`) | 400 · 409 `KEY_TAKEN` |
| `PUT /providers/:id` | `ProviderUpdate` `{ version, base_url, secret_id, max_concurrency, enabled }` (`key`/`kind`/`vendor` bất biến) | 200 `ProviderDetail` (`version + 1`) | 400 · 404 · 409 `VERSION_CONFLICT{current: ProviderDetail, updated_at}` · 409 `PROVIDER_READONLY` |
| `PATCH /providers/:id/enabled` | `{ version, enabled }` | 200 `ProviderDetail` | như PUT |
| `DELETE /providers/:id?version=N` | query `{ version }` | 204 | 404 · `VERSION_CONFLICT` · `PROVIDER_READONLY` · `PROVIDER_IN_USE{profiles: Ref[] 1..50}` · `PROVIDER_HAS_HISTORY` (đã có job) |
| `POST /providers/:id/check` | — | 200 `ProviderCheckResult` | 404 · `PROVIDER_READONLY` · 409 `NOT_CONFIGURED` (Hub thiếu `HUB_SECRETS_KEY`) |

Hình dạng (`providerShapeProblem`, plan §2.1; sai ⇒ 400 `VALIDATION_ERROR` theo path): `api` ⇒ `secret_id` bắt buộc; `subscription` ⇒ `secret_id = null` và `base_url = null`. `secret_id` không tồn tại hoặc khác kind `provider_api_key` ⇒ 400 `INVALID_REFERENCE{field:"secret_id", reason:"not_found"\|"wrong_kind"}`.

`ProviderCheckResult` = `{ status: "ok"\|"error"\|"unsupported"\|"requested", error_code: "auth_failed"\|"http_error"\|"timeout"\|"network"\|"secret_unreadable"\|null, http_status: int \| null, message: string ≤ 500 \| null, latency_ms: int \| null, checked_at: ISO }`.
- `api`: Hub đọc key qua `useSecret` (tenant `null`), gọi **liệt kê model** của hãng, hạn **10 s**, `redirect: "error"` (bảng hãng: plan §2.2). 2xx ⇒ `ok`; 401/403 ⇒ `error/auth_failed`; mã khác ⇒ `http_error`; `message` = thân lỗi nguyên văn **đã che key** (`redactKey`) và cắt 500. Vendor `fake`: **không gọi mạng** — key bắt đầu `fake-ok` ⇒ ok, khác ⇒ 401 `invalid x-api-key (fake)`.
- `subscription`: không gọi CLI từ Hub; đặt `provider_state.last_probe_at = NULL, last_ok_at = NULL` ⇒ Runtime probe ở nhịp kế (`TICK_MAX_S` 5 s; riêng cooldown quota chưa hết Runtime không probe ⇒ chờ hết hạn rồi `requested` — giới hạn đã biết); request **đồng bộ** (khớp plan-frontend D3): Hub đọc lại `provider_state` (`deps.sleep(500)` mỗi vòng, hạn 10 s theo đồng hồ) — có probe mới (`last_probe_at` ≥ lúc yêu cầu) ⇒ `ok` (status `ok`/`busy`) hoặc `error` (`message` = `last_error`); hết 10 s ⇒ `requested` (FE: "Worker chưa kiểm xong", xem bảng). Không giữ transaction khi chờ.
- Trường kết quả: timeout/network ⇒ `latency_ms` = ms thực, `http_status` null; `secret_unreadable`/`unsupported` ⇒ `latency_ms` null; subscription ⇒ `error_code`/`http_status` null, `latency_ms` = ms đã chờ; `message` luôn qua `redactKey(text,"")`. Lỗi `fetch`: `e.name ∈ {TimeoutError, AbortError}` ⇒ `timeout`, còn lại `network`. 404/409 không ghi audit.
- Không lưu kết quả `api` vào `provider_state` (trạng thái sống do Runtime sở hữu). FE suy `supported = status ≠ "unsupported"`, `ok = status === "ok"` (thay đề nghị C3).

**B. Model profile** (`/studio/api/model-profiles*`)
| Method · path | Request | 2xx | Lỗi |
|---|---|---|---|
| `GET /model-profiles` (có) | như cũ | item (và `ModelProfile`) có `steps: ProfileStepSchema[]` (model nullable ≤ 100, `on` enum) và **thêm** `version`, `active_step: int \| null`, `all_subscription: bool`, `agent_count: int` | 400 |
| `GET /model-profiles/:id` | — | 200 `ModelProfile` = item + `updated_at`, `used_by_agents: Ref[] ≤ 50` | 404 |
| `POST /model-profiles` | `{ key, steps: ProfileStepSchema[1..5] }` | 201 `ModelProfile` | 400 · `KEY_TAKEN` |
| `PUT /model-profiles/:id` | `{ version, steps }` (key bất biến) | 200 | 400 · 404 · `VERSION_CONFLICT{current, updated_at}` |
| `DELETE /model-profiles/:id?version=N` | — | 204 | 404 · `VERSION_CONFLICT` · `PROFILE_IN_USE{agents: Ref[] 1..50}` |

Bước (`stepsProblem`): `provider_key` phải tồn tại và không `readonly`; cặp (`provider_key`, `model`) không trùng; `on` không trùng ⇒ sai: 400 `INVALID_REFERENCE{field:"steps", index, reason:"not_found"\|"readonly"}` / `VALIDATION_ERROR` path `steps.<i>`. Provider đang tắt được chọn (cảnh báo ở FE). `active_step` = `pickStep` (plan §2.3; Studio truyền `agentHasOwnModel=false`) theo `enabled` + `provider_state` lúc đọc; `all_subscription` = mọi bước là `subscription` (FE cảnh báo, AC-H04/UI §8).

**C. Quyền agent** (`/studio/api/agent-entitlements*`, path theo đề nghị C5–C7 của FE)
| Method · path | Request | 2xx | Lỗi |
|---|---|---|---|
| `GET /agent-entitlements` | — | 200 `{ agents: [{ id, key, name, enabled, is_orchestrator, only_tenant_id: uuid \| null }] ≤ 200, tenants: [{ id, key, name, active }] ≤ 200, cells: [{ agent_id, tenant_id, granted_at, grant_count: int, grants: { group, user, tenant: int } }], truncated, hub_config_version }` — `cells` chỉ entitlement **chưa thu hồi**; `only_tenant_id` = Orchestrator riêng của một tenant (ô khác không áp dụng) | — |
| `GET /agent-entitlements/:agent_id/:tenant_id` | — | 200 `{ agent: {id,key,name}, tenant: {id,key,name}, entitled, granted_at, granted_by: {id, username} \| null, revoked_at, grants: [{ id, subject_type: "group"\|"user"\|"tenant", subject: {id, name}, granted_by_username, granted_at }] ≤ 200, grants_truncated }` (drawer; grant hiện cả khi đã thu hồi) | 404 |
| `PUT /agent-entitlements/:agent_id/:tenant_id` (cấp, idempotent) · `DELETE …` (thu hồi) | — | 200 `{ hub_config_version, affected_grants: int }` — gọi **nguyên** `AgentSettingsService.putEntitlement(actor, tenant, agent, PUT?true:false)` (khoá config → ghi/khôi phục `revoked_at` → bump → audit `agent_entitlement.enable\|disable` → NOTIFY); không đổi ⇒ không bump. `affected_grants` = số grant của (agent, tenant) | 400 `INVALID_REFERENCE{field:"agent_id"}` · 404 tenant · 409 `AGENT_IS_DEFAULT` |

Path param `:id`, `:agent_id`, `:tenant_id` không phải uuid ⇒ 400 `VALIDATION_ERROR` (cả 3 nhóm route). Hiệu lực ≤ 5 s qua `hub_config_version` + NOTIFY sẵn có; công thức HUB-FR-77 không đổi.

**Đối chiếu đề nghị FE C1–C7:** `spec-decisions.md` §Đối chiếu FE.

**Mã lỗi** — `STUDIO_MODEL_ERRORS` (hằng riêng, không sửa `STUDIO_ERRORS` đã khoá): `PROVIDER_IN_USE` 409 · `PROVIDER_HAS_HISTORY` 409 · `PROVIDER_READONLY` 409 · `PROFILE_IN_USE` 409. Dùng lại: `KEY_TAKEN` (`details = KeyTakenDetailsSchema {field:"key"}`), `VERSION_CONFLICT`, `INVALID_REFERENCE` (thêm field `"secret_id"\|"steps"`, `index?: int 0..4`, reason `"wrong_kind"\|"readonly"` — chỉ thêm), `NOT_FOUND`, `VALIDATION_ERROR`, `FORBIDDEN`, `NOT_CONFIGURED`, `AGENT_IS_DEFAULT`.

**Audit** (qua `withConfigWrite`: bump + NOTIFY): entity `provider` / `model_profile`, `tenant_id = null`, `entity_name = key`, action `create|update|delete|enable|disable`; `before/after` = trường sửa được (`secret_id` là id, không giá trị). `check`: action `check`, ghi audit **không** bump (như K1), `after = { status, error_code, http_status }` — **không** `message`. Entitlement: audit sẵn có của `putEntitlement`.

## 4. Dữ liệu (backend-lead)
Đối chiếu migration thật: **không bảng mới**. Migration `packages/db/migrations-hub/0030_h4b2_models.sql` (viết tay, idempotent như 0028; chỉ THÊM cột/GRANT/CHECK — không mất dữ liệu) + `meta/_journal.json` idx 30.

| # | Thay đổi | Lý do |
|---|---|---|
| 1 | `hub.providers` + `version integer NOT NULL DEFAULT 1` CHECK `>= 1`; `hub.model_profiles` + như vậy | Khoá lạc quan (`VERSION_CONFLICT`) như agents/secrets; hàng cũ = 1 |
| 2 | `GRANT INSERT, DELETE ON hub.providers TO hub_rw` + `GRANT UPDATE (base_url, secret_id, max_concurrency, enabled, version, updated_at)` | `key`/`kind`/`vendor`/`dev_only` bất biến ở mức DB (seed chạy owner, không ảnh hưởng) |
| 3 | `GRANT INSERT, DELETE ON hub.model_profiles TO hub_rw` + `GRANT UPDATE (steps, version, updated_at)` | `key` bất biến |
| 4 | `GRANT UPDATE (last_probe_at, last_ok_at) ON hub.provider_state TO hub_rw` | "Kiểm tra lại" = xoá mốc probe và `last_ok_at` (Runtime coi `last_ok_at` null là đến hạn); **không** đụng `updated_at` (rào R15 của probe giữ nguyên) |
| 5 | `hub_audit_log_entity_check` + `'provider'`, `'model_profile'` (DROP + ADD giữ toàn bộ giá trị 0029) | Audit |

Có sẵn, không đổi: `providers_secret_fk` RESTRICT (0028) · `provider_state` FK CASCADE · `provider_models` CASCADE · `jobs.provider_key` FK (không ON DELETE ⇒ RESTRICT; service trả `PROVIDER_HAS_HISTORY` trước, 23503 là chốt cuối) · `agents.profile_id` FK RESTRICT (⇒ `PROFILE_IN_USE`, 23503 chốt cuối) · `model_profiles_steps_check` (1..5) · `agent_entitlements` + index `(tenant_id) WHERE revoked_at IS NULL` · GRANT `hub_rw` ghi `agent_entitlements` (0018).

**RLS:** không thêm — `providers`/`model_profiles`/`provider_state`/`agent_entitlements` là cấu hình dùng chung (HUB-BR-15), cách ly bằng role + `requirePlatformAdmin` (như 0010 D1, 0018). Mọi ghi chạy scope `system` trong `withConfigWrite`.

**Drizzle:** `version` vào `providers`/`modelProfiles` ở `packages/db/src/schema/hub.ts` (đang 400 dòng ⇒ rút 2 dòng comment); `MODELS_AUDIT_ENTITIES = ["provider","model_profile"]` ở file mới `schema/hub-models.ts`, trải vào `HUB_AUDIT_ENTITY_VALUES`.

**Index / truy vấn mới:** `spec-decisions.md` §Index (đều dùng index sẵn có hoặc quét bảng ≤ 200 hàng).

**Seed** (`hub:seed`, `seed.repo.ts`): upsert provider/profile có đổi ⇒ thêm `version = version + 1` (để Studio đang mở nhận `VERSION_CONFLICT` thay vì ghi đè). Không thêm hàng seed (provider `api` cho test do qc tạo kèm secret `fake-ok-…`).

## 5. UI (frontend-lead)
Chi tiết: [`plan-frontend.md`](plan-frontend.md) (quyết định D1–D12, câu chữ VI/EN, validate, role+nhãn e2e, đối chiếu C1–C7). Hàng ma trận = agent, cột = tenant; chỉ nút Lên/Xuống (kéo-thả: TECH-DEBT #162). Tóm tắt: hai route lazy `/models` (tab Providers, Profiles; Sheet provider; hộp "Kết quả kiểm tra" đồng bộ ≤ 10 s; Sheet runbook "Hướng dẫn") và `/access` (ma trận công tắc, drawer xem grant, ConfirmDialog thu hồi "N grant"). Không thêm thư viện. Tab Đơn giá không hiện.

**Artboard:**

| Màn | Artboard | Tình trạng |
|---|---|---|
| Models › Providers (bảng, trạng thái, slot, cooldown) | `canvas/Models.dc.html` | Có |
| Models › Profiles (StepsEditor) | `canvas/Models.dc.html` | Có (một khung) |
| Quyền agent: ma trận agent × tenant | `canvas/Access.dc.html` | Có |
| Quyền agent: drawer ô (ngày cấp, người cấp, grant) | `canvas/Access.dc.html` | Có |
| Quyền agent: ConfirmDialog thu hồi | `canvas/Access.dc.html` | Có (chỉ nhắc "Thu hồi"; câu chữ "N grant… mất hiệu lực" theo UI §9) |
| Sheet sửa Provider (SecretField, `max_concurrency`) | `canvas/H4b2-Provider-Sheet.dc.html` | Đã duyệt 2026-10-13 |
| Kết quả "Kiểm tra key" / "Kiểm tra lại" (ok · lỗi · đang chạy · chưa hỗ trợ) | `canvas/H4b2-Check.dc.html` | Đã duyệt 2026-10-13 |
| Sheet runbook "Hướng dẫn" đăng nhập CLI (F3) | `canvas/H4b2-Runbook.dc.html` | Đã duyệt 2026-10-13 |
| Trạng thái rỗng / lỗi / không quyền / 409 | `canvas/H4b2-States.dc.html` | Đã duyệt 2026-10-13 |
| Tab Đơn giá | `Models.dc.html` | Có nhưng **ngoài phạm vi** mốc này |

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6. Hiệu lực entitlement/cấu hình ≤ 5 s (AC-H05, `hub_config_version` sẵn có). `POST …/check` (api) ≤ 10 s (hạn gọi hãng) + 1 INSERT audit; không giữ transaction trong lúc gọi mạng. Mỗi GET list/ma trận: ≤ 4 câu SQL, không N+1. "Kiểm tra lại" có kết quả ≤ 5 s + thời gian probe (Runtime `TICK_MAX_S = 5`).

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Secret provider (H4b-1) | `hub.secrets` thật trong DB test |
| API provider thật cho "Kiểm tra key" | Vendor `fake` kiểm trong tiến trình (key `fake-ok…` ⇒ ok), không gọi mạng; nhánh HTTP anthropic/openai/google test bằng `fetch` tiêm (`AppDeps.fetch`/`sleep` (qua `H4aDeps`)) |
| Worker/CLI subscription | `ai-hub-dev-runtime` (fake-cli); `provider_state` ghi tay trong test |

## 8. Tiêu chí nghiệm thu (qc)
Từ BA/UI; qc bổ sung dữ liệu cụ thể khi viết test (trước code).

| AC | Given / When / Then | Test |
|---|---|---|
| AC-H04 | **Dời H2d (Q4).** Theo BA AC-H04: 429 giữa chừng → chuyển bước kế. Thay trong mốc này bằng AC-H4b2-07 | — |
| AC-H4b2-07 | Dự phòng **lúc giao job** (`pickStep`, plan §2.3): bước có provider tắt bị bỏ; provider đang chặn bị bỏ khi `on` của bước có trigger tương ứng; log `job.fallback` + provider đích | `rules/profile-step` R50–R65, `dispatch.int` D01–D07 |
| AC-H4b2-01 | `platform_admin` tạo provider `api` gắn secret H4b-1 → có trong danh sách; chi tiết có `secret {id,name}`, không lộ giá trị (list không có `secret_id`, R13); role khác → 403 | `providers.int` A01–A08, A22, A24 · `role.int` Q01–Q03 · `rules/contracts` R73–R76 · e2e M03 |
| AC-H4b2-02 | "Kiểm tra key" key sai/đúng (mock) → khối Chi tiết hiện lỗi nguyên văn / ok; log + audit không chứa key | `provider-check.int` C01–C14 · `rules/provider-check-rules` R30–R47 · e2e M07–M10 |
| AC-H4b2-03 | Profile 2 bước, thứ tự (Lên/Xuống) lưu đúng; xoá provider đang được profile dùng → 409 kèm tên profile | `profiles.int` P01–P02 · `providers.int` A17, A21 · e2e M12, M24 |
| AC-H4b2-04 | Cấp entitlement agent A cho `acme` ở ma trận → ≤ 5 s user `acme` được cấp grant dùng được A; audit + `hub_config_version` +1 (HUB-FR-77/78) | `entitlements.int` E03–E04 · e2e M31 |
| AC-H4b2-05 | Thu hồi entitlement có 2 grant → ConfirmDialog nêu "2 grant"; sau xác nhận agent biến khỏi danh sách user; cấp lại → grant tự có hiệu lực; run đang chạy vẫn xong | `entitlements.int` E05–E06 · e2e M32 |
| AC-H4b2-06 | `tenant_admin` `acme` cấp agent chưa có entitlement → từ chối (HUB-BR-17); không thấy entitlement tenant khác | `entitlements.int` E09–E10 · e2e M37 |

Lệnh xong: `bun run done:h4b2` (alias `done:h4b`; `tools/scripts/src/done-h4b2.ts`) = `bun run typecheck && bun test && bun run test:int && bunx playwright test -c e2e/studio/playwright.config.ts h4b2 && bun run trace --check && bun run test:lock:verify`. Chi tiết: `test-plan.md` §6.

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- 2026-10-13: thứ tự H4b-1 → K1 → H4b-2 → P-c; K2 bỏ (CR-074).
- 2026-10-13: người dùng **duyệt mockup** (https://claude.ai/artifact/Vmv8GtcmBAN9GyXG7A8fcj) và **chốt Q1–Q8 theo mặc định** dưới đây.
### Câu hỏi đã chốt (mặc định được người dùng chấp nhận 2026-10-13)
- Q1 Tab Đơn giá ngoài mốc. Mặc định: ngoài. *backend-lead: đồng ý (không có bảng `price_book`).*
- Q2 Xoá provider đang được profile dùng → 409 (không cascade). Mặc định: 409. *backend-lead: đồng ý — `PROVIDER_IN_USE{profiles}`; thêm `PROVIDER_HAS_HISTORY` vì `jobs.provider_key` FK RESTRICT (đã chạy job ⇒ chỉ tắt được).*
- Q3 "Kiểm tra key" gọi endpoint liệt kê model của hãng, timeout 10 s; hãng chưa hỗ trợ → "Chưa hỗ trợ kiểm tra". Mặc định: vậy. *backend-lead: đồng ý; cả 3 hãng Studio chọn được đều hỗ trợ, `fake` kiểm trong tiến trình; `unsupported` chỉ còn cho hàng cũ vendor lạ.*
Câu mới của backend-lead (bằng chứng + phương án khác: `spec-decisions.md`):
- **Q4** AC-H04/HUB-FR-31 thử bước kế *giữa chừng* cần Runtime + provider api (H2d). **Mặc định:** H4b-2 làm dự phòng **lúc giao job** (`pickStep`: bỏ bước provider tắt, hoặc đang chặn mà `on` có trigger); AC-H04 nguyên văn dời H2d, qc thay bằng AC dự phòng lúc giao. **Chốt 2026-10-13 (readiness #1, "Không dự phòng"):** agent có `agent.model` riêng (CR-054) ⇒ `pickStep` chỉ xét bước 0, không chuyển bước; bước 0 không dùng được ⇒ hành vi hiện có (`blockedReason` ⇒ `ALL_PROVIDERS_EXHAUSTED`). Agent không có model riêng ⇒ dự phòng như trên, dùng `step.model`.
- **Q5** Provider `subscription` tạo ở Studio với key Runtime không phục vụ. **Mặc định:** cho tạo; `state = null` ⇒ FE "Chưa có Worker kiểm" + ghi chú runbook.
- **Q6** List provider giữ H4a-R13 (test khoá A17). **Mặc định:** `secret{id,name}` + `last_error` chỉ ở `GET /providers/:id`.
- **Q7** "Kiểm tra key" chỉ với key đã lưu. **Mặc định:** vậy (không thêm đường nhận key thô).
- **Q8** `key`/`kind`/`vendor` provider, `key` profile bất biến. **Mặc định:** vậy, chốt bằng GRANT cột.
### Trong lúc làm (agent tự quyết theo Luật 2)
- 2026-10-13 (PLAN FE): "Kiểm tra" là request đồng bộ ≤ 10 s, không polling; lệnh đăng nhập CLI theo hãng nằm trong i18n (không contract); dòng "lúc này chạy bằng" ~~tính ở client~~ → dùng `active_step` của server (điều phối chốt 2026-10-13, khớp `pickStep`); chỉ nút Lên/Xuống (kéo-thả → TECH-DEBT); xoá luôn qua xác nhận rồi gọi API (409 ⇒ InUseDialog); Sheet đóng sau lưu. Sau Gate chép 4 mockup vào `docs/design/agent-hub/canvas/`.

## 10. Tranh chấp test
- (không)
