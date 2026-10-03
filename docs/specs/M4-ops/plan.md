# Plan · M4-ops (backend, khối A + B)

Khối C + D (Import/Export, 2FA, ADR-0005): [`plan-cd.md`](plan-cd.md). Spec: [§2 luật M4-Rnn](spec.md#2-nghiệp-vụ), [§9 Q](spec.md#9-quyết-định). Mặc định Q0–Q13 giữ nguyên (không thấy sai); chi tiết hoá ở đây. Ưu tiên 2026-10-03: hiệu năng chỉ là mục tiêu (`*.perf.int.test.ts` → `test:perf`).

## 1. File

| Nơi | File (mới trừ khi ghi "sửa") | Việc |
|---|---|---|
| `packages/db/src/schema` | `ops.ts` (mới: `tenantQuotas`, `quotaAlerts`, `auditLog`); `admin.ts` (sửa: `updated_by` users/tenants) | §3 |
| `packages/db/migrations` | `0007_m4_ops.sql` (generate + nối tay phần RLS cuối file); TOTP là `0008_admin_totp` của plan-cd | §3.4 |
| `packages/db/src` | `audit-log.ts` (`insertAuditRows`), `config-meta.ts` (sửa: sink `audit`), `client.ts` (sửa: `listen`) | §4 |
| `packages/db/migrations-dev` | `0002_usage_at_idx.sql` (index `usage_logs (at)`, stub; ghi yêu cầu Hub M5) | §6 |
| `packages/contracts/src` | `quotas.ts`, `usage.ts`, `overview.ts`, `audit.ts`; sửa `common.ts` (mã lỗi), `config.ts` (`quota`), `tenants.ts`/`users.ts` (`updated_by`) | §2 |
| `apps/admin-api/src/lib/audit` | `audit.rules.ts` (snapshot/allowlist), `audit.write.ts` (`auditOf`, `recordAudit` cho tx không cfg) | §4 |
| `apps/admin-api/src/lib/mailer` | của plan-cd §9 (task TM); khối A chỉ inject `deps.mailer` | §5.3 |
| `apps/admin-api/src/lib/config/config-write.ts` | sửa: `ConfigCall.actor`, nối audit | §4.1 |
| `modules/quotas` | `quotas.{routes,service,repo,rules}.ts`, `quotas.evaluator.ts`, `quotas.alerts.ts` (mail), `quotas.listener.ts`, `quotas.restore.ts` | §5 |
| `modules/usage` | `usage.{routes,service,repo,rules}.ts`, `usage.csv.ts` | §5.4 |
| `modules/overview` | `overview.{routes,service,repo}.ts` | §5.5 |
| `modules/audit` | `audit.{routes,service,repo,rules}.ts`, `audit.restore.ts` (điều phối) | §4.3–4.4 |
| `modules/{commands,workflows,features,groups}` | `<m>.restore.ts` (adapter `(tx, ch)`), sửa service: gọi `ch.audit` | §4.2 |
| `modules/{tenants,users,secrets,grants}` | sửa service/batch: `ch.audit`; users reset → `recordAudit` | §4.2 |
| `tools/mocks/src` | `quota.ts` (`bun run mock:quota`) | §7 |

## 2. Contract → [plan-contract.md](plan-contract.md) (§2.1–2.5 giữ số)

**Đối chiếu FE §10** (chốt 2026-10-03; ✓ = nhận đề xuất FE, đổi = FE theo contract):

| # | Chốt | Ghi chú |
|---|---|---|
| 1 | ✓ | ADR-0005, không `recharts`; QR: server trả `qr_svg` → web **không** cài `qrcode` |
| 2 | đổi tên | `QuotaSetResponse` (§2.1): `feature_id/key/name`, `used{runs,tokens,billable_usd,unpriced_rows}`, `pct\|null`, `level`; tiền = chuỗi |
| 3 | đổi | giữ `GET /admin/quota-banner` → `{banner:{level:"warn"\|"over",pct,feature_key}\|null}`; ms §1 chỉ cần `pct`+`level`; không nhét vào `/auth/me` |
| 4 | đổi tên | `daily[].overage_billable_usd`; `by_tenant` → `tenants*`; `top_users`, `quotas`, `previous` luôn có; CSV ✓ |
| 5 | ✓ | `runs_24h: null` khi `has_usage_data=false` |
| 6 | đổi tên | `meta` → `summary` (`added_count/updated_count`; `added/removed` = mảng member); `secret_changed` → `summary.value_changed`; `restorable` luôn có |
| 7 | ✓ thêm | `GET /admin/export/meta` (plan-cd §3.1) |
| 8 | đổi tên | `{file_name, content, secrets?, base_config_version}`; `items[].op`; `missing_secrets[{name, used_by[]}]` ✓ (plan-cd §3.3); 409 `VERSION_CONFLICT {current}` |
| 9 | ✓ + mã | mã lỗi theo plan-cd §4.3 (không có `TOTP_INVALID`/`TOTP_TOKEN_EXPIRED`); `disable {current_password, code\|backup_code}` |
| 10 | ✓ | `updated_by: string\|null` (username) |


## 3. Dữ liệu

### 3.1 `admin.tenant_quotas` (M4-R02)
| Cột | Kiểu | Null / default / ràng buộc |
|---|---|---|
| `id` | uuid | PK `gen_random_uuid()` |
| `tenant_id` | uuid | NOT NULL, FK tenants `restrict` |
| `feature_id` | uuid | NULL = cả tenant; FK features `cascade` |
| `period` | text | NOT NULL `'month'`, CHECK = `'month'` |
| `max_runs` | integer | NULL; CHECK > 0 |
| `max_tokens` | bigint | NULL; CHECK > 0 |
| `max_usd` | numeric(12,2) | NULL; CHECK > 0 |
| `warn_pct` | smallint | NOT NULL 80, CHECK = 80 (RD#48) |
| `created_at`, `updated_at` | timestamptz | NOT NULL now() |
| `updated_by` | uuid | FK users `set null` |
Ràng buộc: `UNIQUE NULLS NOT DISTINCT (tenant_id, feature_id)` (`tenant_quotas_scope_uq`, phủ tra theo tenant); CHECK `num_nonnulls(max_runs,max_tokens,max_usd) >= 1`.

### 3.2 `admin.quota_alerts` (M4-R04, R05)
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | NOT NULL FK tenants `restrict` |
| `feature_id` | uuid | NULL; FK features `cascade` |
| `level` | smallint | CHECK IN (80, 100) |
| `month` | date | NOT NULL (ngày 1, giờ VN) |
| `pct` | smallint | NOT NULL ≥ 0 (lúc phát) |
| `status` | text | NOT NULL `'pending'`, CHECK IN (`pending`,`sending`,`sent`,`skipped`,`failed`) |
| `attempts` | smallint | NOT NULL 0 |
| `claimed_at`, `sent_at` | timestamptz | NULL |
| `last_error` | text | NULL, ≤ 200 (chỉ mã lỗi, không nội dung mail) |
| `created_at` | timestamptz | NOT NULL now() |
`UNIQUE NULLS NOT DISTINCT (tenant_id, feature_id, level, month)`; index `(status, claimed_at) WHERE status IN ('pending','sending')`.

### 3.3 `admin.audit_log` (M4-R10, R11)
| Cột | Kiểu | Ràng buộc |
|---|---|---|
| `id` | uuid | PK |
| `seq` | bigint | `GENERATED ALWAYS AS IDENTITY`, UNIQUE (thứ tự, cursor) |
| `at` | timestamptz | NOT NULL now() |
| `tenant_id` | uuid | NULL = toàn hệ thống; **không FK** |
| `actor_id` | uuid | NULL = hệ thống; **không FK** |
| `actor_username` | text | NULL (snapshot: RLS users che platform admin với tenant_admin) |
| `action`, `entity` | text | NOT NULL, CHECK theo enum §2.4 |
| `entity_id` | uuid | NULL (import) |
| `entity_name` | text | NOT NULL `''`, ≤ 200 |
| `config_version`, `entity_version` | integer | NULL |
| `before`, `after` | jsonb | NULL |
| `summary` | jsonb | NOT NULL `'{}'` |
| `snapshot` | boolean | NOT NULL false (true = before/after là bản đầy đủ, khôi phục được) |
Index: `(tenant_id, seq DESC)`, `(entity, entity_id, seq DESC)`, `(actor_id, seq DESC)`. Không FK để INSERT sau bump không chờ khoá (§4.1).

### 3.4 Cột mới + migration
- `users.updated_by`, `tenants.updated_by`: uuid NULL, FK users `set null` (helper `updatedBy()` có sẵn). Không cấp cho `hub_ro` (users dùng GRANT theo cột, 0002).
- `0007_m4_ops.sql`: `bun run db:generate` từ schema (3 bảng + 2 cột), rồi **nối tay** vào cuối cùng file (chưa commit nên được) phần RLS/quyền dưới đây, mỗi lệnh một `--> statement-breakpoint`. Bảng TOTP: `0008_admin_totp` (plan-cd). Không sửa migration đã commit (CONVENTIONS §8).
- Phần RLS/quyền của `0007`:

| Bảng | RLS `admin_rw` (mẫu `0006`, chưa dùng InitPlan — TD #28 ngoài phạm vi) | Quyền |
|---|---|---|
| `tenant_quotas` | FOR ALL: platform hoặc `tenant_id` = scope | `hub_ro`: SELECT, policy `USING (true)` |
| `quota_alerts` | FOR ALL như trên | `REVOKE ALL … FROM hub_ro` |
| `audit_log` | `audit_log_select` FOR SELECT + `audit_log_insert` FOR INSERT WITH CHECK: platform, hoặc tenant và `tenant_id` = scope (hàng `tenant_id` NULL chỉ platform) | `REVOKE UPDATE, DELETE, TRUNCATE … FROM admin_rw`; `REVOKE ALL … FROM hub_ro`; trigger `audit_log_append_only` BEFORE UPDATE OR DELETE (row) + BEFORE TRUNCATE (statement) → `RAISE EXCEPTION` (kể cả owner) |

Seed: không seed quota/audit; `mock:quota --seed` (§7) tạo usage mẫu.

## 4. Audit (khối B)

### 4.1 Ghi trong `configWrite` (M4-R10, cùng transaction)
| Bước | Chi tiết |
|---|---|
| `ConfigCall` | `{ctx, scope, actor: {userId}}` — mọi nơi gọi truyền `actor` (tenants đang truyền `{ctx, scope}` → sửa) |
| `ConfigSink` | thêm `audit(e: AuditInput)`; `AuditInput = {action, entity, entityId, entityName, tenantId, before, after, entityVersion?, summary?, snapshot?}` |
| `withConfigWrite` | sau `fn`: có event → bump (hạng 14) → `insertAuditRows(tx, rows, {actorId, v})` **một câu INSERT nhiều hàng**, `actor_username` = subselect `users.username` (actor luôn thấy được trong scope của mình). Lần thử bị retry 40P01 bỏ cả audit lẫn event |
| Bất biến (bật ở T1c, khi mọi module đã gọi `ch.audit`) | `events.length > 0 ⇔ audits.length > 0`, sai → `Error("audit/event mismatch")` (lỗi lập trình, test bắt module sót) |
| Tx không bump (users reset-password; 2FA — plan-cd) | `recordAudit(tx, e: AuditEntry)` (`AuditEntry` = `AuditInput` + `actorId`, đúng chữ ký plan-cd) câu cuối, `config_version` NULL. Import gọi `ch.audit` **một lần** — audit là tường minh, không cần `ConfigCall.audit: "manual"` |
| Không ghi | login, refresh, logout, tự đổi mật khẩu, khoá tạm do sai mật khẩu (Q6) |

Hàm thuần `lib/audit/audit.rules.ts` (qc test trước):
Chữ ký: [`plan-rules.md` §A1](plan-rules.md).

| Entity | Allowlist `before/after` (snake_case như DTO) | `entity_name` |
|---|---|---|
| tenant | key, name, active, max_concurrent_sub, version | key |
| user | username, display_name, email, role, locale, active, locked_by_tenant, must_change_password, version (+ `totp_enabled` của plan-cd) | username |
| group | key, name, description, version | key |
| grant | feature_id, subject_type, subject_id | feature key |
| entitlement | feature_id, tenant_id | feature key |
| feature | key, name, description, icon, status, command_ids, version | key |
| workflow | key, name, description, app_type, base_url, secret_id, input_schema, output_field, enabled, version | key |
| command | name, aliases, description, workflow_id, args, input_map, output, mode, timeout_s, enabled, feature_ids, version | `/name` |
| secret | name, note (**không** last4, không giá trị); `summary.value_changed` khi thay giá trị | name |
| quota | items[] (feature_id, feature_key, max_runs, max_tokens, max_usd) | tenant key |
| config (import, plan-cd §8.3) | from_config_version, added, updated, secrets_created, truncated | file_name |
| user_totp | enabled, backup_codes_left (không secret/mã) | username |

### 4.2 Điểm gọi theo thao tác (mỗi thao tác chỉ khi thực sự đổi hàng, cùng chỗ `ch.changed`)
| Module · thao tác | action · entity · tenant_id | snapshot |
|---|---|---|
| tenants POST / PATCH / lock / unlock | create, update, lock, unlock · tenant · id tenant (POST thêm 1 dòng create user cho admin đầu) | false (Q7) |
| users POST / PATCH / lock / unlock / reset | create, update, lock, unlock, update(`summary.password_reset`) · user · tenant user | false |
| groups POST / PATCH / DELETE | create, update, delete · group | **true** |
| groups members add/remove | update · group · `summary.added/removed` (username), before/after null | false |
| grants POST / DELETE / batch | grant, revoke · grant · `summary.subject_*`; batch: 1 dòng mỗi cặp đổi | false |
| entitlements PUT / DELETE | grant, revoke · entitlement · tenant được cấp | false |
| workflows, commands, features POST/PATCH/DELETE | create, update, delete · null tenant | **true** |
| secrets POST/PUT/PATCH/DELETE | create, update, delete · secret · null | false |
| quotas PUT | update · quota · tenant; bộ sau `normalizeQuotaItems` bằng bộ hiện tại → no-op (200, không bump/`updated_by`/audit/NOTIFY/evaluate) | **true**, `entity_version` = version tenant mới |
| restore | restore · entity gốc | true (để khôi phục tiếp được) |

Tổng quát: `entity_version` = version sau thay đổi (thực thể có version); delete: before = bản cuối, after null.

### 4.3 Đọc (M4-R12) — `modules/audit/audit.rules.ts`
Chữ ký: [`plan-rules.md` §A2](plan-rules.md).
Repo: một `withScope` (scope actor) — RLS + `where tenant_id` tường minh; `seq < cursor` `order by seq desc limit n+1`; `tenant_key` join tenants. Index: §3.3.

### 4.4 Khôi phục (M4-R13, Q7, Q8)
Một `configWrite(c, "audit.restore")`: đọc entry (RLS) → `canRestore` sai → `NOT_RESTORABLE` → adapter `<m>.restore.ts` `restore(tx, ch, entry, actor)`:

| Ca | Điều kiện (if/else, `restoreCheck`) | Hành động |
|---|---|---|
| action update/restore | thực thể không còn → `NOT_RESTORABLE`; `current.version ≠ entry.entity_version` → `VERSION_CONFLICT` (chỉ khôi phục thay đổi **mới nhất**) | ghi `before` như PATCH với `version = current.version` → version mới |
| action delete | thực thể còn (id) → `NOT_RESTORABLE` | INSERT lại cùng `id`, `version = before.version + 1` |
| mọi ca | `before` chạy lại **zod request schema + rules** của module; trùng name/key/alias → `NAME_TAKEN`; FK bắt buộc mất (workflow của command, secret của workflow) → `RESTORE_REF_MISSING`; `feature_ids`/`command_ids` đã mất bị bỏ khỏi tập (còn rỗng → luật module, vd `COMMAND_NEEDS_FEATURE`) | event + audit `restore` (`summary.restored_from`, `restored_version` = `entry.entity_version`) |
Phạm vi: group khôi phục không kèm member/grant; feature xoá không kèm entitlement/grant/quota; quota thay cả bộ (tenant version). Không khôi phục: user, tenant, secret, grant, entitlement (Q7); tenant_admin 403 (Q8).
Chữ ký: [`plan-rules.md` §A3](plan-rules.md).

## 5. Quota, cảnh báo, usage, overview (khối A)

### 5.1 Hàm thuần `modules/quotas/quotas.rules.ts` (chữ ký chốt cho qc)
Chữ ký: [`plan-rules.md` §A4](plan-rules.md).
Tiền so sánh bằng số nguyên micro-USD (`BigInt`) trong rules, không `parseFloat`.

### 5.2 Evaluator `evaluateTenant(ctx, tenantId)` (Q2b) — M4-R04, R05
| Bước | Tx | Việc |
|---|---|---|
| 1 | `withScope(tenant)` | đọc quotas; usage tháng: `group by feature_id` trên `usage_logs where tenant_id = $t and at >= from and at < to` (index `usage_logs_tenant_at_idx`); `evaluateQuota`; `alertsDue` với alerts tháng này → `INSERT … ON CONFLICT DO NOTHING`; **claim**: `UPDATE quota_alerts SET status='sending', claimed_at=now() WHERE tenant_id=$t AND (status='pending' OR (status='sending' AND claimed_at < now()-'5 min')) RETURNING`; đọc người nhận: tenant_admin active có email + locale |
| 2 | ngoài tx | `mailer.send` từng người nhận (một mail một người, không lộ email nhau), link `{ADMIN_WEB_URL}/usage` |
| 3 | `withScope(tenant)` | thành công → `sent`, `sent_at`; lỗi → `pending`, `attempts+1`, `last_error` = mã; `attempts ≥ 5` → `failed`. Không ném ra ngoài |
Gọi từ: sau commit `PUT quotas` (`void evaluateTenant(…).catch(log)`, không await; PUT no-op không gọi); `quotas.listener.ts` (LISTEN `quota_threshold`, gộp theo tenant 2 s, payload sai → log warn); GET `/admin/overview` & `/admin/quota-banner` của tenant_admin (chạy nền `void …catch(log)`, chặn lặp 60 s/tenant trong bộ nhớ). Không job định kỳ. Banner/overview tính trực tiếp từ `evaluateQuota`, không đọc `quota_alerts` (R06).

### 5.3 Mailer — theo plan-cd §9 (task TM)
`deps.mailer: Mailer` (`send` ném `MailError`), test dùng `createMemoryMailer()`; mỗi người nhận một lần `send` (không lộ email nhau). `MAIL_DISABLED` → giữ `pending` như lỗi gửi. plan-cd gọi evaluator là `evaluateQuota(ctx, tenantId)` → tên thật `evaluateTenant` (pure `evaluateQuota` ở plan-rules §A4).

### 5.4 Usage — `modules/usage/usage.rules.ts`
Chữ ký: [`plan-rules.md` §A5](plan-rules.md).
Service: một `withScope(actor, repeatable read, read only)`; tenant hợp lệ phải tồn tại trong scope (RLS tenants) — không thì 404. Mọi query `usage_logs` **luôn** có `tenant_id = $t` khi role tenant_admin (bảng Hub không RLS). Response parse bằng đúng schema role (strict) trước khi trả → test M4-AC03 quét chuỗi JSON/CSV không có `cost_usd`.

### 5.5 Overview
Tenant: một `withScope(tenant, repeatable read)` đếm users active, groups, usage tháng/tháng trước, quotas → `evaluateQuota`, 5 user chưa đăng nhập (index `users_tenant_role_active_idx` không phủ → chấp nhận, ≤ 5.000 hàng), 8 audit (`(tenant_id, seq desc)`). Platform: đếm bảng catalog/tenants/users, `runs_24h` (`count(distinct run_id) where at >= now()-24h`, index stub `usage_logs (at)`), `quota_tenants` = aggregate tháng theo `(tenant_id, feature_id)` join `tenant_quotas`, 8 audit (`seq desc`).

## 6. Thứ tự khoá (nối [plan M3 §6](../M3-permissions/plan.md#6-thứ-tự-khoá-toàn-cục-m1--m2--m3))

| Hạng | Tài nguyên | Khoá | Vì sao an toàn |
|---|---|---|---|
| 11a | `tenant_quotas` | DELETE/INSERT hàng của tenant (PUT/restore) | đã giữ tenant `NKU` (1) và `SHARE` mọi feature (cũ ∪ mới) id tăng (8) trước → feature DELETE (cascade 11a) chờ ở hạng 8, không vòng |
| 13a | `quota_alerts` | INSERT on conflict / UPDATE claim | tx evaluator không giữ khoá nào khác; `KEY SHARE` tenant/feature (E2) |
| 15 | `audit_log` | INSERT sau `cfg` (14) hoặc câu cuối tx không bump | không FK, unique chỉ PK uuid/identity → **không bao giờ chờ**; giữ đúng "sau cfg không chờ gì" |
| (2) | `users.updated_by`, `tenants.updated_by` | `KEY SHARE` lên hàng actor khi UPDATE | E2 (app không xoá user) |

| Thao tác | Chuỗi |
|---|---|
| Quota PUT | tenant `NKU` (1) → features `SHARE` id tăng (8) → delete + insert (11a) → `UPDATE tenants` version (1, đã giữ) → `cfg` (14) → audit (15) |
| Restore | đúng chuỗi PATCH/POST của module (M3 §6.2) → `cfg` → audit (15); quota = Quota PUT |
| Evaluator | (11a đọc, không khoá) → `quota_alerts` (13a) |
| Mọi thao tác M1–M3 | giữ nguyên + audit (15) cuối |
Ca xen kẽ thêm vào `lib/lock-order.int.test.ts`: Quota PUT ∥ Feature DELETE cùng feature; Restore command ∥ Command PATCH.

## 7. Giả lập, env, hiệu năng

| Mục | Chi tiết |
|---|---|
| `bun run mock:quota -- --tenant acme --runs 1001 --quota 1000 [--feature dich] [--seed]` | dùng `DATABASE_URL` (owner; `admin_rw` không INSERT được `hub.usage_logs`); đặt quota nếu có `--quota`; ghi N run (mỗi run 1 hàng, `billable_usd` 0.10, `cost_usd` 0.06), hàng thứ > quota mang `overage=true` (vai Hub, R07); `--seed`: 60 ngày dữ liệu mẫu 3 feature + 1 hàng `feature_id` null + 1 hàng `billable_usd` null; cuối cùng `NOTIFY quota_threshold` |
| Proc AL10 (`quota-alerts-proc.int`) | server con kế thừa `...process.env` như M2 secrets-proc, cổng 3094, `SMTP_URL` Mailpit |
| Env mới | `ADMIN_WEB_URL` (link trong mail, mặc định `http://localhost:3000`); `SMTP_URL` đã có (plan-cd) |
| Perf (`*.perf.int.test.ts`, không chặn) | `usage.perf`: 1 tháng, 200k hàng 1 tenant < 2 s (ADM-NFR-03); `audit.perf`: 50k dòng, list p95 < 300 ms; quota PUT < 300 ms |

## 8. Test của backend (ngoài acceptance qc)
| File | Ca |
|---|---|
| `lib/audit/audit.rules.test.ts` | allowlist từng entity; khoá cấm ở cấp 1 sau allowlist → ném (assert phòng thủ, không có test); `input_schema`/`input_map`/`args`/`output` chứa `password` → không ném |
| `packages/db/src/ops-rls.int.test.ts` | RLS 3 bảng (tenant A không thấy B, NULL chỉ platform); `admin_rw` UPDATE/DELETE audit → lỗi quyền; trigger chặn owner; `hub_ro` đọc quotas, không đọc audit/alerts |
| `lib/config/config-write.int.test.ts` (sửa) | audit cùng tx; retry 40P01 không nhân đôi audit; bất biến mismatch |
| `quotas.rules.test.ts`, `usage.rules.test.ts`, `audit.rules.test.ts` | ranh giới tháng VN (30/09 23:59:59+07 vs 01/10 00:00+07), pct nhiều chiều, alertsDue, CSV injection/BOM |
| `quotas.evaluator.int.test.ts` | chạy 2 lần song song → 1 mail; mailer lỗi → `pending` rồi gửi lại |

## 9. Rủi ro
| Rủi ro | Giảm |
|---|---|
| Sót audit ở module cũ (TD #9, #20) | bất biến event⇔audit (T1c) + M4-AC04 |
| Rò `cost_usd` cho tenant_admin | schema strict theo role + `stripCost` + test quét chuỗi |
| `usage_logs` không RLS → rò tenant | `resolveUsageTenant` + `tenant_id` bắt buộc trong repo; AC-A09 |
| Mail gửi trong tx bị retry | mail luôn sau commit, claim `sending` (TD #13) |
| `updated_by` null khi tenant_admin xem bản do platform sửa (RLS users) | như M3 groups; FE dùng câu không `{user}` |

## 10. Task BUILD (A + B)
Nguồn duy nhất: [`tasks.md`](tasks.md) (T0–T6, đã áp readiness lần 1: T6 rủi ro `cao`, lệnh int, file test cụ thể). Thứ tự: T0 → T0b → T0m → T1 → T1b → T1c → T2 → T3 → T2b → T4 → T5 → T6.
