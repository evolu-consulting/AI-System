# Plan · M1-foundation-identity (backend)

Tác giả: backend-lead · 2026-10-01 · Phần frontend: [`plan-frontend.md`](plan-frontend.md) (không lặp lại).
Contract (endpoint, schema từng trường, mã lỗi) và bảng dữ liệu là **nguồn chính ở `spec.md` §3–§4**; file này chỉ thêm phần hiện thực: file, SQL RLS, chữ ký hàm thuần cho qc, luồng service, test.
Chỉ dùng symbol đã thấy trong code thật (Grep 2026-10-01): `createApp`, `AppConfig`, `AppError`, `toErrorBody`, `logger`, `ErrorResponseSchema`, `BASE_ERROR_CODES`, `createDb`, `Db`, `runMigrations`, `loadDbEnv`, `resetTestDb`, `admin` (`pgSchema`). API thư viện ngoài (`jose`, `drizzle-orm` 0.45.3 `pgSchema().table/check/index/uniqueIndex`, `postgres` 3.4.9, `Bun.password`, `Bun.randomUUIDv7`) phải đối chiếu `node_modules/<pkg>` (`.d.ts`) trước khi gọi.

## 1. Phiên bản

| Package | Bản | Dùng ở | Ghi chú |
|---|---|---|---|
| jose | 6.2.12 | `apps/admin-api` (dependencies) | Accepted ADR-0001; `SignJWT`, `jwtVerify`, `importPKCS8`, `importSPKI` (alg `EdDSA`) |
| zod | 4.6.5 | thêm vào `apps/admin-web` (frontend-lead) | đã có |

Không cài `@hono/zod-validator` (spec §9). Không thư viện khác → không ADR backend mới.

## 2. File

| File | Tạo/Sửa | Nội dung | Task |
|---|---|---|---|
| `packages/contracts/src/common.ts` | Tạo | hằng/regex (`COMPANY_KEY_RE`…), `RoleSchema`, `LocaleSchema`, `EntityStatusSchema`, `IsoDateTime`, `UuidSchema`, `ListQueryBase`, `listResponseSchema(item)`, `ErrorCode`, `API_ERRORS`, `ValidationErrorDetailsSchema`, `LastAdminDetailsSchema`, `TempLockedDetailsSchema`, `versionConflictDetailsSchema(entity)` (= `{current: entity, updated_at: IsoDateTime}`, strict) | T1 |
| `packages/contracts/src/auth.ts` | Tạo | `LoginRequestSchema`, `LoginResponseSchema` (discriminatedUnion `status`), `TokenGrantSchema`, `PasswordChangeRequiredSchema`, `RefreshRequestSchema`, `RefreshResponseSchema` (= `TokenGrantSchema`), `ChangePasswordRequestSchema` (union 2 dạng strict), `MeSchema`, `MeUpdateRequestSchema`, `X_CLIENT_HEADER = "X-Client"`, `REFRESH_COOKIE = "ai_rt"` | T1 |
| `packages/contracts/src/tenants.ts` | Tạo | `TenantSchema`, `TenantDetailSchema`, `TenantListQuerySchema`, `TenantListResponseSchema`, `TenantCreateRequestSchema`, `TenantCreateResponseSchema`, `TenantUpdateRequestSchema` | T1 |
| `packages/contracts/src/users.ts` | Tạo | `UserSchema`, `UserListQuerySchema`, `UserListResponseSchema`, `UserCreateRequestSchema`, `UserCreateResponseSchema`, `UserUpdateRequestSchema`, `TempPasswordResponseSchema` | T1 |
| `packages/contracts/src/{common,auth,tenants,users}.test.ts` | Tạo | parse hợp lệ/không hợp lệ từng trường, strict, union `status`, `API_ERRORS` đủ mã của spec §3 | T1 |
| `packages/contracts/src/index.ts`, `errors.ts` | Sửa | export mới; `BASE_ERROR_CODES` giữ nguyên (M0) | T1 |
| `packages/db/src/schema/admin.ts` | Sửa | 4 bảng Drizzle theo spec §4 (CHECK, index, unique có `WHERE`) | T2 |
| `packages/db/migrations/0001_admin_identity.sql` (+ `meta/`) | Sinh | `bun run db:generate` | T2 |
| `packages/db/migrations/0002_admin_rls.sql` (+ `meta/`) | Tạo (`drizzle-kit generate --custom --name admin_rls`) | §3 dưới | T2 |
| `packages/db/migrations-dev/0001_admin_api_login_dev.sql` (+ `meta/_journal.json`) | Tạo | `ALTER ROLE admin_api WITH LOGIN PASSWORD 'admin_api_dev_pw';` | T2 |
| `packages/db/src/scope.ts` | Tạo | `withScope`, `DbScope`, `Tx` (§3.4) | T2 |
| `packages/db/src/rls.int.test.ts` | Tạo | RLS đúng như §3.5 | T2 |
| `packages/db/src/password.ts` | Tạo | `PASSWORD_HASH_OPTIONS`, `hashPassword(pw)`, `verifyPassword(pw, hash)` (bọc `Bun.password`) — dùng chung seed + admin-api | T3 |
| `packages/db/src/seed.ts` (+ `seed.int.test.ts`, `seed-env.test.ts`) | Tạo | `runSeed`, `loadSeedEnv`, CLI | T3 |
| `packages/db/src/index.ts`, `package.json` | Sửa | export `withScope`, `password`; `exports["./seed"]` | T2–T3 |
| `package.json` (gốc) | Sửa | `"db:seed": "bun --env-file=.env.local packages/db/src/seed.ts"`, `"db:setup": "bun run db:migrate && bun run db:seed"` | T3 |
| `.env.example`, `.github/workflows/ci.yml` | Sửa | env mới spec §7; `ADMIN_API_URL=http://localhost:3001`, `PUBLIC_CHAT_APP_URL=` (theo plan-frontend §9.11); CI: migrate + seed trước E2E | T3 |
| `apps/admin-api/src/config/env.ts` (+ test) | Sửa | thêm `ADMIN_API_DATABASE_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KID` | T4 |
| `apps/admin-api/src/lib/jwt.ts` (+ test) | Tạo | `loadJwtKeys`, `signAccessToken`, `verifyAccessToken`, `signChangeToken`, `verifyChangeToken` | T4 |
| `apps/admin-api/src/lib/http.ts` (+ test) | Tạo | `parseJson(c, schema)`, `parseQuery(c, schema)`, `parseIdParam(c)` (uuid sai → `AppError NOT_FOUND`), `clientKind(c)` | T4 |
| `apps/admin-api/src/lib/cookie.ts` (+ test) | Tạo | `setRefreshCookie`, `clearRefreshCookie`, `readRefreshCookie` (dùng `hono/cookie`) | T4 |
| `apps/admin-api/src/lib/errors.ts` | Sửa | thêm `appError(code: ErrorCode, details?)` lấy status từ `API_ERRORS`, message EN mặc định | T4 |
| `apps/admin-api/src/modules/auth/{README.md,auth.routes.ts,auth.service.ts,auth.repo.ts,auth.rules.ts,auth.errors.ts,auth.rules.test.ts,auth.service.int.test.ts}` | Tạo | login, refresh, logout, change-password (bắt buộc) | T4 |
| `apps/admin-api/src/lib/auth-middleware.ts` (+ int test) | Tạo | `requireAuth`, `requireRole(...roles)`; đặt `c.var.actor`, `c.var.scope` | T5 |
| `apps/admin-api/src/lib/db-guard.ts` (+ int test) | Tạo | `assertSafeDbRole(db)` (§3.3) | T5 |
| `apps/admin-api/src/modules/auth/auth.me.routes.ts` | Tạo | `GET/PATCH /auth/me`, change-password chế độ tự đổi (cần Bearer) | T5 |
| `apps/admin-api/src/app.ts`, `server.ts` | Sửa | `createApp(cfg, deps?)` (§6.1); server: env → keys → db (`ADMIN_API_DATABASE_URL`) → `assertSafeDbRole` → dummy hash → serve | T5 |
| `apps/admin-api/src/modules/tenants/{README.md,tenants.routes.ts,tenants.service.ts,tenants.repo.ts,tenants.rules.ts,tenants.errors.ts,*.test.ts}` | Tạo | FR-60, 61 | T6 |
| `apps/admin-api/src/modules/users/{README.md,users.routes.ts,users.service.ts,users.repo.ts,users.rules.ts,users.errors.ts,*.test.ts,users.perf.int.test.ts}` | Tạo | FR-04, 05, 63, BR-05/08/09 | T7 |
| `apps/admin-api/package.json` | Sửa | `jose`, `@ai/db` | T4 |

Tạo tenant (tenants module) cần tạo user đầu tiên → `tenants.service` gọi `users.service.createFirstAdmin(tx, …)` (không import `users.repo`, CONVENTIONS §2). Sinh mật khẩu tạm dùng `generateTempPassword` ở `auth.rules.ts` qua `auth.service`/`users.service` export lại — hàm thuần, import trực tiếp `rules` được.

## 3. DB: role, RLS, hàm, scope

### 3.1 `0002_admin_rls.sql` (custom, nguyên văn ý; BUILD giữ đúng câu lệnh)
```sql
-- ADM-NFR-07 · RLS + role đăng nhập admin_api (spec M1 §4).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin_api') THEN
    CREATE ROLE admin_api NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
--> statement-breakpoint
ALTER ROLE admin_api NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
--> statement-breakpoint
GRANT admin_rw TO admin_api;
--> statement-breakpoint
ALTER TABLE admin.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.refresh_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenants_admin_rw ON admin.tenants FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY users_admin_rw ON admin.users FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY refresh_tokens_admin_rw ON admin.refresh_tokens FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY tenants_hub_ro ON admin.tenants FOR SELECT TO hub_ro USING (true);
CREATE POLICY users_hub_ro ON admin.users FOR SELECT TO hub_ro USING (true);
--> statement-breakpoint
REVOKE ALL ON admin.refresh_tokens FROM hub_ro;
REVOKE SELECT ON admin.users FROM hub_ro;
GRANT SELECT (id, tenant_id, username, display_name, email, role, locale, active,
              locked_by_tenant, created_at, updated_at, version) ON admin.users TO hub_ro;
--> statement-breakpoint
CREATE FUNCTION admin.tenant_id_by_key(p_key text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT t.id FROM admin.tenants t WHERE t.key = p_key $$;
CREATE FUNCTION admin.tenant_id_by_refresh_hash(p_hash bytea) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  AS $$ SELECT r.tenant_id FROM admin.refresh_tokens r WHERE r.token_hash = p_hash $$;
REVOKE ALL ON FUNCTION admin.tenant_id_by_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin.tenant_id_by_refresh_hash(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin.tenant_id_by_key(text) TO admin_rw;
GRANT EXECUTE ON FUNCTION admin.tenant_id_by_refresh_hash(bytea) TO admin_rw;
```
- Mỗi lệnh một `--> statement-breakpoint` (drizzle migrator). Hàm do owner migration sở hữu; owner không bị RLS (không `FORCE`) nên hàm đọc được mọi hàng, nhưng chỉ trả `uuid`.
- Vì sao biểu thức inline thay vì hàm SQL: planner thấy so sánh `tenant_id = const` → dùng index `(tenant_id, …)`.
- `features` không bật RLS; `admin_rw` có SELECT/INSERT/UPDATE/DELETE theo default privileges M0 (ghi chỉ qua API M2, kiểm role ở app).
- Production: owner migration cần `CREATEROLE` (M0 đã tạo role trong migration). Vận hành chạy `ALTER ROLE admin_api LOGIN PASSWORD '<secret>'` một lần → ghi PRODUCTION-NOTES (docs-architect).

### 3.2 Dev/test login
`migrations-dev/0001_admin_api_login_dev.sql`: `ALTER ROLE admin_api WITH LOGIN PASSWORD 'admin_api_dev_pw';` — không chạy ở production (`runMigrations` bỏ `migrations-dev` khi `appEnv=production`). Role ở mức cluster nên dùng chung cho `ai_system` và `ai_system_test`; `resetTestDb` không xoá role (chủ ý, như M0).

### 3.3 Chặn chạy app bằng role nguy hiểm
`assertSafeDbRole(db): Promise<void>` chạy lúc khởi động:
```sql
select r.rolsuper, r.rolbypassrls,
       exists(select 1 from pg_tables where schemaname = 'admin' and tableowner = current_user) as owns
from pg_roles r where r.rolname = current_user
```
Bất kỳ cờ nào `true` → ném lỗi "DB role của admin-api không được là superuser/BYPASSRLS/owner — dùng ADMIN_API_DATABASE_URL (admin_api)" → `server.ts` log + exit 1. Test: gọi với kết nối owner → ném; với `admin_api` → qua.

### 3.4 Ngữ cảnh transaction (`packages/db/src/scope.ts`)
```ts
export type DbScope = { kind: "tenant"; tenantId: string } | { kind: "platform" };
export type Tx = Parameters<Parameters<PostgresJsDatabase["transaction"]>[0]>[0];
/** Mở transaction, đặt app.scope/app.tenant_id (transaction-local) rồi chạy fn. */
export function withScope<T>(db: Db, scope: DbScope, fn: (tx: Tx) => Promise<T>): Promise<T>;
/** Đổi scope trong cùng transaction (middleware: tenant → platform sau khi đọc role). */
export function setScope(tx: Tx, scope: DbScope): Promise<void>;
```
Câu lệnh: `select set_config('app.scope', $1, true), set_config('app.tenant_id', $2, true)` với `$2 = ''` khi `platform`. Mỗi request có DB = đúng một `withScope`; route không bao giờ dùng `db` trần. Gọi hàm SECURITY DEFINER cũng trong `withScope` (scope tạm `tenant` với tenantId = nil uuid `00000000-0000-0000-0000-000000000000` → không thấy hàng nào cho tới khi `setScope`).

### 3.5 Test RLS (`packages/db/src/rls.int.test.ts`, backend; qc có M1-AC02 riêng)
Trên `TEST_DATABASE_URL`: reset → migrate(test) → owner chèn tenant `acme`, `globex` + mỗi tenant 2 user + 1 refresh token. Kết nối `TEST_ADMIN_API_DATABASE_URL`:
1. Không đặt scope → `select count(*) from admin.users` = 0; `admin.tenants` = 0.
2. `scope=tenant, acme` → chỉ user acme; `update admin.users set display_name='x' where tenant_id = <globex>` → 0 hàng; `insert` user với `tenant_id=globex` → lỗi `42501` (WITH CHECK).
3. `scope=platform` → thấy cả hai.
4. `admin.tenant_id_by_key('acme')` trả id; `select admin.tenant_id_by_key` với role `hub_ro` (SET ROLE từ owner) → lỗi quyền.
5. `SET ROLE hub_ro` từ owner: `select password_hash from admin.users` → `42501`; `select id from admin.users` thấy cả 2 tenant; `select * from admin.refresh_tokens` → `42501`.
6. Hai transaction liên tiếp trên cùng kết nối pool: transaction 2 không đặt scope → 0 hàng (không rò).
7. `admin_api`: `rolsuper=false`, `rolbypassrls=false`, `pg_has_role('admin_api','admin_rw','member')=true`.

## 4. Hàm thuần (`*.rules.ts`) — chữ ký chốt để qc viết test trước

Không import I/O; thời gian và ngẫu nhiên truyền vào.

```ts
// apps/admin-api/src/modules/auth/auth.rules.ts   [ADM-FR-01, 02, 06, 07, NFR-01]
export const MAX_LOGIN_ATTEMPTS = 5;
export const TEMP_LOCK_MS = 15 * 60_000;
export const ACCESS_TOKEN_TTL_S = 900;
export const REFRESH_TOKEN_TTL_S = 2_592_000;      // 30 ngày, tuyệt đối theo chuỗi
export const CHANGE_TOKEN_TTL_S = 300;
export const REFRESH_GRACE_MS = 10_000;
export type RevokeReason = "rotated" | "reuse" | "logout" | "logout_all" | "user_locked"
  | "tenant_locked" | "password_changed" | "password_reset";

export function normalizeLoginId(raw: string): string;                 // trim().toLowerCase()
export function isTempLocked(lockedUntil: Date | null, now: Date): boolean;   // lockedUntil > now
/** Trạng thái bộ đếm trước khi verify: khoá đã hết hạn → về 0. */
export function clearExpiredLock(s: { failedLogins: number; lockedUntil: Date | null }, now: Date):
  { failedLogins: number; lockedUntil: Date | null };
/** Sau một lần sai: +1; chạm MAX → { 0, now+15' }. */
export function afterFailedLogin(failedLogins: number, now: Date):
  { failedLogins: number; lockedUntil: Date | null };
export function canSignIn(u: { active: boolean; lockedByTenant: boolean }, tenantActive: boolean): boolean;
export type LoginStep = "temp_locked" | "verify";
export type PostVerifyOutcome = "account_locked" | "password_change_required" | "authenticated";
export function outcomeAfterPasswordOk(
  u: { active: boolean; lockedByTenant: boolean; mustChangePassword: boolean }, tenantActive: boolean,
): PostVerifyOutcome;
export type RefreshVerdict = "valid" | "expired" | "superseded" | "reuse";
export function classifyRefresh(
  t: { revokedAt: Date | null; revokedReason: RevokeReason | null; expiresAt: Date }, now: Date,
): RefreshVerdict;   // revoked & reason=rotated & now-revokedAt ≤ GRACE → superseded; revoked khác → reuse; expiresAt ≤ now → expired
export function isAcceptableNewPassword(pw: string): boolean;          // 10 ≤ length ≤ 128
export const TEMP_PASSWORD_ALPHABET: string;                           // A–Z a–z 0–9 (62)
/** 16 ký tự, lấy mẫu loại bỏ byte ≥ 248 (= 4·62) để không lệch. */
export function generateTempPassword(randomBytes: (n: number) => Uint8Array): string;
export function changeTokenMatches(pwcClaim: number, passwordChangedAt: Date): boolean;  // === getTime()
```

```ts
// apps/admin-api/src/modules/users/users.rules.ts   [ADM-FR-04, 05, 63, BR-05, 08, 09]
export type Role = "platform_admin" | "tenant_admin" | "member";
export type Actor = { userId: string; tenantId: string; role: Role };
export type RuleError = { code: ErrorCode; details?: unknown };   // ErrorCode từ @ai/contracts
export function isAdminRole(role: Role): boolean;                 // platform_admin | tenant_admin
export function canManageUsers(actor: Actor): boolean;            // role ≠ member
/** tenant_admin: luôn tenant mình; platform: query ?? null (null = mọi tenant, chỉ hợp lệ khi đọc). */
export function resolveTenantScope(actor: Actor, queryTenantId: string | undefined, op: "read" | "write"):
  { tenantId: string | null } | RuleError;                        // write + platform + thiếu → TENANT_REQUIRED
export function canSeeUser(actor: Actor, target: { tenantId: string }): boolean;  // false → 404
export function checkRoleAssignment(actor: Actor, tenantIsPlatform: boolean, role: Role): RuleError | null;
  // platform tenant ⇔ role platform_admin; tenant_admin không gán platform_admin → ROLE_NOT_ALLOWED
export function checkRoleChange(actor: Actor, target: { id: string; role: Role }, next: Role): RuleError | null;
  // thứ tự (G2): actor.userId=target.id & next≠target.role → SELF_ACTION_FORBIDDEN; rồi target.role=platform_admin & next≠ → ROLE_NOT_ALLOWED
export function checkSelfAction(actor: Actor, targetId: string, action: "lock" | "reset_password"): RuleError | null;
export function isEmailRequired(role: Role): boolean;             // tenant_admin
/** BR-08: thay đổi làm target thôi là admin đang hoạt động và không còn admin cùng phạm vi → LAST_ADMIN {scope}. */
export function checkLastAdmin(
  target: { role: Role; active: boolean },
  change: { active?: boolean; role?: Role },
  otherActiveAdminsInScope: number,
): RuleError | null;
export function userStatus(u: { active: boolean; lockedByTenant: boolean }): "active" | "locked";
/** Trường nào đổi thì tăng version (spec §3 "version chỉ tăng khi…"). */
export function bumpsVersion(changedFields: readonly string[]): boolean;
```

```ts
// apps/admin-api/src/modules/tenants/tenants.rules.ts   [ADM-FR-60, 61]
export const PLATFORM_TENANT_KEY = "platform";
export function canManageTenants(actor: Actor): boolean;          // chỉ platform_admin
export function checkTenantLock(tenant: { key: string }): RuleError | null;   // platform → PLATFORM_TENANT_LOCKED
export function tenantStatus(t: { active: boolean }): "active" | "locked";
```

## 5. Luồng service (transaction, query)

Ký hiệu: `W(scope){…}` = một `withScope`. Mọi `UPDATE … WHERE id=$ AND version=$v RETURNING *`; 0 hàng → đọc lại: không có → `NOT_FOUND`, có → `VERSION_CONFLICT {current, updated_at}` (`details.updated_at = current.updated_at`; không có `updated_by` ở M1).

**Login** (`auth.service.login`):
1. `W(nil){ tid = tenant_id_by_key(key); if tid: setScope(tenant tid); tenant = select; user = select by (tid, username) }`.
2. Không có tenant/user → `verifyPassword(pw, dummyHash)` → `INVALID_CREDENTIALS`.
3. `isTempLocked` → `TEMP_LOCKED {until}` (không verify).
4. `verifyPassword` (ngoài transaction).
5. Sai: `W(tenant){ update users set failed_logins=…, locked_until=… where id }` với giá trị từ `afterFailedLogin(clearExpiredLock(...).failedLogins)` — dùng `failed_logins = CASE WHEN locked_until <= now() THEN 1 ELSE failed_logins + 1 END` trong SQL để an toàn khi song song, rồi đặt `locked_until` khi đạt 5 trong cùng câu; → `INVALID_CREDENTIALS`.
6. Đúng: `outcomeAfterPasswordOk` → `account_locked` (đếm về 0, 403) / `password_change_required` (đếm về 0, ký change_token) / `authenticated`: `W(tenant){ update users set failed_logins=0, locked_until=null, last_login_at=now(); insert refresh_tokens(id=v7, family_id=id, token_hash, client, user_agent, expires_at=now+30d) }`, ký access token (`sid=family_id`).

**Refresh**: `hash = sha256(token)` → `W(nil){ tid = tenant_id_by_refresh_hash(hash); setScope(tenant tid); row = select token + user + tenant }` → `classifyRefresh`: `valid` & `canSignIn` → `update … set revoked_at=now(), revoked_reason='rotated', replaced_by=$new where id=$ and revoked_at is null` (0 hàng = thua race → `REFRESH_SUPERSEDED`) + insert token mới (cùng `family_id`, `expires_at` kế thừa); `superseded` → 401 `REFRESH_SUPERSEDED`; `reuse` → `update … set revoked_at=now(), revoked_reason='reuse' where family_id=$ and revoked_at is null` → `INVALID_REFRESH_TOKEN`; `expired`/không có/user không đăng nhập được → `INVALID_REFRESH_TOKEN`.

**Logout**: như refresh tới bước tìm hàng; có và chưa thu hồi → `revoked_reason='logout'`; luôn 204.

**Change-password bắt buộc**: `verifyChangeToken` (aud riêng, exp) → `W(tenant tid){ user by sub }` → `changeTokenMatches` sai → `INVALID_CHANGE_TOKEN`; `canSignIn` sai → `ACCOUNT_LOCKED`; `verifyPassword(new, hash)` đúng → `PASSWORD_UNCHANGED`; `W{ update password_hash, must_change_password=false, password_changed_at=now(), version+1; revoke mọi token user ('password_changed'); insert token mới }` → `TokenGrant`.
**Change-password tự đổi**: actor từ middleware; `isTempLocked` → 423; verify current sai → bộ đếm như login → `INVALID_CURRENT_PASSWORD`; new = current → `PASSWORD_UNCHANGED`; update + revoke token `family_id <> sid` ('password_changed') → 204.

**Middleware** (`requireAuth`): `verifyAccessToken` (alg EdDSA, `iss=admin`, `aud=ai-system`) → mở `withScope(tenant tid)` cho cả request (`c.set("tx")` không dùng; thay vào đó service nhận `scope` và tự mở `withScope` — một transaction/hành động) → đọc `users ⋈ tenants` theo `sub` → không có / `!canSignIn` → 401 `UNAUTHORIZED`; `actor = {userId, tenantId, role (từ DB)}`; `scope = role==='platform_admin' && tenant.key==='platform' ? platform : tenant`. `requireRole('platform_admin')` cho `/admin/tenants*`; `requireRole('platform_admin','tenant_admin')` cho `/admin/users*` → 403 `FORBIDDEN`.

**Tạo tenant**: `W(platform){ insert tenant (unique key → KEY_TAKEN qua mã PG 23505 + tên constraint); users.service.createFirstAdmin(tx, {tenantId, ...first_admin, role:'tenant_admin'}) }` → mật khẩu tạm sinh trước transaction (hash ngoài transaction).

**Khoá tenant**: `checkTenantLock` → `W(platform){ select tenant for update; if active: update tenants set active=false, version+1; update users set locked_by_tenant=true, version+1 where tenant_id=$ and active and not locked_by_tenant; update refresh_tokens set revoked_at=now(), revoked_reason='tenant_locked' where tenant_id=$ and revoked_at is null }`.
**Mở khoá**: `update tenants set active=true…; update users set locked_by_tenant=false, version+1 where tenant_id=$ and locked_by_tenant`.

**Users**: list = một query `select … , count(*) over()` có `limit/offset` + một query `counts` (`count(*) filter (where …)`) cùng điều kiện trừ `status`. Lock/demote: `W{ select tenants for update (tenant của target); đếm admin khác (index users_tenant_role_active_idx; platform: `role='platform_admin' and active`; tenant: `tenant_id=$ and role='tenant_admin' and active` — **không** xét `locked_by_tenant` hay `tenants.active`, áp cho mọi tenant kể cả đang khoá, chốt ở Gate M1) ; checkLastAdmin; update; nếu lock: revoke token user ('user_locked') }`. Reset: `checkSelfAction` → sinh + hash ngoài transaction → `update password_hash, must_change_password=true, password_changed_at=now(), failed_logins=0, locked_until=null, version+1; revoke token ('password_reset')`. Unlock: `active=true, failed_logins=0, locked_until=null, version+1`. Logout-all: revoke ('logout_all'). Mã PG 23505 theo tên constraint → `USERNAME_TAKEN` (`users_tenant_username_uq`), `EMAIL_TAKEN` (`users_tenant_email_uq`), `KEY_TAKEN` (`tenants_key_uq`).

## 6. App

### 6.1 `createApp(cfg, deps?)`
```ts
export type AppDeps = { db: Db; keys: JwtKeys; appEnv: AppEnv; dummyHash: string; now?: () => Date };
export function createApp(cfg: AppConfig, deps?: AppDeps): Hono<Vars>;
```
`deps` vắng → chỉ `/health` (giữ nguyên test khoá M0 `createApp({version, corsOrigins})`). Có `deps` → mount `/auth`, `/admin/tenants`, `/admin/users`. `now` cho test khoá tạm (mặc định `() => new Date()`); hạn khoá trong SQL dùng `$now` truyền vào thay `now()` để test điều khiển được.
CORS thêm `allowHeaders: ["Content-Type", "Authorization", "X-Client", "X-Request-Id"]`.
Log: không bao giờ log body, header `Authorization`, `Cookie`, `Set-Cookie`; log `tenant_id` + `user_id` của actor khi có.

### 6.2 Hướng dẫn cho qc (test acceptance M1)
- Dựng app in-process: `createApp(cfg, { db: createDb(TEST_ADMIN_API_DATABASE_URL), keys: await loadJwtKeys(env), appEnv: "test", dummyHash, now })` sau `resetTestDb` + `runMigrations` + `runSeed` (owner `TEST_DATABASE_URL`). Khoá JWT test: sinh bằng `generateKeyPairSync("ed25519")` trong fixture hoặc đọc `.env.local`.
- Kiểm cookie: header `set-cookie` chứa `ai_rt=`, `HttpOnly`, `SameSite=Strict`, `Path=/auth`; không có `Secure` khi `appEnv≠production`.
- **Test khoá M0 phải cập nhật** (qc, Q2): `tests/acceptance/ADM-NFR-06/migrate.int.test.ts` đang kỳ vọng `{main:1, dev:1}`, danh sách bảng `admin`+`hub` chỉ 3 bảng hub, production `[]` — M1 thêm 2 migration chính + 1 dev nên sẽ đỏ. Đề xuất: kỳ vọng `{main:3, dev:2}`, bảng gồm thêm `admin.features`, `admin.refresh_tokens`, `admin.tenants`, `admin.users`; production chỉ 4 bảng admin. Đây là thay đổi phạm vi dự kiến, không phải tranh chấp.

## 7. Seed (`packages/db/src/seed.ts`)
```ts
export const SeedEnvSchema: z.ZodObject<…>;   // DATABASE_URL, APP_ENV, SEED_ADMIN_USERNAME (USERNAME_RE), SEED_ADMIN_PASSWORD (10–128)
export function loadSeedEnv(src: Record<string, string | undefined>): SeedEnv;   // lỗi chỉ nêu tên biến
export async function runSeed(opts: { url: string; adminUsername: string; adminPassword: string }):
  Promise<{ tenant: "created" | "exists"; feature: "created" | "exists"; admin: "created" | "exists" }>;
```
Một transaction (owner): `insert tenants (key='platform', name='Nền tảng') on conflict (key) do nothing returning id` (không trả → select id) → `insert features (key='core', name='{"vi":"Cơ bản","en":"Core"}', status='on') on conflict do nothing` → kiểm user `(platform, username)` tồn tại; chưa có mới hash và `insert … role='platform_admin', display_name='Platform Admin', must_change_password=false, locale='vi' on conflict do nothing`. CLI in `db:seed OK: tenant created|exists, feature …, admin …`; lỗi → exit 1 (như `migrate.ts` `describeError`).

## 8. Test của backend (ngoài acceptance của qc)
| File | Loại | Phủ |
|---|---|---|
| `packages/contracts/src/*.test.ts` | unit | §2 |
| `packages/db/src/rls.int.test.ts` | int | §3.5 |
| `packages/db/src/seed.int.test.ts` | int | 2 lần → 1/1/1 hàng, hash không đổi; env thiếu → lỗi nêu tên |
| `apps/admin-api/src/modules/auth/auth.rules.test.ts` | unit | mọi hàm §4 auth (biên 4/5/6 lần, hết khoá đúng mốc, grace 10 s, mật khẩu tạm 16 ký tự/không lệch với RNG giả) |
| `apps/admin-api/src/modules/auth/auth.service.int.test.ts` | int | login 6 nhánh, refresh xoay/reuse/superseded/song song, logout idempotent, change-password 2 chế độ |
| `apps/admin-api/src/lib/{jwt,http,cookie}.test.ts`, `auth-middleware.int.test.ts`, `db-guard.int.test.ts` | unit/int | claim, aud tách, token hết hạn, uuid sai → 404, guard role |
| `apps/admin-api/src/modules/tenants/*.test.ts` | unit + int | rules; tạo một transaction (lỗi giữa chừng → không có gì), lock/unlock `locked_by_tenant`, 409 version |
| `apps/admin-api/src/modules/users/*.test.ts` | unit + int | rules; BR-08 song song (2 request khoá 2 tenant_admin cuối cùng lúc → đúng 1 thành công); BR-09 404 cả GET/PATCH/POST |
| `apps/admin-api/src/modules/users/users.perf.int.test.ts` | int | ngân sách spec §6 |

## 9. Rủi ro
- **drizzle-kit + RLS:** policy/hàm nằm trong migration custom, không khai trong schema Drizzle → `db:generate` lần sau không sinh lệnh xoá policy (drizzle-kit chỉ diff thứ có trong snapshot). Kiểm ở T2: chạy `db:generate` lần 2 → "No schema changes".
- **`set_config` + pool:** transaction-local (`true`) nên hết transaction là mất; test §3.5 bước 6 khoá điều này.
- **`ALTER ROLE … PASSWORD` trong migration dev** lộ mật khẩu dev trong log Postgres — chỉ dev/test, giống `ai_dev_pw` trong compose.
- **Hiệu năng argon2 trong test:** mỗi user tạo ~22 ms; fixture qc nên hash một lần rồi chèn cùng hash cho nhiều user.
- **CI:** thứ tự bước đổi (migrate + seed trước e2e); `playwright.config.ts` `webServer` khởi động admin-api do qc/frontend-lead (plan-frontend §9.11).

## 10. Trả lời lỗ hổng test-plan (qc §10, 2026-10-01)
- **G2:** chấp nhận. `checkRoleChange` kiểm `SELF_ACTION_FORBIDDEN` **trước** `ROLE_NOT_ALLOWED` (M1-R11/BR-08). platform_admin tự đổi role mình → 403 `SELF_ACTION_FORBIDDEN`; người khác đổi role của platform_admin → 400 `ROLE_NOT_ALLOWED`.
- **G3:** chấp nhận, chốt chữ ký và nơi import:
  - `apps/admin-api/src/lib/jwt.ts`: `type JwtKeys = { privateKey: CryptoKey; publicKey: CryptoKey; kid: string }`; `loadJwtKeys(env: { JWT_PRIVATE_KEY: string; JWT_PUBLIC_KEY: string; JWT_KID: string }): Promise<JwtKeys>` (PEM PKCS8/SPKI, alg `EdDSA`; khoá lệch → ném `Error`).
  - `hashPassword(pw: string): Promise<string>`, `verifyPassword(pw: string, hash: string): Promise<boolean>`, `PASSWORD_HASH_OPTIONS` export từ `@ai/db` (file `packages/db/src/password.ts`).
  - `createDb`, `Db`, `withScope`, `setScope`, `DbScope` export từ `@ai/db`.
  - `assertSafeDbRole(db: Db): Promise<void>` ở `apps/admin-api/src/lib/db-guard.ts`.
  - `runSeed`, `loadSeedEnv`, `SeedEnvSchema` ở `@ai/db/seed` (`packages/db/package.json` `exports["./seed"]`).
  - `createApp(cfg, deps?)`, `AppDeps` ở `apps/admin-api/src/app.ts`. Hash giả: `createDummyHash(): Promise<string>` export từ `apps/admin-api/src/modules/auth/auth.service.ts`.
  - `jose` 6.2.12 thêm vào `devDependencies` gốc (cùng bản với admin-api; Accepted ADR-0001, không cần ADR mới) — làm ở T1 để Q2 dùng được.
- **G4:** xác nhận. `classifyRefresh` kiểm `revoked` trước `expired`: đã thu hồi → `superseded`/`reuse` thắng `expired`.
- **G7:** chấp nhận. `deps.now` áp cho mọi so sánh/ghi của khoá tạm (`locked_until`, `failed_logins`, `details.until`, `clearExpiredLock`, `isTempLocked`) và `last_login_at` (SQL nhận `$now`, không dùng `now()`). JWT `iat/exp`, `refresh_tokens.created_at/expires_at/revoked_at`, cửa sổ ân hạn 10 s, `password_changed_at`, `created_at/updated_at` dùng giờ thật/`now()` của DB.
- **G8:** chấp nhận. `lock`/`unlock` (user và tenant) khi trạng thái không đổi → không ghi, không tăng `version`/`updated_at`, vẫn 200 với bản hiện tại. Khoá user đã khoá cũng không thu hồi token thêm lần nữa (đã thu hồi lần đầu). Tương tự: PATCH mà mọi trường gửi lên trùng giá trị hiện tại → không tăng `version`.
- **G9:** chấp nhận, giữ spec. tenant_admin của tenant bị khoá đã bị 401 ở middleware nên thực tế chỉ platform_admin (`?tenant_id=`) tạo được user ở tenant khoá; user mới `active=true, locked_by_tenant=true, status="locked"`.
- **G10:** chấp nhận. `X-Client` so khớp **đúng** chuỗi `extension` (phân biệt hoa/thường, không trim) → chỉ đọc `refresh_token` trong body, bỏ qua cookie; giá trị khác hoặc thiếu → chỉ đọc cookie `ai_rt`, bỏ qua body. Áp cho refresh, logout, và cách trả token của login/change-password.
- **G11:** chấp nhận. T3 thêm biến mới vào `.env.example` (keys:dev chỉ sinh secret; biến không bí mật lấy từ `.env.example` khi tạo `.env.local` mới) và vào `env:` của CI; 8 bước CI cũ giữ nguyên thứ tự, chỉ **chèn** bước `keys:dev` (trước Install/Check), `db:migrate` và `db:seed` (trước E2E). Bước "Migrate" cũ vẫn còn đúng chỗ (lần 2 là no-op `main +0`). Test `server.int.test.ts` M0: server M1 cần `ADMIN_API_DATABASE_URL` + `JWT_*` + DB đã migrate (role `admin_api` tồn tại) — `test:int` chạy sau bước migrate nên thoả; ở máy dev phải `bun run db:migrate` trước `test:int` (đã nằm trong Lệnh xong). Nếu vẫn không giữ được test M0 → qc sửa ở Q2 kèm lý do.
- **G12:** điều phối đã quyết; `tasks.md` Q2 phụ thuộc thêm T1. T1 chỉ gồm contract + test contract + `jose` ở devDependencies gốc, không logic.
- **G13:** backend tự kiểm ở int test riêng: `tenants.service.int.test.ts` "lỗi giữa chừng khi tạo first admin (ép `EMAIL_TAKEN`/lỗi giả từ `users.service`) → không còn hàng `tenants`"; `seed.int.test.ts` "lỗi giữa chừng → rollback". (a) thời gian verify giả: kiểm đơn vị rằng nhánh tenant/user không tồn tại có gọi `verifyPassword` (spy) — không đo thời gian.
- **G14:** đồng ý cách đọc: web = cookie `ai_rt`, extension = `refresh_token` trong body.
- **G15:** đồng ý; ngân sách §6 kiểm bằng `users.perf.int.test.ts` (không khoá).
