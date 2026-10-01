# Plan · M2-catalog-command (backend)

Tác giả: backend-lead · 2026-10-01 · Phần frontend: [`plan-frontend.md`](plan-frontend.md) (không lặp lại).
Contract (endpoint, schema từng trường, mã lỗi, thứ tự kiểm) và bảng dữ liệu là **nguồn chính ở `spec.md` §3–§4**; file này chỉ thêm phần hiện thực: file, SQL, định dạng mã hoá, chữ ký hàm thuần cho qc, luồng service, khoá hàng, test.
Symbol đã thấy trong code thật (đọc 2026-10-01): `ListQueryBase`, `listResponseSchema`, `ListCountsSchema`, `versionConflictDetailsSchema`, `API_ERRORS`, `ErrorCode`, `COMPANY_KEY_RE`, `IsoDateTime`, `UuidSchema`, `VersionSchema`, `CountSchema` (`@ai/contracts`); `withScope`, `setScope`, `Tx`, `Db`, `DbScope`, `features`, `tenants`, `users`, `agentWorkflows`, `admin` (`@ai/db`); `appError`, `AppError`, `parseJson`, `parseQuery`, `parseIdParam`, `parseWith`, `requireAuth`, `requireRole`, `AppVars`, `AuthDeps`, `Actor`, `uniqueViolation`, `safeErrorFields`, `likeArg`, `logger` (`apps/admin-api/src/lib`); `generateDevSecrets` (đã sinh `SECRET_MASTER_KEY`). Còn lại ghi "mới".

## 1. Phiên bản và thư viện
Không thêm thư viện, không ADR mới. Mã hoá = `node:crypto` (`createCipheriv`/`createDecipheriv` `aes-256-gcm`, `randomBytes`) của Bun 1.3.14 — đã chạy thử 2026-10-01: mã hoá/giải mã đúng, sai khoá → ném "Unsupported state or unable to authenticate data", 1.000 lần mã hoá 2.048 ký tự = 8,2 ms. drizzle-orm 0.45.3 / drizzle-kit 0.31.11 / postgres 3.4.9 như M1 (ADR-0003).

## 2. File

| File | Tạo/Sửa | Symbol / nội dung | Task |
|---|---|---|---|
| `packages/contracts/src/common.ts` | Sửa | hằng/regex/enum spec §3; `LocalizedTextSchema(max)`, `LocalizedOptionalSchema(max)`, `QueryBoolSchema`, `UpdatedBySchema` (`string \| null`), `pageResponseSchema(item)`; `listResponseSchema(item, counts = ListCountsSchema)` (tham số thứ 2 mới, mặc định giữ M1); 11 mã mới trong `API_ERRORS` + `*DetailsSchema` (spec §3 bảng mã) | T1 |
| `packages/contracts/src/{secrets,workflows,commands,features}.ts` (+ `*.test.ts`) | Tạo | schema/kiểu spec §3 (tên: `SecretSchema`, `SecretCreateRequestSchema`, `SecretReplaceRequestSchema`, `SecretNoteRequestSchema`, `SecretListQuerySchema`, `SecretListResponseSchema`, `WorkflowInputSchema`, `InputSchemaSchema`, `WorkflowListItemSchema`, `WorkflowSchema`, `WorkflowCreateRequestSchema`, `WorkflowUpdateRequestSchema`, `WorkflowListQuerySchema`, `WorkflowListResponseSchema`, `WorkflowUsagesSchema`, `CommandArgSchema`, `InputMapEntrySchema`, `InputMapSchema`, `CommandOutputSchema`, `InputMapWarningSchema`, `CommandListItemSchema`, `CommandSchema`, `CommandCreateRequestSchema`, `CommandUpdateRequestSchema`, `CommandListQuerySchema`, `CommandListResponseSchema`, `CommandAccessItemSchema`, `CommandAccessResponseSchema`, `FeatureRefSchema`, `FeatureListItemSchema`, `FeatureDetailSchema`, `FeatureCreateRequestSchema`, `FeatureUpdateRequestSchema`, `FeatureListQuerySchema`, `FeatureListResponseSchema`, `EntitlementSchema`, `EntitlementListResponseSchema`; kiểu TS cùng tên bỏ `Schema`) | T1 |
| `packages/contracts/src/index.ts` | Sửa | export 4 file mới | T1 |
| `apps/admin-api/src/lib/errors.ts` | Sửa | `MESSAGES` thêm 11 mã (bắt buộc vì `Record<ErrorCode, string>`); `KEY_TAKEN` → "Key is already taken" | T1 |
| `packages/db/src/schema/admin.ts` | Sửa | 6 bảng spec §4 + `features.updatedBy`; helper `updatedBy()` | T2 |
| `packages/db/migrations/0003_admin_catalog.sql`, `0004_catalog_rls.sql` (+ `meta/`) | Sinh / Tạo custom | §3.1 | T2 |
| `packages/db/src/index.ts` | Sửa | export `secrets`, `workflows`, `commands`, `commandNames`, `featureCommands`, `featureEntitlements` (mới) | T2 |
| `packages/db/src/catalog-rls.int.test.ts` | Tạo | §3.4 | T2 |
| `packages/db/src/migrate.int.test.ts` | Sửa | kỳ vọng `{main:5,dev:2}` / `{main:5,dev:0}` | T2 |
| `apps/admin-api/src/lib/secret-crypto.ts` (+ `.test.ts`) | Tạo | §3.2 | T3 |
| `apps/admin-api/src/config/env.ts` (+ test) | Sửa | `SECRET_MASTER_KEY` (refine `isMasterKeyB64`) | T3 |
| `apps/admin-api/src/app.ts`, `server.ts` | Sửa | `AppDeps.secretKey?: SecretKey` (mới, tuỳ chọn để giữ fixture M1); server: env → `parseMasterKey` → … ; mount `/admin/secrets` (T3), `/admin/features` (T4), `/admin/workflows` (T5), `/admin/commands` (T6) | T3–T6 |
| `apps/admin-api/src/modules/secrets/{README.md,secrets.routes.ts,secrets.service.ts,secrets.repo.ts,secrets.rules.ts,secrets.errors.ts,secrets.rules.test.ts,secrets.service.int.test.ts}` | Tạo | FR-50 | T3 |
| `apps/admin-api/src/modules/features/{README.md,features.routes.ts,features.service.ts,features.repo.ts,features.members.ts,features.rules.ts,features.errors.ts,features.rules.test.ts,features.service.int.test.ts}` | Tạo | FR-30/31/33/34; `features.members.ts` = ghi `feature_commands` (cả hai chiều) | T4 |
| `apps/admin-api/src/modules/workflows/{README.md,workflows.routes.ts,workflows.service.ts,workflows.repo.ts,workflows.hub.ts,workflows.rules.ts,workflows.errors.ts,workflows.rules.test.ts,workflows.service.int.test.ts}` | Tạo | FR-10/11/13/14/15; `workflows.hub.ts` = phát hiện + đọc `hub.agent_workflows` | T5 |
| `apps/admin-api/src/modules/commands/{README.md,commands.routes.ts,commands.service.ts,commands.repo.ts,commands.access.ts,commands.rules.ts,commands.errors.ts,commands.rules.test.ts,commands.service.int.test.ts,commands.perf.int.test.ts}` | Tạo | FR-20/21/22/24 (10 file, đúng trần CONVENTIONS §4) | T6 |
| `apps/admin-api/src/lib/lock-order.int.test.ts` | Sửa | thêm ca §5.1 | T6 |

Không sửa: `tools/scripts/src/keys-dev.ts` (đã sinh khoá), `.github/workflows/ci.yml` (đã chạy `keys:dev`), `.env.example` (đã có dòng trống). `playwright.config.ts` thuộc frontend-lead (FE0b).

## 3. DB và mã hoá

### 3.1 `0004_catalog_rls.sql` (custom; BUILD giữ đúng câu lệnh, mỗi lệnh một `--> statement-breakpoint`)
```sql
-- ADM-FR-50, ADM-FR-31, ADM-NFR-07 · RLS secrets (chỉ platform) + feature_entitlements (theo tenant); quyền hub_ro/admin_rw.
ALTER TABLE admin.secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY secrets_admin_rw ON admin.secrets FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform')
  WITH CHECK (current_setting('app.scope', true) = 'platform');
REVOKE ALL ON admin.secrets FROM hub_ro;
REVOKE ALL ON admin.secrets FROM PUBLIC;
-- admin-api không giải mã ở M2: không cho đọc bản mã kể cả khi có bug/SQL injection.
REVOKE SELECT ON admin.secrets FROM admin_rw;
GRANT SELECT (id, name, key_version, last4, note, created_at, updated_at, updated_by) ON admin.secrets TO admin_rw;
ALTER TABLE admin.feature_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY feature_entitlements_admin_rw ON admin.feature_entitlements FOR ALL TO admin_rw
  USING (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (current_setting('app.scope', true) = 'platform'
         OR (current_setting('app.scope', true) = 'tenant'
             AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
CREATE POLICY feature_entitlements_hub_ro ON admin.feature_entitlements FOR SELECT TO hub_ro USING (true);
```
Đã chạy thử trên Postgres 16.14 (transaction rollback, bảng thăm dò): `admin_api` scope platform INSERT … `RETURNING id, name`, `SELECT id, name … FOR NO KEY UPDATE`, `UPDATE … SET ct=…, note=… WHERE name=…` đều được; `SELECT ct` → `permission denied`; scope `tenant` → 0 hàng; `hub_ro` `SELECT name` → `permission denied`.
Hệ quả cho repo: mọi `select` trên `secrets` **liệt kê cột** (không `select()` trần, không `.returning()` trần). FK `workflows.secret_id` kiểm bằng quyền owner nên không cần SELECT bản mã.
`0003_admin_catalog.sql` do drizzle-kit sinh; nếu sinh `CREATE SCHEMA "admin"` thì sửa thành `IF NOT EXISTS` như M1 T2 (snapshot không đổi). Tên FK do drizzle-kit sinh (`<bảng>_<cột>_<bảng đích>_<cột>_fk`) — §7 dùng đúng tên sinh ra, ghi lại ở "Quyết định trong lúc làm".

### 3.2 Định dạng mã hoá (`apps/admin-api/src/lib/secret-crypto.ts`, mới) — contract với Hub (A7)
```ts
export type SecretKey = { version: number; key: Uint8Array };            // key đúng 32 byte
export const MASTER_KEY_B64_RE: RegExp;                                  // /^[A-Za-z0-9+/]{43}=$/
export function isMasterKeyB64(s: string): boolean;                      // khớp RE và base64 → 32 byte
/** Ném Error("SECRET_MASTER_KEY không hợp lệ") — không bao giờ đưa giá trị vào message. */
export function parseMasterKey(b64: string, version?: number): SecretKey; // version mặc định 1
export function secretAad(id: string, keyVersion: number): Uint8Array;    // UTF-8 `admin.secrets:${id}:${keyVersion}`
export type SealedSecret = { ciphertext: Uint8Array; iv: Uint8Array; keyVersion: number };
/** AES-256-GCM, IV 12 byte từ `rand` (mặc định crypto.randomBytes), ciphertext = bản mã ‖ tag 16 byte. */
export function encryptSecret(k: SecretKey, id: string, value: string, rand?: (n: number) => Uint8Array): SealedSecret;
/** Ném khi sai khoá/AAD/tag hoặc keyVersion ≠ k.version. Chỉ test và Hub (sau này) dùng; M2 không có route giải mã. */
export function decryptSecret(k: SecretKey, id: string, s: SealedSecret): string;
```
- Giải mã (Hub làm lại được): `iv` = cột `iv`; `tag` = 16 byte cuối `ciphertext`; AAD = `admin.secrets:<id dạng chuỗi uuid thường>:<key_version>`; khoá = base64-decode `SECRET_MASTER_KEY` (32 byte); plaintext UTF-8.
- Không HKDF: khoá dùng trực tiếp, tách miền bằng tiền tố AAD (`admin.secrets:`); dùng cho mục đích khác (M4 TOTP) phải có tiền tố riêng.
- Startup (`server.ts`): `loadEnv` (refine) → `parseMasterKey(env.SECRET_MASTER_KEY)` → `encryptSecret` + `decryptSecret` thử một lần với id nil (phát hiện môi trường crypto hỏng) → tiếp như M1. Lỗi → `fail("secret-key", …)` exit 1.
- `deps.secretKey` vắng (fixture M1) → `POST`/`PUT /admin/secrets` ném lỗi thường → 500 `INTERNAL_ERROR`, log `secret key not configured`. Fixture M2 của qc **phải** truyền `secretKey: parseMasterKey(<32 byte base64 sinh trong test>)`.

### 3.3 Đọc `hub.agent_workflows` (`workflows.hub.ts`, mới)
```ts
export async function hubAgentsReadable(tx: Tx): Promise<boolean>;
  // select coalesce(has_table_privilege(to_regclass('hub.agent_workflows'), 'SELECT'), false) as ok
export async function agentIdsByWorkflow(tx: Tx, workflowId: string, limit: number): Promise<{ ids: string[]; count: number }>;
export async function agentCounts(tx: Tx, workflowIds: readonly string[]): Promise<Map<string, number>>;
```
Đã kiểm trên DB dev: `to_regclass('nope.x')` = NULL (không lỗi), `has_table_privilege(NULL, …)` = NULL → `coalesce` = false. Hai hàm đọc chỉ được gọi khi `hubAgentsReadable` = true trong **cùng** transaction. List workflow cần `agent_count`/`attached` thì ghép SQL theo cờ (hai biến thể; không tham chiếu bảng hub khi cờ false để tránh lỗi parse 42P01).

### 3.4 Test RLS/quyền (`packages/db/src/catalog-rls.int.test.ts`, backend; qc có M2-AC01/02 riêng)
Reset → migrate(test) → owner chèn 2 tenant, 1 secret (bytea giả), 1 workflow, 1 entitlement mỗi tenant. Kết nối `TEST_ADMIN_API_DATABASE_URL`:
1. scope `tenant` → `admin.secrets` 0 hàng; `insert` secret → `42501`; scope `platform` → thấy, `insert/update/delete` được.
2. scope `platform`: `select ciphertext from admin.secrets` → `42501`; `select iv` → `42501`; `select id, name, last4, note, key_version, created_at, updated_at, updated_by` được.
3. `SET ROLE hub_ro` (từ owner): `select name from admin.secrets` → `42501`; `select * from admin.workflows/commands/command_names/feature_commands/features` được; `admin.feature_entitlements` thấy cả 2 tenant.
4. `feature_entitlements`: scope `tenant` acme → chỉ hàng acme; `insert` tenant khác → `42501`.
5. `has_table_privilege('hub_ro','admin.secrets','SELECT')` = false; `has_column_privilege('admin_rw','admin.secrets','ciphertext','SELECT')` = false.
6. `relrowsecurity`: đúng danh sách spec §4 (không FORCE).

## 4. Hàm thuần (`*.rules.ts`) — chữ ký chốt để qc viết test trước
Không import I/O. `RuleError = { code: ErrorCode; details?: unknown }` khai trong từng file (như M1). Kiểu `WorkflowInput`, `CommandArg`, `InputMap`, `InputMapEntry`, `InputMapWarning`, `FeatureStatus`, `CommandMode` lấy từ `@ai/contracts`.

```ts
// apps/admin-api/src/modules/secrets/secrets.rules.ts   [ADM-FR-50, BR-04]
export function secretLast4(value: string): string;                     // 4 code point cuối: Array.from(value).slice(-4).join("")
export function checkSecretDelete(usedBy: readonly string[]): RuleError | null;  // ≠ [] → SECRET_IN_USE {used_by}
```

```ts
// apps/admin-api/src/modules/workflows/workflows.rules.ts   [ADM-FR-10, 11, 13, 14, 15]
export type UsageCommand = { id: string; name: string; enabled: boolean };
export type Usages = { commands: UsageCommand[]; agents: { id: string }[] };
export function isUnattached(c: { commandCount: number; agentCount: number }): boolean;   // cả hai = 0
export function checkWorkflowDelete(u: Usages): RuleError | null;
  // có command hoặc agent → WORKFLOW_IN_USE {action:"delete", commands: u.commands, agents: u.agents}
export function checkWorkflowDisable(u: Usages): RuleError | null;
  // command enabled hoặc agent bất kỳ → WORKFLOW_IN_USE {action:"disable", commands: chỉ enabled, agents: u.agents}
/** Khoảng trống giữa schema và map: missing = input required không có khoá (thứ tự schema); unknown = khoá map không có trong schema (thứ tự khoá map). */
export function inputMapGaps(schema: readonly WorkflowInput[], map: InputMap): { missing: string[]; unknown: string[] };
export type MappedCommand = { id: string; name: string; inputMap: InputMap };
/** Command có gaps ≠ rỗng với schema mới, sắp theo name. */
export function findBrokenCommands(schema: readonly WorkflowInput[], cmds: readonly MappedCommand[]):
  { id: string; name: string; missing: string[]; unknown: string[] }[];
export function checkSchemaChange(schema: readonly WorkflowInput[], cmds: readonly MappedCommand[]): RuleError | null;
  // findBrokenCommands ≠ [] → SCHEMA_BREAKS_COMMANDS {commands}
export type WorkflowState = { name: string; description: string; appType: string; baseUrl: string; secretId: string;
  inputSchema: WorkflowInput[]; outputField: string | null; enabled: boolean };
/** Trường thực sự đổi (so sâu cho input_schema); [] → không ghi, không tăng version. */
export function changedWorkflowFields(cur: WorkflowState, next: WorkflowState): (keyof WorkflowState)[];
```

```ts
// apps/admin-api/src/modules/commands/commands.rules.ts   [ADM-FR-20, 21, 22, BR-01, 02, 06, 10]
export function commandNames(c: { name: string; aliases: readonly string[] }): string[];  // [name, ...aliases]
export function defaultTimeout(mode: CommandMode): number;              // sync 30, async 120
export type MapCheck = { missing: string[]; unknown: string[]; unknown_args: string[] };
/** missing/unknown = inputMapGaps; unknown_args = value của entry source=arg không có trong args (thứ tự khoá map, không trùng). */
export function checkInputMap(schema: readonly WorkflowInput[], args: readonly CommandArg[], map: InputMap): MapCheck;
export function inputMapError(c: MapCheck): RuleError | null;           // bất kỳ mảng ≠ [] → INPUT_MAP_INVALID {missing, unknown, unknown_args}
/** Cảnh báo theo thứ tự schema, chỉ cho khoá có trong schema:
 *  type_mismatch: (type=file ∧ source≠attachment) ∨ (source=attachment ∧ type≠file)
 *                 ∨ (type∈{number,boolean,select} ∧ source∈{selection,page_url,page_text,user_id,tenant_id});
 *  const_invalid: source=const ∧ ((number ∧ (trim rỗng ∨ !isFinite(Number(v)))) ∨ (boolean ∧ v∉{"true","false"})
 *                 ∨ (select ∧ v∉options)). source=arg không bao giờ cảnh báo (giá trị do người gõ). */
export function inputMapWarnings(schema: readonly WorkflowInput[], map: InputMap): InputMapWarning[];
export function checkCommandFeatures(featureIds: readonly string[]): RuleError | null;   // [] → COMMAND_NEEDS_FEATURE (không details)
export function checkCommandEnable(enabled: boolean, wf: { id: string; key: string; enabled: boolean }): RuleError | null;
  // enabled ∧ !wf.enabled → WORKFLOW_DISABLED {workflow:{id,key}}
export type CommandState = { name: string; aliases: string[]; description: { vi: string; en?: string }; workflowId: string;
  args: CommandArg[]; inputMap: InputMap; output: { field: string; render: string }; mode: CommandMode;
  timeoutS: number; enabled: boolean; featureIds: string[] };
/** featureIds so như tập (không thứ tự); aliases so theo thứ tự; jsonb so sâu. */
export function changedCommandFields(cur: CommandState, next: CommandState): (keyof CommandState)[];
```

```ts
// apps/admin-api/src/modules/features/features.rules.ts   [ADM-FR-30, 31, 33, 34, BR-10, 12]
export const CORE_FEATURE_KEY = "core";
export function isCore(f: { key: string }): boolean;
export function checkFeatureStatus(f: { key: string }, next: FeatureStatus | undefined): RuleError | null;
  // core ∧ next ∉ {undefined, "on"} → CORE_FEATURE_PROTECTED
export function checkFeatureDelete(f: { key: string }, exclusive: readonly { id: string; name: string }[]): RuleError | null;
  // core → CORE_FEATURE_PROTECTED; exclusive ≠ [] → FEATURE_HAS_EXCLUSIVE_COMMANDS {commands: exclusive}
export function checkEntitlementTarget(f: { key: string }): RuleError | null;            // core → CORE_FEATURE_PROTECTED
/** featureCount = số feature hiện có của command (gồm feature đang sửa); bỏ khỏi feature này mà featureCount ≤ 1 → mồ côi. */
export function orphanedByRemoval(removed: readonly { id: string; name: string; featureCount: number }[]):
  { id: string; name: string }[];
export function membershipError(orphans: readonly { id: string; name: string }[]): RuleError | null;
  // ≠ [] → COMMAND_NEEDS_FEATURE {commands: orphans}
export function isFeatureEffective(status: FeatureStatus): boolean;     // on | beta (R23)
export function diffIds(cur: readonly string[], next: readonly string[]): { added: string[]; removed: string[] };  // sắp tăng dần
export type FeatureState = { name: { vi: string; en?: string }; description: { vi?: string; en?: string };
  icon: string; status: FeatureStatus; commandIds: string[] };
export function changedFeatureFields(cur: FeatureState, next: FeatureState): (keyof FeatureState)[];
```

## 5. Luồng service
Ký hiệu `W{…}` = một `withScope(db, platform, …)`; callback **chỉ làm việc DB + tính toán cục bộ** (TECH-DEBT #13). `Call = { ctx: { db; secretKey? }; actor: Actor; scope: DbScope }` (như `users.service`). Ghi = set `updated_by = actor.userId`, `updated_at = now()`, `version = version + 1` (trừ secrets). 404 khi không thấy hàng. `VERSION_CONFLICT` so trên bản **đã khoá** (đọc lại sau khi khoá), như M1.

**Secrets.** List: một query trang (`count(*) over()`) + `used_by` bằng subquery `array(select w.key … order by w.key)` + một query `counts`. Tạo: `id = v7` → `encryptSecret(key, id, value)` → savepoint `insert` (23505 `secrets_name_uq` → `SECRET_NAME_TAKEN`) → đọc lại. PUT: `select id … where name for no key update` → encrypt (IV mới) → `update ciphertext, iv, key_version, last4, updated_*`. PATCH: khoá như PUT → `update note` (không đụng bản mã). DELETE: khoá → `used_by` → `checkSecretDelete` → `delete` (23503 FK `workflows.secret_id` → đọc lại `used_by` trong savepoint → `SECRET_IN_USE`).

**Features.** Tạo: `features.members.lockCommands(tx, command_ids)` (`for no key update`, id tăng; thiếu → `INVALID_REFERENCE {field:"command_ids"}`) → savepoint `insert` (23505 `features_key_uq` → `KEY_TAKEN`) → `insert feature_commands` → bump `version` các command thêm vào. PATCH: đọc feature (404) → nếu có `command_ids`: khoá **commands** (cũ ∪ mới, id tăng) → khoá feature `for no key update` → đọc lại, so `version` → `checkFeatureStatus` → `diffIds` → `INVALID_REFERENCE` (id mới không tồn tại) → `orphanedByRemoval` (đếm feature của command bị bỏ, trên hàng đã khoá) → `membershipError` → `changedFeatureFields` (rỗng → trả hiện tại) → ghi feature + `feature_commands` + bump command đổi tập. DELETE: khoá feature → `checkFeatureDelete` (command độc quyền: `fc.feature_id=$id and not exists (fc2.command_id = fc.command_id and fc2.feature_id <> $id)`) → `delete` (cascade). Entitlement PUT: `select feature for share` → `checkEntitlementTarget` → tenant tồn tại (404) → `insert … on conflict (feature_id, tenant_id) do update set revoked_at = null, granted_by = $actor, granted_at = now() where feature_entitlements.revoked_at is not null` → đọc lại. DELETE: như PUT tới bước tenant → `update set revoked_at = now() where … and revoked_at is null`.
Xuất cho module khác (`features.service`): `coreFeatureId(tx): Promise<string>`; `setCommandFeatures(tx, a: { commandId: string; featureIds: string[]; actorId: string }): Promise<void>` (khoá features `for no key update` id tăng; thiếu → `INVALID_REFERENCE {field:"feature_ids"}`; diff; ghi `feature_commands`; bump `version` feature đổi tập); `featureRefsByCommands(tx, ids): Promise<Map<string, FeatureRef[]>>`.

**Workflows.** Tạo: `secrets.service.lockSecretRef(tx, secretId)` (`for share`; thiếu → `INVALID_REFERENCE {field:"secret_id"}`) → savepoint `insert` (23505 `workflows_key_uq` → `KEY_TAKEN`). PATCH: khoá workflow `for no key update` → đọc lại, `version` → ghép trạng thái → `changedWorkflowFields` (rỗng → trả hiện tại) → nếu đổi `secret_id`: `lockSecretRef` → nếu `enabled` true→false: usages (`hubAgentsReadable` + commands của workflow) → `checkWorkflowDisable` → nếu đổi `input_schema`: đọc `input_map` mọi command của workflow → `checkSchemaChange` → ghi. DELETE: khoá `for no key update` → usages → `checkWorkflowDelete` → `delete` (23503 FK `commands.workflow_id` → đọc lại usages trong savepoint → `WORKFLOW_IN_USE`). Usages: `commands … where workflow_id order by name limit 200` + `count`, agent theo §3.3.
Xuất (`workflows.service`): `lockWorkflowRef(tx, id): Promise<{ id; key; name; enabled; inputSchema: WorkflowInput[] } | null>` (`for share`).

**Commands.** Tạo/PATCH (trên trạng thái ghép):
1. PATCH: đọc command không khoá (404) để biết `workflow_id` của trạng thái ghép.
2. `lockWorkflowRef(tx, workflowId)` (`for share`; chưa báo lỗi nếu thiếu — giữ kết quả `null`).
3. PATCH: khoá command `for no key update` → đọc lại → `version` → ghép → `changedCommandFields` (rỗng → trả hiện tại kèm `warnings`).
4. Luật theo đúng thứ tự spec §3: `checkCommandFeatures(featureIds)` (POST vắng `feature_ids` → `[coreFeatureId]`) → workflow `null` → `INVALID_REFERENCE {field:"workflow_id"}` → feature id không tồn tại (đọc không khoá) → `INVALID_REFERENCE {field:"feature_ids", ids}` → tên: `select name from command_names where name = any($names) and command_id <> $id` → có → `COMMAND_NAME_TAKEN {name: tên đầu tiên theo thứ tự [name, ...aliases]}` → `checkInputMap` + `inputMapError` → `checkCommandEnable`.
5. Ghi `commands` (savepoint; 23505 `commands_name_uq`/`command_names_pkey` → tra lại tên trong savepoint mới → `COMMAND_NAME_TAKEN`); `command_names`: xoá tên không còn, chèn tên mới; `setCommandFeatures` (khoá features **sau** khoá command; feature bị xoá giữa bước 4 và 5 → `INVALID_REFERENCE`).
6. Trả `Command` + `warnings = inputMapWarnings(schema, map)`.
DELETE: khoá command `for no key update` → bump `version` các feature chứa nó → `delete` (cascade). Access (`commands.access.ts`): một query: tenants có ≥ 1 feature của command với `status in ('on','beta')` và (`key='core'` ∨ entitlement chưa thu hồi), `json_agg` feature, `active_user_count` subquery, `count(*) over()`, `order by t.key limit/offset`.

### 5.1 Khoá hàng (bài học M1 N1)
Chỉ hai chế độ tường minh: `FOR NO KEY UPDATE` (sắp ghi hàng đó) và `FOR SHARE` (giữ hàng được tham chiếu không bị sửa/xoá tới khi commit). Không `FOR UPDATE` tường minh; `DELETE` tự nâng lên khoá xoá **sau** khi đã giữ `NO KEY UPDATE` (mọi tx muốn tham chiếu hàng đó phải lấy `FOR SHARE` trước → đang chờ, không giữ gì → không vòng). FK khi `INSERT` lấy `FOR KEY SHARE` (không xung đột `NO KEY UPDATE`; xung đột khoá xoá) — đó là lý do mọi tham chiếu phải khoá `FOR SHARE` trước, không dựa vào FK.
Thứ tự toàn cục: **workflows → commands (id tăng) → features (id tăng) → secrets**; tenants chỉ bị FK `KEY SHARE` (entitlement), không khoá tường minh ở M2.

| Thao tác | Khoá (theo thứ tự) | Chặn đua gì |
|---|---|---|
| Command POST/PATCH | workflow `SHARE` → command `NKU` → features `NKU` | tắt/đổi schema/xoá workflow song song; xoá feature / bỏ command khỏi feature song song |
| Command DELETE | command `NKU` → features `NKU` (bump) | feature PATCH tập command |
| Feature PATCH có `command_ids` / POST | commands `NKU` (id tăng) → feature `NKU` | command PATCH `feature_ids` (BR-10 không mồ côi) |
| Feature PATCH không `command_ids` | feature `NKU` | — |
| Feature DELETE | feature `NKU` | command PATCH thêm vào/bỏ khỏi feature; entitlement PUT |
| Entitlement PUT/DELETE | feature `SHARE` | xoá feature |
| Workflow PATCH | workflow `NKU` → secret `SHARE` (khi đổi) | command POST/PATCH (chờ `SHARE` workflow) |
| Workflow DELETE | workflow `NKU` | command POST trỏ vào |
| Workflow POST | secret `SHARE` | xoá secret |
| Secret PUT/PATCH/DELETE | secret `NKU` | workflow POST/PATCH trỏ vào |

Không tx nào giữ khoá của bậc sau rồi xin khoá bậc trước → không deadlock giữa các luồng M2; `withScope` vẫn chạy lại 40P01/40001 làm lưới an toàn. Test (T6, `lib/lock-order.int.test.ts`): xen kẽ (a) command PATCH bỏ feature G ∥ feature G PATCH bỏ cùng command → đúng một thành công, command còn ≥ 1 feature; (b) command POST `enabled=true` ∥ workflow PATCH `enabled=false` → không có command bật trỏ workflow tắt; (c) feature DELETE ∥ command PATCH chỉ còn feature đó → 409 hoặc 400 `INVALID_REFERENCE`, không mồ côi. Mỗi ca: `pg_stat_database.deadlocks` không tăng, xong < 900 ms.

## 6. App
- `AppDeps` thêm `secretKey?: SecretKey` (mới). `mountApi` thêm 4 route group, mỗi group `r.use("*", requireAuth(d), requireRole("platform_admin"))` trước mọi parse (kiểm role trước, M2-AC01). Route handler ≤ 30 dòng: parse contract → service.
- `parseNameParam(c)` (mới, `lib/http.ts`): `:name` khớp `SECRET_NAME_RE` nguyên văn, sai → `NOT_FOUND`; `parseIdParam` (M1) cho `:id`, `:tenant_id`.
- **Hook thử nghiệm (G8, mới):** `AppDeps.testHooks?: TestHooks` với `type TestHooks = { afterLock?: (op: "command.save" | "command.delete" | "feature.save" | "feature.delete" | "workflow.save", step: "locked") => Promise<void> }`. `createApp` chỉ chuyển `testHooks` xuống service khi `appEnv === "test"` (production/development: luôn `undefined`). Service gọi `await hooks?.afterLock?.(op, "locked")` ngay sau khi giữ đủ khoá, trước bước kiểm luật/ghi — chỉ đợi một Promise do test giữ, không I/O (TECH-DEBT #13). Test dùng cặp "barrier" (Promise mở bằng tay) để: (a) command PATCH bỏ feature G dừng sau khoá → feature G PATCH bỏ cùng command phải **chờ** (kiểm bằng `pg_locks`/`pg_stat_activity.wait_event_type='Lock'`) → mở → đúng một thành công, command còn ≥ 1 feature; (b) command POST `enabled=true` dừng sau khoá workflow `SHARE` → workflow PATCH `enabled=false` chờ → mở → workflow PATCH nhận `WORKFLOW_IN_USE`; (c) feature DELETE dừng sau khoá → command PATCH chỉ còn feature đó chờ → mở → command nhận `INVALID_REFERENCE`, không mồ côi. Mỗi ca: `deadlocks` không tăng, < 900 ms sau khi mở. Thay seam `beforeVerify` kiểu M1 (TECH-DEBT #12): hook nằm ở `AppDeps`, không trong type service production.
- Log: giữ request log M1 (không body/header). Với `/admin/secrets*` chỉ log `path` thuần, không query string (G7).
- `VALIDATION_ERROR` ở `/admin/secrets*` (G12): `secrets.routes.ts` dùng `parseSecretBody(c, schema)` (mới) bọc `parseWith`: `message` của mọi issue = chuỗi tĩnh theo `code` (`"invalid"`, `"too_small"`…), issue `unrecognized_keys` → `{path: [], code: "unrecognized_keys", message: "unrecognized keys"}` (không nêu tên khoá). Không thêm log nào chứa trường của `/admin/secrets*`; lỗi 500 qua `safeErrorFields` (không log tham số Drizzle — tham số chỉ có bản mã, không có giá trị rõ).

## 7. Lỗi Postgres → mã
| SQLSTATE · constraint | Mã | Nơi |
|---|---|---|
| 23505 `secrets_name_uq` | `SECRET_NAME_TAKEN` | secrets POST |
| 23505 `workflows_key_uq` / `features_key_uq` | `KEY_TAKEN` | workflows/features POST |
| 23505 `commands_name_uq` / `command_names_pkey` | `COMMAND_NAME_TAKEN {name}` (tra lại trong savepoint) | commands POST/PATCH (M2-AC03 song song) |
| 23503 FK `workflows.secret_id` | `SECRET_IN_USE` (đọc lại `used_by`) | secrets DELETE |
| 23503 FK `commands.workflow_id` | `WORKFLOW_IN_USE` (đọc lại usages) | workflows DELETE |
| 23503 FK khác khi INSERT | `INVALID_REFERENCE` (lưới an toàn; đã khoá `SHARE` nên không mong gặp) | mọi ghi |
Bọc mỗi câu có thể lỗi trong savepoint (`tx.transaction`, như M1 T6) để dịch mã mà không hỏng transaction ngoài.

## 8. Test của backend (ngoài acceptance của qc)
| File | Loại | Phủ |
|---|---|---|
| `packages/contracts/src/{secrets,workflows,commands,features,common}.test.ts` | unit | strict, biên min/max/regex, superRefine (trùng tên, `rest` cuối, `options` ↔ `select`), `en` rỗng bị bỏ, `API_ERRORS` 34 mã |
| `packages/db/src/catalog-rls.int.test.ts`, `migrate.int.test.ts` | int | §3.4; đếm migration |
| `apps/admin-api/src/lib/secret-crypto.test.ts` | unit | khứ hồi; IV/bản mã khác nhau mỗi lần; sai khoá / sai id / sai `key_version` / sửa 1 byte tag → ném; `rand` giả tất định; `isMasterKeyB64` (43+`=`, 31/33 byte, ký tự lạ) |
| `apps/admin-api/src/config/env.test.ts` | unit | thiếu/sai `SECRET_MASTER_KEY` → message chỉ có tên biến |
| `apps/admin-api/src/modules/*/*.rules.test.ts` | unit | mọi hàm §4 |
| `apps/admin-api/src/modules/secrets/secrets.service.int.test.ts` | int | tạo/PUT/PATCH/DELETE; đọc bản mã bằng owner + `decryptSecret` ra đúng giá trị; log bắt được (spy `console`) không chứa giá trị |
| `apps/admin-api/src/modules/features/features.service.int.test.ts` | int | core bảo vệ; tập command thay cả tập; bump version hai chiều; entitlement thu hồi/cấp lại cùng hàng |
| `apps/admin-api/src/modules/workflows/workflows.service.int.test.ts` | int | chặn tắt/xoá; schema phá command; `agents_available=false` khi owner `REVOKE SELECT ON hub.agent_workflows FROM admin_rw` (GRANT lại trong `finally`; không DROP để file khác không phụ thuộc thứ tự) |
| `apps/admin-api/src/modules/commands/commands.service.int.test.ts` | int | trùng tên/alias, song song cùng tên, input map, WORKFLOW_DISABLED, mặc định `core`, access |
| `apps/admin-api/src/modules/commands/commands.perf.int.test.ts` | int | ngân sách spec §6 (20 lần, p95) |
| `apps/admin-api/src/lib/lock-order.int.test.ts` | int | §5.1 |

## 9. Rủi ro
- **Mã khoá M1 đổi theo M2** (A12): 5 file test khoá đỏ sau T1/T2 cho tới khi qc sửa ở Q2 — thay đổi phạm vi dự kiến, không phải tranh chấp. Thứ tự task: T1 → Q2 → T2.
- **Thiếu `SECRET_MASTER_KEY` ở e2e** sau T3: admin-api không lên → mọi e2e đỏ. FE0b phải xong trước lần chạy `bunx playwright test` đầu tiên sau T3.
- **Quyền cột trên `secrets`**: Drizzle `select()` trần hoặc `.returning()` trần → `42501` lúc chạy. Unit test service phủ mọi câu; review kiểm.
- **Hub mồ côi**: hàng `hub.agent_workflows` thêm cùng lúc xoá workflow (Admin không khoá được bảng hub) → TECH-DEBT, Hub tự kiểm (§4 spec).
- **jsonb lệch schema** (sửa tay DB): đọc lại parse zod, lỗi → 500 có log tên bảng/id, không đoán.
- **Mảng lồng không phân trang** (`used_by`, `features` của command, `commands` của feature detail, chi tiết `WORKFLOW_IN_USE`): bị chặn bởi kích thước catalog (vài trăm); `usages` có trần 200 + đếm.
- **`core` + `command_ids`** (G5): được phép như feature khác; chỉ `status`, xoá, entitlement bị chặn.
- **Bump version hai chiều** làm editor bên kia nhận 409 thường hơn (vd tạo command trong `core` tăng `version` của `core`) — chủ đích (chống ghi đè), modal 409 là M3.

## 10. Ghi chú cho qc (Q1/Q2)
- **Sửa test khoá cũ** (A12; số liệu spec §9 A12): `tests/acceptance/ADM-NFR-06/migrate.int.test.ts` (đếm `{main:5,dev:2}` ×3 chỗ, `[5,2]`, production `{main:5,dev:0}`, `ADMIN_TABLES` 10 bảng); `tests/acceptance/M1/db-schema.int.test.ts:69-90,273-280` (đếm, 10 bảng, bỏ `secrets/workflows/commands` khỏi danh sách "bảng mốc sau"; `clean()` truncate `features cascade` vẫn đúng); `tests/acceptance/M1/db-rls.int.test.ts:242-250` (10 dòng `relrowsecurity`); `tests/acceptance/M1/rules/contracts.test.ts:29-55` (23 mã M1 giữ nguyên status, tổng 34); `tests/acceptance/M1/error-codes.int.test.ts:145` (tập đã phủ = mã M1, không phải mọi `API_ERRORS`).
- **Tên file acceptance đề xuất** (lệnh xong trong `tasks.md` dùng đúng các tên này; qc đổi tên thì sửa cột "Lệnh xong" cùng lúc): `tests/acceptance/M2/rules/{contracts,secret-crypto,secrets.rules,workflows.rules,commands.rules,features.rules}.test.ts`; `tests/acceptance/M2/{db-schema,db-rls,secrets,features,workflows,commands,access,forbidden,error-codes}.int.test.ts`; e2e `e2e/{secrets,workflows,features,commands,m2-flow}.spec.ts`.
- **Mỗi file phải xanh được ở task của nó**: dữ liệu chéo module dựng bằng **owner SQL**, không qua API của module làm sau (vd `features.int.test.ts` ở T4 chèn command bằng SQL để thử `FEATURE_HAS_EXCLUSIVE_COMMANDS`; `workflows.int.test.ts` ở T5 chèn command bằng SQL cho AC-A05). `forbidden`, `error-codes`, `access` chạy ở T6.
- **Fixture app**: như `tests/acceptance/M1/_fixtures.ts` + `secretKey: parseMasterKey(randomBytes(32).toString("base64"))` từ `apps/admin-api/src/lib/secret-crypto.ts` (nạp động như `_modules.ts`). AC-A05 agent: owner `insert into hub.agent_workflows (agent_id, workflow_id) values (…)`.
- **Quét rò secret (AC-A06)**: dùng giá trị có dấu hiệu riêng (vd `sk-LEAK-` + 24 ký tự ngẫu nhiên); kiểm không xuất hiện trong: mọi response `/admin/secrets*` (kể cả 400/409), `GET /admin/workflows*`, stdout/stderr server con, bản mã đọc bằng owner (không chứa chuỗi rõ), HTML/`page.content()` + `localStorage` trên e2e. `admin_api` `select ciphertext` → `42501`.
- `INPUT_MAP_INVALID`: kiểm `details.missing` = `["target_lang"]`, **không** kiểm `message` chứa tiếng Việt (message cố định "Invalid input map"); chuỗi "thiếu input bắt buộc: target_lang" kiểm ở e2e.

## 11. Trả lời yêu cầu contract của frontend-lead (plan-frontend §9)
| # | Kết luận | Ghi chú |
|---|---|---|
| Y1 | **Chấp nhận (nhánh 2)**: response secret có `id`; workflow gửi `secret_id`, nhận `secret: {id, name}`. **Chấp nhận** `GET /admin/features/:id/entitlements` | Không đổi sang tham chiếu theo `name`: FK theo id thống nhất với command → workflow; tên vẫn hiện qua `secret.name`. Entitlement dạng phẳng như đề xuất + `tenant_active`; bọc `{items, total}` có phân trang (CONVENTIONS §6), `core` rỗng |
| Y2 | **Chấp nhận** | `commands[]` có thêm `enabled`; `COMMAND_NEEDS_FEATURE.details.commands` khi bỏ command khỏi feature cuối |
| Y3 | **Chấp nhận** | `features[]` có thêm `status`; `?feature=`/`?workflow=` nhận uuid; counts `{all,on,off}`, `?status=on\|off` |
| Y4 | **Chấp nhận** | `warnings[]` có ở mọi response `Command` (GET cũng có, tính lại); `feature_ids` có cùng `features` |
| Y5 | **Chấp nhận** | `secret` = `{id, name}`; `?status=on\|off`, `?attached=`; usages thêm `command_count`, `agent_count`, `agents_available` |
| Y6 | **Chấp nhận `PATCH /admin/secrets/:name {note}`**; `used_by: string[]` (key) | `PUT` chỉ nhận `{value}` (một việc một endpoint, R04) |
| Y7 | **Chấp nhận có sửa** | `{items:[{tenant_id, tenant_key, tenant_name, tenant_active, features:[{id,key,name}], active_user_count}], total, command_active}` có phân trang thay vì `{tenants:[…]}` |
| Y8 | **Chấp nhận mặc định FE** | `fallback ∈ {selection, page_url, page_text} \| null`; `output.field` bắt buộc |
| Y9 | **Chấp nhận** | thêm `is_core`; `icon` null trong DB → `"package"` |
| Y10 | **Chấp nhận** | `updated_by` = username \| null; entitlement `granted_by` cũng là username |
| §8 `KEY_TAKEN` | **Đúng như FE** | không có `WORKFLOW_KEY_TAKEN`/`FEATURE_KEY_TAKEN`; `NAME_TAKEN` không tồn tại, dùng `SECRET_NAME_TAKEN` |
