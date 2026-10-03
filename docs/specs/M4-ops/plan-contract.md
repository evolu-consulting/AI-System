# Plan · M4-ops · Phụ lục contract khối A + B (backend-lead)

Tách từ [plan.md](plan.md) §2 (trần kích thước); giữ số mục 2.1–2.5 để `tasks.md`/spec trỏ "plan §2.x" vẫn đúng. Khối C + D: [plan-cd §3–4](plan-cd.md). Đối chiếu câu hỏi FE: plan §2.

## 2. Contract

Quy ước: mọi schema `z.strictObject`; tiền là **chuỗi thập phân** `Money = /^\d{1,10}(\.\d{1,6})?$/` (numeric trả string, không mất chính xác); giới hạn USD nhập `MoneyLimit = /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/` và > 0. Ngày `DateOnly = /^\d{4}-\d{2}-\d{2}$/` (ngày giờ VN). `Count` = int ≥ 0.

### 2.1 Quota (`quotas.ts`) — FR-40, M4-R02, Q9

| Endpoint | Role | Request | 200 | Lỗi |
|---|---|---|---|---|
| `GET /admin/tenants/:id/quotas` | platform; tenant_admin chỉ `:id` = tenant mình | — | `QuotaSetResponse` | 404 (không có / tenant khác), 403 member |
| `PUT /admin/tenants/:id/quotas` | platform | `QuotaSetRequest` | `QuotaSetResponse` | 400 `VALIDATION_ERROR` (trùng `feature_id`, > 100 dòng), 400 `INVALID_REFERENCE` (feature không có), 403, 404, 409 `VERSION_CONFLICT` `details:{current: QuotaSetResponse, updated_at}` |
| `GET /admin/quota-banner` | platform → `{banner:null}`; tenant_admin; member 403 | — | `{banner: QuotaBanner \| null}` | 403 |

| Schema | Trường |
|---|---|
| `QuotaLimits` | `max_runs: int 1..1e9 \| null` · `max_tokens: int 1..1e12 \| null` · `max_usd: MoneyLimit \| null` |
| `QuotaItemInput` | `feature_id: uuid \| null` (null = cả tenant) + `QuotaLimits` |
| `QuotaSetRequest` | `version: int ≥1` (version **tenant**) · `items: QuotaItemInput[] ≤100` — dòng mọi giới hạn null bị bỏ (= không giới hạn) |
| `QuotaUsage` | `runs: Count` · `tokens: Count` · `billable_usd: Money` · `unpriced_rows: Count` |
| `QuotaStatus` | `feature_id: uuid\|null` · `feature_key: string\|null` · `feature_name: LocalizedText\|null` · `QuotaLimits` · `used: QuotaUsage` · `pct: int ≥0 \| null` (null = không giới hạn) · `level: "none"\|"warn"\|"over"` |
| `QuotaSetResponse` | `tenant_id` · `version` (tenant) · `month: "YYYY-MM"` · `has_usage_data: bool` · `items: QuotaStatus[]` — **luôn** có dòng đầu `feature_id=null` (giới hạn null nếu chưa đặt), rồi theo `feature_key` tăng |
| `QuotaBanner` | `level: "warn"\|"over"` · `pct: int` · `feature_key: string\|null` (quota có `pct` cao nhất) |

PUT: tenant `version+1`, `updated_by`, `updated_at` (quota thuộc tenant, Q9). Sau commit gọi `evaluateTenant` (§5.2), lỗi chỉ log.

### 2.2 Usage (`usage.ts`) — FR-42, M4-R03, R07–R09

| Endpoint | Role | Query `UsageQuery` | 200 |
|---|---|---|---|
| `GET /admin/usage` | platform, tenant_admin | `tenant_id?: uuid` · `feature_id?: uuid \| "none"` · `from?`, `to?: DateOnly` (mặc định tháng hiện tại; `to` gồm cả ngày; `from ≤ to`; ≤ 366 ngày) | platform: `UsageReportPlatform`; tenant_admin: `UsageReportTenant` |
| `GET /admin/usage.csv` | như trên | như trên | `text/csv; charset=utf-8`, BOM, CRLF, `Content-Disposition: attachment; filename="usage-{tenant_key\|all}-{from}-{to}.csv"` |

tenant_admin: `tenant_id` vắng → tenant mình; khác tenant mình → **404**. Lỗi: 400 `VALIDATION_ERROR`, 403 member.

| Schema | Trường (`*` = chỉ bản Platform; bản Tenant **không có khoá**) |
|---|---|
| `UsageKpi` | `runs` · `tokens` · `input_tokens` · `output_tokens` · `billable_usd` · `unpriced_rows` · `overage_runs` · `cost_usd*` · `margin_usd*` (= billable − cost, có thể âm: `Money` cho phép `-`) |
| `UsageDay` | `date` · `runs` · `tokens` · `billable_usd` · `overage_billable_usd` · `cost_usd*` (đủ mọi ngày trong khoảng, ngày trống = 0) |
| `UsageTopFeature` (≤10, theo `billable_usd` giảm) | `feature_id\|null` · `feature_key\|null` · `feature_name\|null` (null = "Không theo feature") · `runs` · `tokens` · `billable_usd` · `overage: bool` · `cost_usd*` |
| `UsageTopUser` (≤10) | `user_id\|null` · `username\|null` · `display_name\|null` · `runs` · `tokens` · `billable_usd` · `cost_usd*` |
| `UsageTenantRow*` (≤200, chỉ khi `tenant_id` vắng) | `tenant_id` · `tenant_key` · `tenant_name` · `runs` · `tokens` · `billable_usd` · `cost_usd` · `quota_pct: int\|null` · `level` |
| `UsageReport*` | `range:{from,to}` · `tenant_id\|null` · `feature_id` · `has_data: bool` (R09: có ≥1 hàng `usage_logs` bất kỳ thời điểm cho phạm vi tenant) · `kpi` · `previous: UsageKpi` (khoảng liền trước cùng độ dài, cho delta) · `daily` · `top_features` · `top_users` · `quotas: QuotaStatus[]` (rỗng khi không chọn tenant) · `tenants*` |

CSV: một dòng / (ngày × tenant × feature). Cột tenant_admin: `date,tenant_key,feature_key,runs,input_tokens,output_tokens,billable_usd,overage_runs`; platform thêm `cost_usd` sau `billable_usd`. Null: `feature_key` = `""`, `billable_usd` null = `""`. Ô bắt đầu `= + - @ \t \r` được thêm `'` (chống formula injection).

### 2.3 Overview (`overview.ts`) — ui 7.2, missing §1, Q5

`GET /admin/overview` (platform, tenant_admin; member 403) → `OverviewResponse = discriminatedUnion("kind")`:

| `kind` | Trường |
|---|---|
| `"tenant"` | `tenant:{id,key,name}` · `month` · `active_users` · `groups` · `runs_month: Count\|null` · `runs_prev_month: Count\|null` (null khi `has_usage_data=false`) · `has_usage_data` · `quotas: QuotaStatus[]` · `banner: QuotaBanner\|null` · `never_logged_in: {id,username,display_name,created_at}[] ≤5` (active, `last_login_at` null, `created_at` giảm) · `never_logged_in_total` · `recent_changes: AuditItem[] ≤8` |
| `"platform"` | `tenants_active` · `commands_enabled` · `workflows_total` · `workflows_unattached` (không command nào trỏ tới) · `users_active` · `runs_24h: Count\|null` · `has_usage_data` · `quota_tenants: {tenant_id,tenant_key,tenant_name,pct,level}[] ≤10` (level ≠ none, pct giảm) · `recent_changes: AuditItem[] ≤8` · `unavailable: ("command_errors"\|"agent_studio")[]` (luôn đủ 2, Q5) |

### 2.4 Audit (`audit.ts`) — FR-51, 52, M4-R10–R13

| Enum | Giá trị |
|---|---|
| `AUDIT_ENTITIES` | `tenant, user, user_totp, group, grant, entitlement, feature, workflow, command, secret, quota, config` (`config` = import; `user_totp` = 2FA, plan-cd) |
| `AUDIT_ACTIONS` | `create, update, delete, lock, unlock, grant, revoke, restore, import` |

| Endpoint | Role | Request | 200 | Lỗi |
|---|---|---|---|---|
| `GET /admin/audit` | platform, tenant_admin | `AuditListQuery` | `{items: AuditItem[], next_cursor: string\|null}` | 400, 403 member, 404 (tenant_admin lọc tenant khác / `system`) |
| `GET /admin/audit/:id` | như trên | — | `AuditDetail` | 404 (không thấy qua RLS) |
| `POST /admin/audit/:id/restore` | **platform** (tenant_admin → 403 trước khi tra) | `{}` (strict) | `{entity, entity_id, version, audit_id}` | 403, 404, 409 `NOT_RESTORABLE`, 409 `VERSION_CONFLICT` (`details:{current, updated_at}` theo DTO thực thể), 409 `NAME_TAKEN` `details:{entity,name}`, 409 `RESTORE_REF_MISSING` `details:{missing:[{entity,id}]}`, + lỗi luật của module (vd 400 `COMMAND_NEEDS_FEATURE`) |

| Schema | Trường |
|---|---|
| `AuditListQuery` | `tenant_id?: uuid \| "system"` · `entity?` · `action?` · `actor_id?: uuid` · `entity_id?: uuid` (menu "Lịch sử" của editor M2/M3) · `from?`, `to?: DateOnly` (mặc định: 30 ngày gần nhất) · `q?: trim 1..100` (ILIKE `entity_name`) · `limit: 1..200 = 50` · `cursor?: string ≤ 32` |
| `AuditItem` | `id: uuid` · `at` · `tenant_id\|null` · `tenant_key\|null` · `actor_id\|null` · `actor_username\|null` (null = hệ thống) · `action` · `entity` · `entity_id\|null` · `entity_name` · `config_version: int\|null` (chip `v{n}`) · `entity_version: int\|null` (version thực thể sau thay đổi; câu "trước v{n}") · `summary: AuditSummary` · `restorable: bool` (= `canRestore` cho actor đang gọi) |
| `AuditSummary` (mọi khoá optional) | `subject_type`, `subject_name`, `feature_key`, `tenant_key` (grant/entitlement) · `added: string[]`, `removed: string[]` (member) · `value_changed: true` (secret) · `password_reset: true` · `restored_from: uuid`, `restored_version: int` · `file`, `added_count`, `updated_count` (import) |
| `AuditDetail` | `AuditItem` + `before: Record<string,unknown>\|null` · `after: …\|null` (secret: chỉ `name`,`note`; không có giá trị) |

Cursor = base64url của `seq` (bigint). Sắp `seq` giảm.

### 2.5 Thay đổi contract có sẵn

| File | Thay đổi |
|---|---|
| `common.ts` `API_ERRORS` | thêm `NAME_TAKEN: 409`, `NOT_RESTORABLE: 409`, `RESTORE_REF_MISSING: 409` (message EN ở `lib/errors.ts`) |
| `config.ts` `CONFIG_ENTITIES` | thêm `"quota"` (cộng thêm, Hub M5 parse) |
| `tenants.ts` `tenantShape`, `users.ts` `UserSchema` | thêm `updated_by: UpdatedBySchema` (username, null khi không thấy qua RLS — như groups M3) |
| NOTIFY mới (Hub → Admin) | kênh `quota_threshold`, payload `z.strictObject({tenant_id: uuid})` ≤ 100 byte; Hub/mock gửi khi ghi `usage_logs` (Q2b) |
