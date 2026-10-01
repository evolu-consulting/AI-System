# Plan · M3-permissions (backend)

Tác giả: backend-lead · 2026-10-02 · Phần frontend: `plan-frontend.md` (không lặp lại).
Contract (endpoint, schema từng trường, mã lỗi, thứ tự kiểm) và bảng dữ liệu là **nguồn chính ở `spec.md` §3–§4**; file này thêm phần hiện thực: file, SQL, chữ ký hàm thuần cho qc, luồng service, **thứ tự khoá toàn cục**, cơ chế NOTIFY, test.
Symbol đã thấy trong code thật (đọc 2026-10-02): `withScope`, `setScope`, `sqlState`, `SCOPE_MAX_ATTEMPTS`, `Tx`, `Db` (`{db, close}`), `DbScope`, `createDb` (`packages/db/src/{scope,client}.ts`); `afterLock`, `TestHooks`, `HookOp`, `HookStep` (`apps/admin-api/src/lib/test-hooks.ts`); `resolveTenantScope`, `Actor`, `RuleError` (`users.rules.ts`); `findTenantBrief`, `lockUserRow` (`users.repo.ts`); `lockFeature`, `tenantExists`, `grantEntitlement`, `revokeEntitlement` (`features.repo.ts`); `lockCommands`, `lockFeatures`, `lockFeatureRefs` (`features.members.ts`); `lockWorkflowRef` (`workflows.service.ts`); `lockSecretRef` (`secrets.service.ts`); `ListQueryBase`, `pageResponseSchema`, `listResponseSchema`, `LocalizedTextSchema`, `UpdatedBySchema`, `REFERENCE_FIELDS`, `API_ERRORS`, `versionConflictDetailsSchema`, `CATALOG_KEY_RE`, `CORE_FEATURE_KEY` (`@ai/contracts`); postgres.js 3.4.9 `sql.notify(channel, payload)` / `sql.listen(channel, fn)` (`node_modules/postgres/types/index.d.ts:693,711`). Còn lại ghi "mới".

## 1. Phiên bản và thư viện
Không thêm thư viện, không ADR mới. NOTIFY/LISTEN = Postgres 16 qua `postgres` 3.4.9 có sẵn. `check:fn` dùng TypeScript compiler API (`typescript` 6.0.3 đã là devDependency gốc + `tools/scripts`). drizzle-orm 0.45.3 / drizzle-kit 0.31.11 như M1 (ADR-0003).

## 2. File

| File | Tạo/Sửa | Symbol / nội dung | Task |
|---|---|---|---|
| `tools/scripts/src/check-fn.ts` (+ `check-fn.test.ts`), `tools/scripts/check-fn.allow.json`, `package.json` gốc | Tạo / Sửa | §7; script `check:fn`, nối vào `check` | T0 |
| `packages/contracts/src/common.ts` | Sửa | `BETA_GROUP_PROTECTED`, `NOT_ENTITLED` vào `API_ERRORS` (36 mã); `REFERENCE_FIELDS` + `feature_id`, `group_id`, `user_id`, `group_ids`; `NotEntitledDetailsSchema` | T1 |
| `packages/contracts/src/groups.ts` (+ test) | Tạo | hằng nhóm, `GroupKeySchema`, `GroupRefSchema`, `GroupListItemSchema`, `GroupSchema`, `GroupCreateRequestSchema`, `GroupUpdateRequestSchema`, `GroupListQuerySchema`, `GroupListResponseSchema`, `GroupMemberSchema`, `GroupMemberListQuerySchema`, `GroupMemberListResponseSchema`, `GroupMembersAddRequestSchema`, `GroupMembersAddResponseSchema`, `parseUsernameList` | T1 |
| `packages/contracts/src/grants.ts` (+ test) | Tạo | `GrantFeatureRefSchema`, `GrantSubjectSchema`, `GrantSchema`, `GrantListQuerySchema`, `GrantListResponseSchema`, `GrantCreateRequestSchema`, `GrantDeleteQuerySchema`, `GrantKeySchema`, `GrantBatchRequestSchema`, `GrantBatchResponseSchema`, `GrantMatrixQuerySchema`, `GrantMatrixSchema`, `MATRIX_ROW_STATES` | T1 |
| `packages/contracts/src/access.ts` (+ test) | Tạo | `ACCESS_REASONS`, `FEATURE_MISSING`, `COMMAND_MISSING`, `USER_BLOCKERS`, `AccessReasonSchema`, `EffectiveFeatureSchema`, `EffectiveCommandSchema`, `EffectiveAccessSchema`, `EffectiveAccessQuerySchema` | T1 |
| `packages/contracts/src/config.ts` (+ test) | Tạo | `CONFIG_CHANNEL`, `CONFIG_ENTITIES`, `ConfigEntity`, `ConfigEvent`, `ConfigChangedPayloadSchema`, `configChangedPayload()` (§4) | T1 |
| `packages/contracts/src/version-conflict.ts`, `index.ts` | Sửa | export 4 file mới; `versionConflictDetailsSchema(GroupSchema)` dùng dạng nhận schema (không đổi hàm) | T1 |
| `apps/admin-api/src/lib/errors.ts` | Sửa | `MESSAGES`: `BETA_GROUP_PROTECTED` "The beta-testers group cannot be deleted", `NOT_ENTITLED` "Feature is not entitled for this tenant" | T1 |
| `packages/db/src/schema/permissions.ts` | Tạo | `groups`, `groupMembers`, `featureGrants`, `configMeta` (spec §4) — tách khỏi `admin.ts` (334 dòng) để file ≤ 400 | T2 |
| `packages/db/src/schema/admin.ts` | Sửa | `users`: thêm `unique("users_tenant_id_uq").on(tenantId, id)` (đích FK kép) | T2 |
| `packages/db/drizzle.config.ts` | Sửa | `schema: ["./src/schema/admin.ts", "./src/schema/permissions.ts"]` | T2 |
| `packages/db/migrations/0005_admin_permissions.sql` (sinh), `0006_permissions_rls.sql` (custom, §3.1) + `meta/` | Tạo | | T2 |
| `packages/db/src/permissions-rls.int.test.ts`, `migrate.int.test.ts` | Tạo / Sửa | §3.3; `{main:7,dev:2}` | T2 |
| `packages/db/src/client.ts` | Sửa | `Db` thêm `notify(channel: string, payload: string): Promise<void>` (= `sql.notify`, kết nối của pool, **ngoài** mọi transaction) | T3 |
| `packages/db/src/config-meta.ts` (+ `config-meta.int.test.ts`), `index.ts` | Tạo / Sửa | `bumpConfigVersion`, `readConfigVersion`, `withConfigWrite` (§5.2) | T3 |
| `apps/admin-api/src/lib/config/config-write.ts` (+ `config-write.int.test.ts`) | Tạo | `configWrite`, `publishConfigChanged` (§5.2). Thư mục con vì `lib/` đã 22 file (TECH-DEBT #19) | T3 |
| `apps/admin-api/src/lib/test-hooks.ts` | Sửa | `HookOp` + `group.save`, `group.delete`, `group.members`, `grant.save`, `grant.batch`, `entitlement.save`, `tenant.save`, `user.save`, `secret.save`; `HookStep` + `rows`, `bump` | T3 |
| `apps/admin-api/src/modules/groups/{README.md,groups.routes.ts,groups.service.ts,groups.repo.ts,groups.members.ts,groups.rules.ts,groups.rules.test.ts,groups.service.int.test.ts}` | Tạo | FR-62, FR-55; `groups.members.ts` = list/thêm/bớt thành viên | T4 |
| `packages/contracts/src/users.ts`, `apps/admin-api/src/modules/users/{users.repo,users.service}.ts` | Sửa | `groups[]`, `group_count` trong `User`; `?group=` (M3-R13) | T4 |
| `apps/admin-api/src/modules/grants/{README.md,grants.routes.ts,grants.service.ts,grants.repo.ts,grants.batch.ts,grants.matrix.ts,grants.rules.ts,grants.rules.test.ts,grants.service.int.test.ts}` | Tạo | FR-32, FR-35 | T5 |
| `apps/admin-api/src/modules/access/{README.md,access.routes.ts,access.service.ts,access.repo.ts,access.rules.ts,access.rules.test.ts,access.service.int.test.ts,access.perf.int.test.ts}` | Tạo | FR-36, BR-11; xuất `commandTenantExtras` cho commands | T6 |
| `packages/contracts/src/commands.ts`, `apps/admin-api/src/modules/commands/commands.access.ts` | Sửa | `groups[]`, `group_count`, `visible_user_count` (M3-R14) | T6 |
| `apps/admin-api/src/app.ts` | Sửa | mount `/admin/groups` (T4), `/admin/grants` (T5), access trước users ở `/admin/users` (T6); `hooks` cho tenants/users/secrets (T7) | T4–T7 |
| `apps/admin-api/src/modules/{tenants,users,secrets,workflows,commands,features}/*.service.ts`, `features.entitlements.ts`, `features.repo.ts` | Sửa | `withScope` ghi → `configWrite` + `ch.changed(...)` (§5.3); `features.repo.ts` `grantEntitlement` (dòng 282) và `revokeEntitlement` (dòng 297) trả số hàng đổi (`returning`) để no-op không bump (readiness #25, test-plan G9) | T7 |
| `apps/admin-api/src/lib/lock-order.int.test.ts` | Sửa | ca L1–L10 (§6.3); giữ M1 + M2 a/b/c | T7 |

Không sửa: `tests/**`, `e2e/**`, `playwright.config.ts`, migration `0000`–`0004`, `seed.ts` (backfill + trigger nằm ở `0006`).

## 3. DB

### 3.1 `0006_permissions_rls.sql` (custom, `drizzle-kit generate --custom --name=permissions_rls`; mỗi lệnh một `--> statement-breakpoint`)
```sql
-- ADM-FR-62, ADM-FR-32, ADM-FR-53, ADM-NFR-07 · RLS groups/group_members/feature_grants, quyền config_meta,
-- trigger beta-testers, backfill, hàng config_meta (spec M3 §4). Không sửa 0000–0005.
ALTER TABLE admin.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin.feature_grants ENABLE ROW LEVEL SECURITY;
-- 3 policy admin_rw giống users_admin_rw (0002) — thay <t> bằng groups, group_members, feature_grants:
CREATE POLICY <t>_admin_rw ON admin.<t> FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (<cùng biểu thức>);
CREATE POLICY <t>_hub_ro ON admin.<t> FOR SELECT TO hub_ro USING (true);
-- config_meta: không RLS (một hàng toàn hệ thống); app không bao giờ xoá.
REVOKE DELETE, TRUNCATE ON admin.config_meta FROM admin_rw;
INSERT INTO admin.config_meta (id, config_version) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
-- beta-testers (M3-R02, A10): tạo cùng transaction với mọi INSERT tenant (service, seed, fixture SQL của qc).
CREATE FUNCTION admin.create_beta_group() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO admin.groups (tenant_id, key, name, description)
  VALUES (NEW.id, 'beta-testers', '{"vi":"Beta testers","en":"Beta testers"}'::jsonb,
          'Thấy các feature đang Beta')
  ON CONFLICT (tenant_id, key) DO NOTHING;
  RETURN NULL;
END $$;
CREATE TRIGGER tenants_beta_group AFTER INSERT ON admin.tenants
  FOR EACH ROW EXECUTE FUNCTION admin.create_beta_group();
REVOKE ALL ON FUNCTION admin.create_beta_group() FROM PUBLIC;
INSERT INTO admin.groups (tenant_id, key, name, description)
  SELECT t.id, 'beta-testers', '{"vi":"Beta testers","en":"Beta testers"}'::jsonb, 'Thấy các feature đang Beta'
  FROM admin.tenants t ON CONFLICT (tenant_id, key) DO NOTHING;
```
- Trigger `SECURITY INVOKER`: chạy bằng role đang chèn tenant → `admin_api` scope `platform` qua được RLS (tạo tenant chỉ ở scope platform); owner (migration, seed, fixture) bỏ qua RLS. Trigger không cần quyền EXECUTE của người gọi.
- `0005_admin_permissions.sql` do drizzle-kit sinh (4 bảng + `users_tenant_id_uq`). Sinh `CREATE SCHEMA "admin"` thì sửa thành `IF NOT EXISTS` như M1 T2. `db:generate` lần 2 phải "No schema changes" (policy/trigger/hàm không khai trong Drizzle).
- FK kép `(tenant_id, group_id) → groups(tenant_id, id)` và `(tenant_id, user_id) → users(tenant_id, id)` (spec §4): chặn ở DB việc thành viên/grant trỏ sang tenant khác (M3-R03, R07), kể cả khi app có bug. Kiểm FK chạy bằng quyền owner, không bị RLS che.

### 3.2 SQL tham chiếu hiệu lực (BR-11, M3-R11) — dùng chung cho `access.repo`, `visible_user_count`, test `hub_ro` của qc và Hub (M5)
```sql
-- command thấy được của user :uid (chạy được bằng hub_ro: chỉ dùng cột users đã GRANT ở 0002)
select distinct c.id, c.name
from admin.users u
join admin.tenants t on t.id = u.tenant_id and t.active
cross join admin.feature_commands fc
join admin.commands c on c.id = fc.command_id and c.enabled
join admin.workflows w on w.id = c.workflow_id and w.enabled
join admin.features f on f.id = fc.feature_id
where u.id = :uid and u.active and not u.locked_by_tenant
  and (f.status = 'on' or (f.status = 'beta' and exists (
        select 1 from admin.group_members m join admin.groups g on g.id = m.group_id
        where m.user_id = u.id and g.tenant_id = u.tenant_id and g.key = 'beta-testers')))
  and (f.key = 'core' or (
        exists (select 1 from admin.feature_entitlements e
                where e.feature_id = f.id and e.tenant_id = u.tenant_id and e.revoked_at is null)
        and exists (select 1 from admin.feature_grants fg
                where fg.feature_id = f.id and fg.tenant_id = u.tenant_id
                  and (fg.user_id = u.id or fg.group_id in (
                       select m.group_id from admin.group_members m where m.user_id = u.id)))))
```
`visible_user_count` = cùng điều kiện, `count(distinct u.id)` theo `t.id` với `c.id = :cmd` (một câu cho cả trang tenant, `group by t.id`). Index dùng: `feature_commands_command_idx`, `feature_entitlements_pkey`, `feature_grants_group_uq`/`feature_grants_user_uq` (tiền tố `feature_id`), `group_members_user_idx`, `groups_tenant_key_uq`, `users_tenant_role_active_idx` không dùng được (lọc `active` + `tenant_id`) → quét `users` theo `tenant_id` qua `users_tenant_username_uq` (tiền tố). Test chéo: với mọi user dữ liệu perf, tập này = `computeEffectiveAccess(...).commands.filter(visible)`.

### 3.3 Test RLS/quyền (`packages/db/src/permissions-rls.int.test.ts`, backend; qc có M3-AC06 riêng)
Reset → migrate(test) → owner chèn 2 tenant (trigger tạo 2 `beta-testers`), mỗi tenant 1 user, 1 group, 1 thành viên, 1 grant. Kết nối `TEST_ADMIN_API_DATABASE_URL`:
1. scope `tenant` acme: `groups`/`group_members`/`feature_grants` chỉ thấy hàng acme; `insert` hàng globex → `42501`; scope `platform` thấy cả hai.
2. owner: `insert group_members (tenant acme, group acme, user globex)` → `23503`; `feature_grants` group globex với `tenant_id` acme → `23503`; `group_id` và `user_id` cùng null / cùng có → `23514 feature_grants_subject_check`.
3. `SET ROLE hub_ro`: SELECT 4 bảng mới được (thấy cả 2 tenant); `insert`/`update`/`delete` → `42501`; `select name from admin.secrets` vẫn `42501`.
4. `admin_api`: `update admin.config_meta` được (scope tenant cũng được); `delete from admin.config_meta` → `42501`.
5. Mỗi tenant có đúng một `beta-testers`; `insert tenant` mới (scope platform) → có `beta-testers` ngay trong cùng transaction.
6. `relrowsecurity` đúng 8 bảng (spec §4), không FORCE.

## 4. Hàm thuần — chữ ký chốt để qc viết test trước
Không import I/O. `RuleError = { code: ErrorCode; details?: unknown }` (như M1/M2). Kiểu từ `@ai/contracts` khi có.

```ts
// packages/contracts/src/config.ts   [ADM-FR-53] — thuần, chạy được ở trình duyệt và ở Hub
export const CONFIG_CHANNEL = "config_changed";
export const CONFIG_ENTITIES = ["tenant","user","group","grant","feature","entitlement","workflow","command","secret","batch"] as const;
export type ConfigEntity = (typeof CONFIG_ENTITIES)[number];
export type ConfigEvent = { entity: Exclude<ConfigEntity, "batch">; tenantId: string | null };
/** Ném Error khi events rỗng. entity = mọi event cùng entity ? entity đó : "batch".
 *  tenant_id = mọi event có cùng tenantId ≠ null ? tenantId : vắng (thay đổi toàn hệ thống hoặc nhiều tenant). */
export function configChangedPayload(v: number, events: readonly ConfigEvent[]): ConfigChangedPayload;
```

```ts
// packages/contracts/src/groups.ts   [ADM-FR-62, M3-R03] — dùng ở FE (ô dán) và BE
/** Tách theo /[\s,]+/, trim, toLowerCase, bỏ rỗng, bỏ trùng giữ lần xuất hiện đầu. Không cắt 500 (schema chặn). */
export function parseUsernameList(text: string): string[];
```

```ts
// apps/admin-api/src/modules/groups/groups.rules.ts   [ADM-FR-62, ADM-FR-55, M3-R01…R05]
export const BETA_GROUP_KEY = "beta-testers";        // re-export từ @ai/contracts
export function isBetaGroup(g: { key: string }): boolean;
export function checkGroupDelete(g: { key: string }): RuleError | null;        // beta → BETA_GROUP_PROTECTED
export type GroupState = { name: { vi: string; en?: string }; description: string | null };
export function changedGroupFields(cur: GroupState, next: GroupState): (keyof GroupState)[];  // so sâu name; [] → không ghi
export type FoundUser = { username: string; id: string };
/** input: username đã chuẩn hoá, không trùng (schema). found: user CÙNG tenant khớp username. existing: user id đã là thành viên.
 *  added/already/not_found theo thứ tự input; username không khớp USERNAME_RE nằm trong not_found.
 *  toInsert = id của `added`, sắp tăng dần (thứ tự khoá §6). */
export function planMemberAdd(input: readonly string[], found: readonly FoundUser[], existing: ReadonlySet<string>):
  { toInsert: string[]; added: string[]; not_found: string[]; already: string[] };
```

```ts
// apps/admin-api/src/modules/grants/grants.rules.ts   [ADM-FR-32, ADM-FR-35, BR-12, M3-R07…R09]
export type PairKey = { featureId: string; groupId: string };
export function comparePairs(a: PairKey, b: PairKey): number;   // featureId tăng rồi groupId tăng (so chuỗi uuid chữ thường)
export const pairId = (p: PairKey) => `${p.featureId}:${p.groupId}`;
export type GrantFeature = { id: string; key: string; entitled: boolean };   // entitled = có entitlement revoked_at IS NULL
/** Thứ tự: bất kỳ feature `core` (add ∪ remove) → CORE_FEATURE_PROTECTED; feature trong `addIds` mà !entitled
 *  → NOT_ENTITLED {feature_ids: sắp tăng, không trùng}. remove không cần entitlement. */
export function checkGrantFeatures(features: readonly GrantFeature[], addIds: ReadonlySet<string>): RuleError | null;
/** existing = pairId của hàng thấy ở lock pass. insert = add ∖ existing; delete = remove ∩ existing;
 *  unchanged = |add ∩ existing| + |remove ∖ existing|. insert/delete sắp theo comparePairs.
 *  CHỈ dùng để sắp thứ tự — **không** dùng để thoát sớm (luôn chạy DELETE + INSERT; no-op = `added + removed = 0` lấy từ `returning`, readiness M3 lần 2 #1); số đếm trả về client lấy từ `returning` (readiness #8, §5.5). */
export function planBatch(existing: ReadonlySet<string>, add: readonly PairKey[], remove: readonly PairKey[]):
  { insert: PairKey[]; delete: PairKey[]; unchanged: number };
/** core → "core"; entitled → "entitled"; ¬entitled ∧ revoked ∧ grantCount > 0 → "revoked"; còn lại → "none"
 *  (chưa từng mở, hoặc đã thu hồi và không còn grant; FE ẩn mặc định, plan-frontend D11). */
export function matrixRowState(f: { key: string; entitled: boolean; revoked: boolean; grantCount: number }): MatrixRowState;
```

```ts
// apps/admin-api/src/modules/access/access.rules.ts   [ADM-FR-36, ADM-BR-11, ADM-BR-12, M3-R11, R12]
export type AccessUser = { id: string; active: boolean; lockedByTenant: boolean; tenantActive: boolean;
  groupIds: readonly string[] };                       // mọi group user thuộc (cùng tenant)
export type AccessFeature = { id: string; key: string; status: FeatureStatus;
  entitled: boolean;                                   // entitlement chưa thu hồi cho tenant của user (core: bỏ qua)
  grantGroupIds: readonly string[];                    // group được cấp feature này trong tenant (thứ tự: beta đầu rồi key)
  grantUser: boolean };                                // có grant trực tiếp cho user
export type AccessCommand = { id: string; enabled: boolean; workflowEnabled: boolean;
  featureIds: readonly string[] };
export type AccessInput = { user: AccessUser; betaGroupId: string | null;
  features: readonly AccessFeature[]; commands: readonly AccessCommand[] };
export type FeatureReason = { code: "core" } | { code: "grant_user" } | { code: "grant_group"; groupId: string } | { code: "beta_member" };
export type UserBlocker = "user_inactive" | "tenant_locked";
export type FeatureMissing = UserBlocker | "feature_off" | "beta_not_member" | "no_entitlement" | "no_grant";
export type CommandMissing = UserBlocker | "command_disabled" | "workflow_disabled" | "no_effective_feature";
export type FeatureAccess = { featureId: string; effective: boolean; reasons: FeatureReason[]; missing: FeatureMissing[] };
export type CommandAccess = { commandId: string; visible: boolean;
  via: { featureId: string; reasons: FeatureReason[] }[];
  blockedBy: { featureId: string; missing: Exclude<FeatureMissing, UserBlocker>[] }[];
  missing: CommandMissing[]; suggestFeatureId: string | null };
export type EffectiveAccess = { blockers: UserBlocker[]; features: FeatureAccess[]; commands: CommandAccess[] };
export function computeEffectiveAccess(input: AccessInput): EffectiveAccess;
```
Luật chính xác của `computeEffectiveAccess` (qc dựa vào):
1. `blockers` = [`user_inactive` nếu `!active`, `tenant_locked` nếu `!tenantActive ∨ lockedByTenant`] (thứ tự này).
2. Mỗi feature (giữ thứ tự input): `isCore = key === "core"`. `reasons`: core → `[core]`; khác → `grant_user` (nếu `grantUser`) rồi `grant_group` cho mỗi id trong `grantGroupIds ∩ user.groupIds` (thứ tự `grantGroupIds`); thêm `beta_member` cuối nếu `status = beta ∧ betaGroupId ∈ user.groupIds`. `missing` (thứ tự cố định): `...blockers`, `feature_off` nếu `status = off`, `beta_not_member` nếu `status = beta ∧ betaGroupId ∉ user.groupIds` (kể cả `betaGroupId = null`), `no_entitlement` nếu `¬isCore ∧ ¬entitled`, `no_grant` nếu `¬isCore ∧ ¬grantUser ∧ (grantGroupIds ∩ user.groupIds) = ∅`. `effective ⇔ missing = []`. → `beta` cần **cả** grant và thành viên `beta-testers` (A7); grant còn giữ khi `no_entitlement` (A11 hiện `reasons` + `missing`).
3. Mỗi command (giữ thứ tự input): `via` = feature trong `featureIds` (theo thứ tự `features` input) có `effective`, kèm `reasons`. `blockedBy` = feature trong `featureIds` (cùng thứ tự) **không** `effective`, kèm `missing` của feature đó **bỏ** `user_inactive`/`tenant_locked` (đã ở `blockers`; có thể rỗng khi chỉ bị chặn bởi user). `missing`: `...blockers`, `command_disabled` nếu `!enabled`, `workflow_disabled` nếu `!workflowEnabled`, `no_effective_feature` nếu `via = []` **và** `blockers = []`. `visible ⇔ missing = []`.
4. `suggestFeatureId` = khi `¬visible ∧ blockers = [] ∧ enabled ∧ workflowEnabled`: feature đầu tiên (thứ tự `features`) thuộc `featureIds` có `missing` đúng bằng `["no_grant"]`; còn lại `null` (luồng F4 "Cấp cho group…").
5. `featureIds` trỏ tới id không có trong `features` → bỏ qua (không ném).

## 5. Luồng service, NOTIFY

### 5.1 Ký hiệu
`C{op}` = một `configWrite(c, op, fn)` (§5.2): transaction + scope + retry 40P01/40001, callback **chỉ làm việc DB**, ghi sự kiện bằng `ch.changed({entity, tenantId})` **ngay sau** câu ghi có đổi dữ liệu; bump `config_meta` là câu cuối; NOTIFY sau commit. `R{…}` = `withScope` chỉ đọc. Call như users: `{ ctx: { db; hooks? }, actor, scope }`; tenant theo `resolveTenantScope(actor, query.tenant_id, "read"|"write")` (users.rules). Mọi câu có `where tenant_id = $tid` (kể cả khi RLS đã lọc). 404 khi không thấy. `VERSION_CONFLICT` so trên bản **đã khoá** (đọc lại sau khoá).
- **Một request = đúng một `configWrite`** (readiness #24): helper nội bộ của service nhận `(tx, ch)` và chạy trong transaction của request; không helper nào tự mở `configWrite`/`withScope` lồng nhau (mỗi request bump tối đa một lần, một NOTIFY).
- **Vị trí hook** (readiness #16, áp cho **mọi** op ở §2): `locked` = ngay sau câu khoá **cuối cùng** của luồng, trước mọi kiểm luật; `rows` = ngay sau câu ghi **cuối cùng**, trước bump; `bump` = do `configWrite` gọi ngay trước upsert `config_meta` (chỉ khi có sự kiện); `names` (M2) giữ nguyên. Op không có khoá tường minh (POST group, POST tenant) không gọi `locked`. Hook chỉ đợi Promise do test giữ, không I/O.

### 5.2 `config_version` + NOTIFY sau commit (TECH-DEBT #13, M3-R15/R16)
```ts
// packages/db/src/config-meta.ts (mới)
export type ConfigSink = { changed(e: ConfigEvent): void };
export type ConfigCommitted<T> = { result: T; version: number | null; events: readonly ConfigEvent[] };
/** Khoá CUỐI của transaction (hàng id=1). Upsert để không hỏng khi hàng bị xoá tay: */
export async function bumpConfigVersion(tx: Tx): Promise<number>;
  // insert into admin.config_meta (id, config_version, updated_at) values (1, 1, now())
  // on conflict (id) do update set config_version = admin.config_meta.config_version + 1, updated_at = now()
  // returning config_version
export async function readConfigVersion(tx: Tx): Promise<number>;   // không khoá; hàng thiếu → 0
/** withScope + sink mới MỖI lần thử (retry 40P01 bỏ sự kiện của lần hỏng). fn trả xong: events ≠ [] →
 *  await opts.beforeBump?.() → bumpConfigVersion (câu cuối) → trả {result, version, events}; events = [] → version null, không bump. */
export async function withConfigWrite<T>(db: Db, scope: DbScope,
  fn: (tx: Tx, ch: ConfigSink) => Promise<T>, opts?: { beforeBump?: () => Promise<void> }): Promise<ConfigCommitted<T>>;
```
```ts
// apps/admin-api/src/lib/config/config-write.ts (mới)
export type ConfigCall = { ctx: { db: Db; hooks?: TestHooks }; scope: DbScope };
/** withConfigWrite (beforeBump = afterLock(hooks, op, "bump")) → đã commit → version ≠ null thì publishConfigChanged
 *  đúng MỘT lần → trả result. Ném (rollback, lỗi luật) → không publish. */
export async function configWrite<T>(c: ConfigCall, op: HookOp, fn: (tx: Tx, ch: ConfigSink) => Promise<T>): Promise<T>;
/** db.notify(CONFIG_CHANNEL, JSON.stringify(configChangedPayload(v, events))) — kết nối pool, ngoài transaction.
 *  Lỗi → logger.error("config_changed notify failed", {module:"config", v, ...safeErrorFields(err)}), KHÔNG ném. */
export async function publishConfigChanged(db: Db, v: number, events: readonly ConfigEvent[]): Promise<void>;
```
Bảo đảm (qc kiểm ở `notify-{writes,noop,props}.int.test.ts`, backend ở `config-write.int.test.ts`):
- **Đúng một** NOTIFY cho mỗi transaction thành công **có đổi dữ liệu**, gửi **sau** khi `withScope` trả (đã commit) → không thể phát cho dữ liệu bị rollback.
- Rollback (ném lỗi luật sau khi đã ghi, vd `INVALID_REFERENCE` ở command POST bước 5) → không bump (bump chưa chạy hoặc bị rollback), không NOTIFY.
- Retry 40P01/40001: sink tạo lại mỗi lần thử; lần hỏng bị Postgres rollback cả bump → `config_version` +1 và NOTIFY một lần. Ca tất định: hook ném `Object.assign(new Error("test deadlock"), { code: "40P01" })` ở `(op, "bump")` lần đầu.
- No-op (không câu ghi nào đổi hàng) → không gọi `changed` → không bump, không NOTIFY.
- `v` trong payload = giá trị `returning` của chính transaction; vì khoá `config_meta` giữ tới commit nên `v` tăng đúng thứ tự commit. NOTIFY của hai transaction có thể đến **lệch thứ tự** → Hub lấy `max(v)`.
- Mất NOTIFY (crash giữa commit và gửi, mất kết nối LISTEN) → Hub đọc `select config_version from admin.config_meta` khi khởi động, khi LISTEN nối lại, và định kỳ (mặc định 30 s) — ghi vào `PRODUCTION-NOTES` (D1).
- Chi phí: 1 câu upsert trong tx + 1 `pg_notify` ngoài tx (≤ 5 ms/ghi, spec §6; đo ở `config-write.int.test.ts`).
- Test M1/M2 cũ: hook chỉ thêm bước `bump` (test cũ lọc `op` **và** `step`, không bị dừng thêm); thứ tự khoá cũ giữ nguyên vì bump là khoá cuối.

### 5.3 Sự kiện theo thao tác (chỉ khi thực sự đổi hàng; `rowCount`/`returning` quyết định)
| Module · thao tác | `changed(...)` |
|---|---|
| tenants: POST; PATCH có trường đổi; lock/unlock đổi `active` | `{tenant, id}` (POST: một sự kiện, kể cả admin đầu + `beta-testers`) |
| users: POST; PATCH có trường đổi; lock (`active` đổi); unlock khi `active` false→true | `{user, tenant_id}`. **Không**: unlock chỉ xoá khoá tạm, reset-password, logout-all, login/refresh/đổi mật khẩu (sổ sách đăng nhập, R15) |
| groups: POST; PATCH có trường đổi; DELETE; members thêm ≥ 1 / xoá 1 hàng | `{group, tenant_id}` |
| grants: POST tạo mới; DELETE xoá 1 hàng; batch `insert ∪ delete ≠ ∅` | `{grant, tenant_id}` |
| features: POST; PATCH có trường/tập đổi; DELETE | `{feature, null}` |
| entitlements: PUT tạo/cấp lại; DELETE đặt `revoked_at` | `{entitlement, tenant_id}` |
| workflows / commands: POST; PATCH đổi; DELETE | `{workflow\|command, null}` |
| secrets: POST; PUT; PATCH ghi chú (khi đổi); DELETE | `{secret, null}` (payload không có tên/giá trị) |

### 5.4 Groups (`groups.service.ts`, `groups.members.ts`)
- List: một câu trang (`count(*) over()`), `member_count`/`feature_count` bằng subquery đếm theo `group_id` (index PK `group_members_pkey`, `feature_grants_group_idx`), `agent_count = 0`; sắp `t.key, (g.key <> 'beta-testers'), g.key`.
- POST: tenant `findTenantBrief(tx, tid)` không khoá (404) → savepoint `insert groups` (23505 `groups_tenant_key_uq` → `KEY_TAKEN`) → `changed` → `afterLock("group.save","rows")` → đọc lại.
- PATCH: đọc (404) → `select … for no key update` → đọc lại, `version` → `changedGroupFields` (rỗng → trả hiện tại) → `update … version+1, updated_by, updated_at` → `changed`.
- DELETE: khoá `NKU` → `checkGroupDelete` → `delete` (cascade `group_members`, `feature_grants`) → `changed`.
- Members list: `group_members m join users u` lọc `m.group_id`, `m.tenant_id`; `q` khớp `username`/`display_name`; sắp `username`; `other_groups` (≤ 3, beta đầu rồi key, bỏ group đang xem) + `other_groups_total` bằng subquery theo `group_members_user_idx`.
- Members add `dry_run=true` (FE C4): chạy tới `planMemberAdd` (group vẫn `FOR SHARE`) rồi trả, **không** chèn, không `changed` (không bump/NOTIFY). Thường: group `FOR SHARE` (404) → `afterLock("group.members","locked")` → `select id, username from users where tenant_id = $tid and username = any($input)` → `select user_id from group_members where group_id = $g and user_id = any($found)` → `planMemberAdd` → `insert … select unnest($toInsert) order by 1 on conflict do nothing returning user_id` → số hàng > 0 → `changed` → `afterLock(…,"rows")`. Đua thêm cùng user (DO NOTHING trả ít hàng hơn `toInsert`): username đó chuyển `added` → `already`.
- Members remove: group `FOR SHARE` (404) → `delete … where group_id and user_id and tenant_id returning 1` → có → `changed`. 204 cả khi không phải thành viên.
- Users (T4): `findUserRow`/`listUsers` thêm `groups` = `coalesce((select json_agg(… order by (g.key <> 'beta-testers'), g.key) from (… limit 50)), '[]')`, `group_count` (index `group_members_user_idx`); `?group=` → `exists (select 1 from group_members m where m.group_id = $g and m.user_id = u.id)` (PK). Trả `User` ở mọi chỗ (`toUser`), kể cả `first_admin`, `VERSION_CONFLICT.current`.

### 5.5 Grants (`grants.service.ts`, `grants.batch.ts`, `grants.matrix.ts`)
Khoá theo §6 (dòng "Grant …"). Tra tham chiếu **sau** khi khoá (bản đã khoá là bản kiểm); **thứ tự khoá ≠ thứ tự báo lỗi**: khoá đủ trước, rồi báo theo thứ tự spec §3 (feature → subject).
- POST: tenant (404) → subject: group `FOR SHARE` (`tenant_id = $tid`) hoặc user cùng tenant (không khoá, E2) → feature `FOR SHARE` → entitlement `select 1 … where feature_id, tenant_id, revoked_at is null for share` → `afterLock("grant.save","locked")` → feature thiếu → `INVALID_REFERENCE {field:"feature_id", ids:[feature_id]}` → subject thiếu → `{field:"group_id"|"user_id", ids:[id đó]}` → `checkGrantFeatures` → lock pass hàng grant của cặp (`for no key update`) → `insert … on conflict do nothing returning id` → mới: `changed`, 201; có rồi: 200 bản hiện có, không bump → `afterLock(…,"rows")`.
- DELETE (query): tenant (404) → group `FOR SHARE` / user (không thấy → 204) → feature `FOR SHARE` (không thấy → 204) → `delete … returning 1` → có → `changed`. `core` → 409 `CORE_FEATURE_PROTECTED` (đồng nhất với POST).
- Batch: tenant (404) → `groupIds` = tập group_id **tăng dần** → `select id from groups where tenant_id and id = any order by id for share` → `featureIds` tăng dần → `select id, key from features where id = any order by id for share` → `select feature_id from feature_entitlements where tenant_id and feature_id = any and revoked_at is null order by feature_id for share` → `afterLock("grant.batch","locked")` → feature thiếu → `INVALID_REFERENCE {field:"feature_ids", ids}` → group thiếu/khác tenant → `{field:"group_ids", ids}` → `checkGrantFeatures` → **lock pass** `select feature_id, group_id from feature_grants where tenant_id and (feature_id, group_id) in (add ∪ remove) order by feature_id, group_id for no key update` → `planBatch` (chỉ để biết thứ tự; **không early-return** kể cả khi kế hoạch rỗng) → `delete from feature_grants where id in (select id from feature_grants where tenant_id = $tid and group_id is not null and (feature_id, group_id) in (**toàn bộ `remove`**) order by feature_id, group_id for no key update) returning feature_id, group_id` (câu mới thấy bản commit mới nhất và khoá theo thứ tự cặp — readiness lần 2 #6) → `insert … select * from unnest($f, $g) with ordinality order by ordinality on conflict (feature_id, group_id) where group_id is not null do nothing returning feature_id, group_id` (toàn bộ `add`, thứ tự `comparePairs`) → `added` = số hàng `returning` của insert, `removed` = số hàng `returning` của delete, `unchanged = |add| + |remove| − added − removed` → `added + removed > 0` → `changed` → `afterLock(…,"rows")`.
  Vì sao không xoá theo `remove ∩ existing` (readiness #8): ở READ COMMITTED, lock pass chỉ thấy hàng đã commit **lúc câu đó chạy**; hàng Y do tx khác commit trong lúc ta chờ khoá sẽ không có trong `existing` → xoá theo snapshot bỏ sót Y (L1/C1 đỏ). Câu `DELETE`/`INSERT … ON CONFLICT` mới chạy sau, đọc bản commit mới nhất (và chờ hàng đang bị khoá), nên đúng. Lock pass vẫn giữ để khoá theo thứ tự tăng dần.
- Matrix (đọc): tenant (404) → groups: `?group_id` → đúng một group (không thấy/khác tenant → 404), không thì trang `limit` ≤ 200 + `offset`, sắp beta đầu rồi key, kèm `member_count` → features: mọi feature `left join feature_entitlements e (tenant)` + `count(fg)` + `array_agg(fg.group_id order by fg.group_id) filter (where fg.group_id = any($pageGroups))` + `command_names` (≤ 10, sắp) + `command_count` → `matrixRowState` → sắp core đầu rồi key. Index: `feature_grants_tenant_feature_idx`, `feature_entitlements_pkey`, `feature_commands_pkey`.

### 5.6 Access (`access.service.ts`, `access.repo.ts`)
`R{}` scope của actor: user (404 qua `canSeeUser`) + tenant → group ids của user + `beta-testers` id → features (mọi feature; `entitled` = exists entitlement chưa thu hồi; `grantGroupIds` = `array_agg(fg.group_id order by beta, key)` lọc tenant; `grantUser`) → commands (mọi command, hoặc chỉ `name = $c or $c = any(aliases)` khi `?command=`; `featureIds` = `array_agg(fc.feature_id)`; `workflowEnabled`) → `readConfigVersion` → `computeEffectiveAccess` → map sang `EffectiveAccess` (ghép GroupRef/feature ref). 4 câu, không N+1.
Xuất cho commands (`commandTenantExtras(tx, commandId, tenantIds): Promise<Map<string, {groups, group_count, visible_user_count}>>`): một câu `group by t.id` theo §3.2 + một câu cặp (group, feature của command) đang được cấp, chỉ feature `on|beta` có entitlement chưa thu hồi (`row_number() over (partition by tenant)` ≤ 20, sắp group key rồi feature key; `group_count` = tổng số cặp). `commands.access.ts` gọi sau khi có trang tenant (M2 giữ nguyên câu chính).

## 6. Thứ tự khoá toàn cục (M1 + M2 + M3)

### 6.1 Hạng (khoá hạng thấp trước; không tx nào giữ khoá hạng cao rồi chờ khoá hạng thấp — trừ ngoại lệ có chứng minh ở 6.2)
| Hạng | Tài nguyên | Khoá tường minh | Khoá ngầm (FK / unique) và vì sao an toàn |
|---|---|---|---|
| 1 | `tenants` | `NKU` (tenant PATCH/lock, mọi ghi user qua `lockTarget`), `SHARE` (createUser) | `KEY SHARE` từ FK của `users`, `refresh_tokens`, `groups`, `feature_entitlements`, `feature_grants`. Chỉ xung đột `FOR UPDATE`/`DELETE` tenant — app không có (CR-006) → không bao giờ chờ. Unique `tenants_key_uq` khi POST: chỉ POST cùng key chờ nhau |
| 2 | `users` | `NKU` (ghi user, login sổ sách), `SHARE` (refresh) | `KEY SHARE` từ FK `refresh_tokens`, `updated_by`/`granted_by`/`added_by`, FK kép `group_members`/`feature_grants` → không xung đột (app không xoá user, không đổi `id`/`tenant_id`). Unique username/email khi POST |
| 3 | `groups` | `NKU` (PATCH, DELETE), `SHARE` (members, grant, batch — id tăng) | `KEY SHARE` từ FK kép khi chèn member/grant: **xung đột** với khoá xoá của group DELETE → mọi luồng chèn phải giữ `SHARE` group **trước** (đã giữ khoá mạnh hơn nên `KEY SHARE` không chờ thêm). Unique `groups_tenant_key_uq` khi POST/trigger tenant |
| 4 | `group_members` | — | hàng chèn (PK unique, `user_id` tăng) / xoá; cascade từ group DELETE |
| 5 | `workflows` | `NKU` (PATCH, DELETE), `SHARE` (command POST/PATCH) | unique `workflows_key_uq` khi POST (ngoại lệ E1) |
| 6 | `commands` | `NKU` (id tăng) | unique `commands_name_uq` |
| 7 | `command_names` | — | unique PK khi chèn/xoá tên (M2 v2 #1: POST và PATCH cùng thứ tự tên → features) |
| 8 | `features` | `NKU` (id tăng), `SHARE` (entitlement, grant, batch — id tăng) | unique `features_key_uq` khi POST; `KEY SHARE` từ FK `feature_commands`/`feature_entitlements`/`feature_grants` — đã giữ `SHARE`/`NKU` trước |
| 9 | `feature_commands` | — | hàng chèn/xoá; cascade |
| 10 | `feature_entitlements` | khoá hàng của upsert/`UPDATE revoked_at` (PUT/DELETE); `SHARE` (grant, batch — `feature_id` tăng) | PK `(feature_id, tenant_id)` khi chèn |
| 11 | `feature_grants` | lock pass `NKU` sắp `(feature_id, group_id)` (hoặc cặp user) trên **mọi** khoá của request (thêm ∪ bớt) | unique `feature_grants_group_uq`/`_user_uq` khi chèn (sắp tăng, sau lock pass); cascade từ feature/group DELETE |
| 12 | `secrets` | `NKU` (PUT/PATCH/DELETE), `SHARE` (workflow POST/PATCH) | unique `secrets_name_uq` |
| 13 | `refresh_tokens` | hàng ghi (sổ sách đăng nhập) | không thuộc cấu hình, không bump |
| 14 | `config_meta` | khoá hàng `id=1` của upsert bump | **luôn câu cuối**, chỉ khi có sự kiện; giữ tới commit, sau đó không chờ gì → không thể nằm trong vòng |

### 6.2 Chuỗi khoá từng thao tác (→ = theo thứ tự; `cfg` = bump hạng 14)
| Thao tác | Chuỗi | Ghi chú |
|---|---|---|
| Tenant POST | insert tenant (1, unique) → trigger AFTER ROW chèn `beta-testers` ngay trong câu INSERT tenant (3, unique) → insert admin (2, unique) → `cfg` | **E3** (3 trước 2) |
| Tenant PATCH / lock | tenant `NKU` (1) → [lock: `UPDATE users` cả tenant (2) → `refresh_tokens` (13)] → `cfg` | nhiều hàng user cùng lúc chỉ xảy ra dưới khoá tenant `NKU` → tuần tự |
| User POST | tenant `SHARE` (1) → insert user (2) → `cfg` | |
| User PATCH/lock/unlock/reset | tenant `NKU` (1) → user `NKU` (2) → [`refresh_tokens` (13)] → `cfg` (trừ reset/unlock tạm) | M1 N1 |
| Login/refresh/đổi mật khẩu | user `NKU`/`SHARE` (2) → `refresh_tokens` (13) | không `cfg` |
| Group POST | insert group (3, unique; FK `KEY SHARE` tenant) → `cfg` | |
| Group PATCH | group `NKU` (3) → `cfg` | |
| Group DELETE | group `NKU` (3) → cascade members (4), grants (11) → `cfg` | |
| Members add/remove | group `SHARE` (3) → insert (`user_id` tăng) / delete (4) → `cfg` | `KEY SHARE` users (2) lúc chèn: không xung đột (E2) |
| Grant POST/DELETE | group `SHARE` (3) → feature `SHARE` (8) → entitlement `SHARE` (10) → lock pass + insert/delete (11) → `cfg` | `KEY SHARE` tenant/user lúc chèn (E2) |
| Grant batch | groups `SHARE` id tăng (3) → features `SHARE` id tăng (8) → entitlements `SHARE` `feature_id` tăng (10) → lock pass sắp cặp (11) → delete (subselect `order by feature_id, group_id for no key update`, khoá cả hàng commit sau lock pass, theo thứ tự cặp) → insert sắp cặp (11) → `cfg` | xem L1 |
| Workflow POST | secret `SHARE` (12) → insert workflow (5, unique) → `cfg` | **E1** |
| Workflow PATCH | workflow `NKU` (5) → secret `SHARE` khi đổi (12) → `cfg` | M2 |
| Workflow DELETE | workflow `NKU` (5) → `cfg` | |
| Command POST | workflow `SHARE` (5) → insert command (6) + names (7) → features `NKU` (8) → `feature_commands` (9) → `cfg` | M2 v2 #1 |
| Command PATCH | workflow `SHARE` (5) → command `NKU` (6) → names (7) → features `NKU` (8) → (9) → `cfg` | |
| Command DELETE | command `NKU` (6) → features `NKU` bump (8) → cascade (7, 9) → `cfg` | |
| Feature POST / PATCH có `command_ids` | commands `NKU` id tăng (6) → insert/khoá feature (8) → (9) → `cfg` | |
| Feature PATCH không `command_ids` | feature `NKU` (8) → `cfg` | |
| Feature DELETE | commands `NKU` (6) → feature `NKU` (8) → cascade (9, 10, 11) → `cfg` | |
| Entitlement PUT/DELETE | feature `SHARE` (8) → upsert/`UPDATE` (10) → `cfg` | `KEY SHARE` tenant (E2) |
| Secret POST/PUT/PATCH/DELETE | [insert (12, unique)] / secret `NKU` (12) → `cfg` | |

Ngoại lệ (được chứng minh, ghi trong comment code):
- **E1 — Workflow POST** giữ `SHARE` secret (12) rồi mới chèn workflow (khoá unique hạng 5 của **key mới**). Chỉ một luồng khác chờ được khoá này: Workflow POST cùng key, đi cùng chuỗi; tx đang giữ `NKU` secret (12) không bao giờ chèn workflow → không vòng. Không đổi (giữ M2).
- **E2 — `KEY SHARE` lên tenants/users** lấy lúc chèn hàng con (sau hạng cao hơn): không tx nào của app giữ khoá xung đột (`FOR UPDATE`/`DELETE` trên tenants/users không tồn tại). Nếu mốc sau thêm xoá user/tenant → phải xếp lại (ghi vào PRODUCTION-NOTES và README `@ai/db`).
- **E3 — Tenant POST** chèn group `beta-testers` (hạng 3, qua trigger AFTER ROW chạy trong câu INSERT tenant) **trước** user admin đầu (hạng 2). An toàn: cả hai hàng thuộc `tenant_id` **mới, chưa commit** — không tx nào khác thấy/tham chiếu được tenant đó, khoá unique `groups_tenant_key_uq (tenant_id, key)` và `users_tenant_username_uq (tenant_id, username)` của tenant mới không có ai tranh; tx chèn cùng key tenant đã phải chờ ở `tenants_key_uq` (hạng 1) trước khi tới đây. Vì vậy tx này không chờ khoá nào ở hạng 2–3 → không vòng.
- **Batch**: không xử lý theo thứ tự request; mọi tập (groups, features, entitlements, cặp grant) sắp tăng trước khi khoá; lock pass phủ **thêm ∪ bớt** (ca A thêm X bớt Y ∥ B thêm Y bớt X chỉ an toàn khi cả hai cùng khoá X rồi Y).
- **Bản sửa hiệu năng** (bài học M2 v2): đổi câu khoá/gộp câu trong bất kỳ dòng nào ở 6.2 phải giữ đúng chuỗi và chạy lại `lock-order.int.test.ts`; reviewer đối chiếu bảng này.

### 6.3 Ca xen kẽ tất định (`apps/admin-api/src/lib/lock-order.int.test.ts`, T7; qc đối chiếu ở `tests/acceptance/M3/concurrency.int.test.ts`)
Cơ chế như M2: hook `afterLock(op, step)` dừng tx A (Promise mở bằng tay) → chạy B → chờ B **đang chờ khoá** (`pg_stat_activity.wait_event_type = 'Lock'` cho pid của B, poll ≤ 500 ms) hoặc B xong (ca L7) → mở A. Mỗi ca: `deadlocksSince(before) = 0`, xong < 900 ms sau khi mở, kiểm `config_version` và số NOTIFY (listener).
| Ca | A dừng ở | B | Kỳ vọng | Đỏ khi |
|---|---|---|---|---|
| L1 | batch `[bớt X, thêm Y]` · `grant.batch/rows` | batch `[thêm X, bớt Y]` | B chờ; A 200, B 200; cuối: X có, Y không; `cfg` +2 | batch không sắp / lock pass chỉ phủ "bớt" |
| L2 | POST grant (f,g) · `grant.save/rows` | POST (f,g) | B chờ unique; A 201, B 200; 1 hàng; `cfg` +1, 1 NOTIFY | không idempotent / bump khi DO NOTHING |
| L3a | POST grant · `grant.save/locked` (giữ entitlement `SHARE`) | DELETE entitlement | B chờ; A 201, B 204; grant còn, `effective-access` không hiệu lực (BR-12) | grant không khoá entitlement |
| L3b | DELETE entitlement · `entitlement.save/rows` | POST grant | B chờ; B 409 `NOT_ENTITLED` | grant đọc entitlement trước khoá |
| L4a | DELETE group · `group.delete/locked` | batch có group đó | B chờ; B 400 `INVALID_REFERENCE {group_ids}`; 0 hàng | batch không `SHARE` group trước khi chèn |
| L4b | batch · `grant.batch/rows` | DELETE group | B chờ; A 200 rồi B 204; hàng grant của group bị cascade | |
| L5 | PATCH feature (status) · `feature.save/locked` | POST grant feature đó | B chờ; cả hai thành công; `cfg` +2, v theo thứ tự commit | |
| L6 | DELETE feature · `feature.delete/locked` | batch thêm feature đó | B chờ; B 400 `INVALID_REFERENCE {feature_ids}` | |
| L7 | PATCH group tenant T1 · `group.save/bump` | POST grant tenant T2 | B **không chờ**, xong trước: `v_B = v0+1`; mở A → `v_A = v0+2` | bump không phải câu cuối (B chờ `config_meta`) |
| L8 | POST tenant `acme2` · `tenant.save/rows` | POST tenant `acme2` | B chờ unique; A 201, B 409 `KEY_TAKEN`; đúng 1 `beta-testers`; `cfg` +1 | |
| L9 | members add `[u2,u1]` · `group.members/rows` | members add `[u1,u2]` | B chờ; A `added` 2; B `already` 2; `cfg` +1 | chèn không sắp `user_id` |
| L10 | PATCH group, hook ném `40P01` ở `group.save/bump` lần 1 | — | 200; `version` +1; `cfg` +1; listener nhận **đúng 1** NOTIFY cho group này (≤ 1 s), rồi một ghi **sentinel** (PATCH group khác) → thông điệp kế tiếp nhận được là của sentinel (`v` = v_group + 1), không có thông điệp thừa ở giữa — không ngủ cố định (readiness #15) | publish trong callback / sink không tạo lại |
Giữ nguyên các ca M1 (login ∥ lock/reset) và M2 a/b/c.

## 7. `check:fn` (T0, TECH-DEBT #18)
- `bun run check:fn [--all | --files …]` (mặc định: file đổi so với `main`, dùng `lib/git.ts` như `check-size`). Phạm vi: `apps/*/src/**`, `packages/*/src/**`, `tools/*/src/**` đuôi `.ts`/`.tsx`, gồm cả `*.test.ts` cạnh code; **bỏ** `tests/**`, `e2e/**` (của qc, bị khoá), `components/ui/**`, `__fixtures__/**`, `*.gen.ts`, migration.
- Phân tích bằng `ts.createSourceFile` (không chạy typecheck). Nút hàm: `FunctionDeclaration`, `FunctionExpression`, `ArrowFunction`, `MethodDeclaration`, `Constructor`, `Get/SetAccessor`. Dòng = dòng cuối − dòng đầu + 1 của cả nút (gồm chữ ký). Tham số = `parameters.length` bỏ tham số `this`. Giới hạn: ≤ 50 dòng (component React trong `.tsx` — hàm/arrow gán cho tên PascalCase — ≤ 200), ≤ 4 tham số. Hàm lồng tính riêng.
- Tên để báo/allowlist: tên khai báo / biến / method / property; callback ẩn danh = `<callee>("<đối số chuỗi đầu, ≤ 40 ký tự>")` (vd `describe("ADM-FR-63 · …")`) hoặc `<anonymous>`.
- `tools/scripts/check-fn.allow.json` = `[{file, name, reason}]` (khoá theo file + tên, không theo dòng). Ghi sẵn nợ cũ TECH-DEBT #23, #24 và vi phạm `--all` phát hiện khi viết T0 (mỗi mục có lý do + số TECH-DEBT). Mục allowlist không còn vi phạm → in cảnh báo, không đỏ. Ra: `path:line name (n dòng | n tham số)`, exit 1 khi có vi phạm ngoài allowlist.
- `package.json`: `"check:fn": "bun tools/scripts/src/check-fn.ts"`; `check` thêm `&& bun run check:fn`.
- Test (`check-fn.test.ts`): 50/51 dòng, 4/5 tham số, `this`, destructuring = 1 tham số, component 200/201, hàm lồng, allowlist, tên callback.

## 8. Test của backend (ngoài acceptance của qc)
| File | Loại | Phủ |
|---|---|---|
| `packages/contracts/src/{groups,grants,access,config}.test.ts`, `common.test.ts`, `users.test.ts`, `commands.test.ts` | unit | strict, biên, `parseUsernameList`, batch trùng cặp/rỗng/201, exactly-one subject, `configChangedPayload` (entity/batch/tenant_id), `API_ERRORS` 36 |
| `packages/db/src/permissions-rls.int.test.ts`, `config-meta.int.test.ts`, `migrate.int.test.ts` | int | §3.3; bump upsert, retry không tăng đôi, sink mới mỗi lần thử |
| `apps/admin-api/src/lib/config/config-write.int.test.ts` | int | listener `sql.listen`: 1 NOTIFY/commit, payload, rollback/no-op/retry 0 thêm, notify lỗi (Db giả ném) → response vẫn trả, log có `v`; chi phí ≤ 5 ms (p95, 50 lần) |
| `apps/admin-api/src/modules/{groups,grants,access}/*.rules.test.ts` | unit | mọi hàm §4 |
| `apps/admin-api/src/modules/{groups,grants,access}/*.service.int.test.ts` | int | CRUD, 404 chéo tenant, idempotent, cascade, `beta-testers`, `VERSION_CONFLICT`, effective-access khớp SQL §3.2 |
| `apps/admin-api/src/modules/access/access.perf.int.test.ts` | int | spec §6 (20 lần, p95): groups list, effective-access, matrix 200×200, batch 200, command access |
| `apps/admin-api/src/lib/lock-order.int.test.ts` | int | §6.3 |

## 9. Rủi ro
- **Test khoá M0–M2 đỏ theo dự kiến** sau T1 (`API_ERRORS` 34 → 36) và T2 (7 migration, 14 bảng, 8 bảng RLS) cho tới khi qc sửa ở Q2 — thay đổi phạm vi đã duyệt, không phải tranh chấp. Thứ tự: T1 → Q2 → T2.
- **`User` có thêm `groups`/`group_count`** (T4): mọi response user đổi hình (strict). Test M1 parse bằng `UserSchema` của contract nên vẫn xanh khi server gửi đủ; FE cập nhật kiểu cùng lúc.
- **Trigger `beta-testers`**: hành vi ngầm khi chèn tenant; ghi comment ở `schema/permissions.ts`, README `@ai/db`, và M1-AC (đếm group sau tạo tenant = 1).
- **Bump tuần tự hoá mọi ghi cấu hình ở bước cuối** (một hàng): chỉ giữ khoá tới commit (< 1 ms); ghi admin ít → chấp nhận. Đo ở perf.
- **NOTIFY mất** khi crash giữa commit và gửi → Hub dự phòng đọc `config_meta` (5.2).
- **Ma trận dày** (200 × 200 đều tick) → ~1,5 MB JSON: chấp nhận (thực tế thưa); `limit` group ≤ 200.
- **Thêm xoá user/tenant ở mốc sau** phá giả định E2 → phải xếp lại thứ tự.

## 10. Ghi chú cho qc (Q1/Q2)
- **Số liệu sửa test khoá cũ**: migration `{main:7, dev:2}` (development/test), `{main:7, dev:0}` (production), lần 2 `{0,0}`; bảng `admin.*` = 14: `command_names, commands, config_meta, feature_commands, feature_entitlements, feature_grants, features, group_members, groups, refresh_tokens, secrets, tenants, users, workflows`; `relrowsecurity` bật 8 (`feature_entitlements, feature_grants, group_members, groups, refresh_tokens, secrets, tenants, users`), không FORCE; `API_ERRORS` 36 (34 + `BETA_GROUP_PROTECTED` 409, `NOT_ENTITLED` 409); `REFERENCE_FIELDS` thêm `feature_id, group_id, user_id, group_ids`. File: `tests/acceptance/ADM-NFR-06/migrate.int.test.ts`, `tests/acceptance/M1/{db-schema,db-rls}.int.test.ts`, `tests/acceptance/M2/{db-schema,db-rls}.int.test.ts`, `tests/acceptance/M{1,2}/rules/contracts.test.ts`. `truncate … cascade` hiện có tự xoá `groups`/`group_members`/`feature_grants` (FK tới tenants/users/features); **không** xoá `config_meta`.
- **Tên file acceptance đề xuất** (cột "Lệnh xong" của tasks dùng đúng tên; đổi tên thì sửa cùng lúc): `tests/acceptance/M3/rules/{contracts,config-payload,groups.rules,grants.rules,access.rules}.test.ts`; `tests/acceptance/M3/{db-schema,db-rls,groups,members,users-groups,grants,grants-batch,matrix,effective-access,command-access,hub-view,forbidden,error-codes,notify,concurrency}.int.test.ts`; e2e `e2e/{conflict,groups,access,m3-flow}.spec.ts` (+ `users`, `commands` sửa).
- **Mỗi file xanh được ở task của nó**: dữ liệu chéo module dựng bằng owner SQL (vd `grants.int.test.ts` ở T5 chèn entitlement bằng SQL; `effective-access` ở T6 chèn thành viên bằng SQL). `notify-{writes,noop,props}.int.test.ts` + `concurrency.int.test.ts` chạy ở T7 (cần bump ở M1/M2: A03 vế 2, A11 thu hồi entitlement).
- **Listener**: `postgres(TEST_DATABASE_URL).listen("config_changed", fn)` (kết nối riêng, đóng vai Hub); đo từ lúc response về tới lúc nhận ≤ 1 s; `v` = `select config_version from admin.config_meta`.
- **Hook**: fixture M3 truyền `testHooks` như M2 (`appEnv: "test"`); step mới `rows`, `bump`; op mới §2. Ném `{code:"40P01"}` ở `bump` để thử retry.
- **SQL `hub_ro`** (A10/A11/A03): `SET ROLE hub_ro` rồi chạy SQL §3.2.

## 11. Trả lời yêu cầu contract của frontend-lead (plan-frontend §9)
| # | Kết luận | Ghi chú (tên cuối ở spec §3) |
|---|---|---|
| C1 | **Chấp nhận có sửa** | cờ tên `is_beta` (không `is_builtin`; `beta-testers` là group tạo sẵn duy nhất); tenant dạng phẳng `tenant_id, tenant_key, tenant_name` như M2 (không lồng `tenant:{…}`); `description: string \| null` (một bản, R01) |
| C2 | **Chấp nhận** | thêm `role`, `added_at`, `added_by`; `other_groups` ≤ 3 (`GroupRef`) + `other_groups_total`; `DELETE …/members/:user_id` luôn 204 khi group thấy được |
| C3 | **Chấp nhận** | user bị khoá vẫn vào `added`; username sai định dạng / khác tenant → `not_found` |
| C4 | **Chấp nhận** | `dry_run?: boolean = false` trong body; không ghi, không bump/NOTIFY |
| C5 | **Chấp nhận có sửa** | `GET /admin/grants/matrix?tenant_id&group_id&limit&offset`; `features[].state ∈ core\|entitled\|revoked\|none` (đổi R09: thêm `none`, D11), `command_names` ≤ 10 + `command_count`, `granted_group_ids`; thêm `group_total`. Không có endpoint "feature cấp được" riêng: tab Feature dùng `?group_id` |
| C6 | **Chấp nhận có sửa** | `tenant_id` ở **query** (như `POST /admin/users`), không ở body. Lỗi **không** có `details.items`: `NOT_ENTITLED {feature_ids}` đánh dấu theo hàng (một feature chưa mở chặn cả hàng); `CORE_FEATURE_PROTECTED` không details (ô `core` vốn khoá); `INVALID_REFERENCE {field:"feature_ids"\|"group_ids", ids}` |
| C7 | **Chấp nhận có sửa** | features: `{feature: {id,key,name,status,is_core}, effective, reasons[], missing[]}`; commands: `{id, name, aliases, description, visible, via:[{feature, reasons}], blocked_by:[{feature, missing}], missing[], suggestion}` — "mỗi feature chặn một lý do" = `blocked_by[]`; user `tenant_id, tenant_key` phẳng; trần `commands` 1.000 + `command_total`. `?command=` vẫn có (qc, F4) dù FE không dùng |
| C8 | **Chấp nhận có sửa** | `groups` ≤ 50 (sắp beta đầu rồi key) + `group_count` trên **mọi** response `User`; `?group=<uuid>`; `PATCH /admin/users` không đổi |
| C9 | **Chấp nhận** | `groups: [{id, key, name, is_beta, feature: {id, key, name}}]` ≤ 20 (một mục = một cặp), `group_count` = tổng số cặp, `visible_user_count` |
| C10 | **Chấp nhận** | `GroupVersionConflictDetailsSchema = versionConflictDetailsSchema(GroupSchema)`; M2 đã export cho workflow/command/feature; tenant/user dùng `"tenant"`/`"user"` |
| C11 | **Chấp nhận** | `BETA_GROUP_PROTECTED`, `NOT_ENTITLED` (+ `NotEntitledDetailsSchema`) |
| C12 | **Chấp nhận** | `GROUP_KEY_RE`, `GROUP_NAME_MAX = 64`, `GROUP_DESC_MAX = 400`, `GROUP_PASTE_MAX = 500`, `GRANT_BATCH_MAX = 200`, `BETA_GROUP_KEY` |

## 12. DB test riêng mỗi agent (test-plan G4, TECH-DEBT #17) — làm ở T0
NOTIFY, `pg_stat_database.deadlocks` và hàng `config_meta` là trạng thái **chung của một database** → `notify-{writes,noop,props}.int`/`concurrency.int`/`lock-order.int` đỏ ngẫu nhiên khi nhiều agent cùng dùng `ai_system_test`. Role (`admin_rw`, `hub_ro`, `admin_api`) là của cả cluster nên dùng chung được; chỉ cần tách database.
- `packages/db/src/test-db.ts` thêm hàm thuần `testDbName(tag): string` (tag khớp `^[a-z0-9_]{1,24}$`, sai → ném; kết quả `ai_system_<tag>_test`, luôn hậu tố `_test` để `resetTestDb` chấp nhận) và `withDatabase(url, name): string` (thay pathname, giữ user/mật khẩu/host/cổng).
- `packages/db/src/test-db-cli.ts` (mới): `bun run db:test:create <tag>` = đọc `TEST_DATABASE_URL` từ `.env.local` → nối DB `postgres` cùng host bằng role owner → `CREATE DATABASE "ai_system_<tag>_test"` nếu chưa có (idempotent) → `runMigrations({url, appEnv: "test"})` (tạo role/quyền idempotent như M0) → ghi `.env.test-<tag>.local` = bản sao `.env.local` với `TEST_DATABASE_URL`, `TEST_ADMIN_API_DATABASE_URL` trỏ DB mới (file đã bị `.gitignore` `.env.*.local`) → in đường dẫn file. `bun run db:test:drop <tag>` = `DROP DATABASE IF EXISTS … WITH (FORCE)`, chỉ nhận tên do `testDbName` sinh (không bao giờ xoá DB không có hậu tố `_test`). Không bao giờ đụng `DATABASE_URL`.
- **Chốt dùng (readiness #9):** lệnh test tích hợp của T2–T7 chạy `bun --env-file=.env.test-be.local --config=bunfig.int.toml test --timeout 30000 <file…>` (backend, tag `be`); qc dùng `.env.test-qc.local` (tag `qc`). **e2e giữ `ai_system_test`** (`.env.local`). Nếu e2e cần DB riêng: chỉ truyền hai biến trên dòng lệnh, `TEST_DATABASE_URL=… TEST_ADMIN_API_DATABASE_URL=… bunx playwright test …` (config chỉ nạp `.env.local` và không ghi đè biến đã có). **Không** dùng `set -a; . file` — giá trị PEM chứa `\n` trong `.env` bị shell hiểu sai. Test không đổi (chỉ đọc env). `bun run test:int` giữ `ai_system_test` cho người chạy một mình.
- Hướng dẫn: `packages/db/README.md` mục "DB test riêng" (lệnh trên + quy ước tag = tên agent/worktree, vd `be`, `fe`, `qc`). Đóng TECH-DEBT #17 ở D1 (docs-architect).
- `package.json`: `"db:test:create": "bun --env-file=.env.local packages/db/src/test-db-cli.ts create"`, `"db:test:drop": "bun --env-file=.env.local packages/db/src/test-db-cli.ts drop"`. Test: `packages/db/src/test-db.test.ts` (tag hợp lệ/sai, hậu tố, `withDatabase` giữ thông tin đăng nhập).

## 13. Trả lời lỗ hổng test-plan (test-plan §10, phần backend)
| # | Kết luận |
|---|---|
| G1 | **Đúng: chỉ bảo vệ ở app.** Trigger `tenants_beta_group` chỉ **tạo** group, không chặn `DELETE`/đổi `key` bằng SQL. Xoá → 409 `BETA_GROUP_PROTECTED`; đổi key không có đường (PATCH strict không nhận `key`). Không thêm trigger chặn ở DB (R02 chỉ yêu cầu 409; owner/vận hành cần sửa tay được). qc không khẳng định chặn ở mức DB |
| G4 | Chấp nhận: §12, làm ở T0 |
| G6 | **Đúng:** không thao tác API nào ở M3 phát nhiều loại sự kiện trong một transaction (plan §5.3), nên `entity:"batch"` chỉ đạt được qua hàm thuần `configChangedPayload`. `notify` kỳ vọng entity theo bảng §5.3 |
| G7 | Op M1/M2 **đã có trong code** (`apps/admin-api/src/lib/test-hooks.ts`): `command.save`, `command.delete`, `feature.save`, `feature.delete`, `workflow.save`, step `locked`, `names`. M3 thêm `group.save`, `group.delete`, `group.members`, `grant.save`, `grant.batch`, `entitlement.save`, `tenant.save`, `user.save`, `secret.save`, step `rows`, `bump`. Step `bump` có ở **mọi** op đi qua `configWrite` (kể cả op M2 sau T7). qc được dùng mọi op trong danh sách này |
| G8 | Giới hạn 500 tính trên **số phần tử gửi lên, trước khi bỏ trùng** (zod `.max(500)` chạy trước transform) → 501 phần tử, dù trùng, → 400 |
| G9 | **Đúng:** M2 `revokeEntitlement` = `UPDATE … SET revoked_at = now() WHERE … AND revoked_at IS NULL` → đã thu hồi / chưa từng cấp → 204, 0 hàng đổi. T7 chỉ `changed` khi số hàng > 0 → không bump, không NOTIFY |
| G10 | Đúng như luật §4: user tenant `platform` thấy `core`; feature khác `missing` có `no_entitlement` (và `no_grant` nếu không có grant) |
| G12 | Đúng: `matrix.groups` sắp `beta-testers` đầu rồi `key`; `GroupListResponse = {items, total}` không `counts` (đã ghi spec §3) |
| G13 | Đúng: perf do backend đo ở `access.perf.int.test.ts` (T6), qc chạy lại ở VERIFY, không khoá |
