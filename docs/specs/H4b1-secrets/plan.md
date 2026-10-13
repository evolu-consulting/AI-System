---
spec: H4b1-secrets
part: backend
owner: backend-lead
status: plan (2026-10-13, chờ qc/readiness/Gate)
requirements: [HUB-FR-68, HUB-FR-69, HUB-FR-04, HUB-BR-30, HUB-BR-15, HUB-FR-131]
---

# Plan backend · H4b-1 Secrets

Contract đầy đủ: spec §3. Dữ liệu: spec §4. Câu hỏi: spec §9 (Q1–Q12). File này: quyết định, file, hàm thuần, luồng, thứ tự task.

## 0. Quyết định (D)
| # | Quyết định | Lý do |
|---|---|---|
| D1 | Mã hoá bằng `node:crypto` AES-256-GCM, không thư viện ⇒ không ADR | Đã có mẫu `apps/admin-api/src/lib/secret-crypto.ts`; Bun hỗ trợ đủ |
| D2 | Module mới `apps/hub-api/src/modules/secrets/` có **crypto riêng** (`secrets.crypto.ts`), không dùng lại `lib/secret-crypto.ts` (định dạng contract với Admin, chỉ giải mã, AAD `admin.secrets:`) | Tách miền khoá (HUB-FR-04); không chạm luồng Dify |
| D3 | AAD = UTF-8 `hub.secrets:<id>:<kind>:<tenant_id \| "-">:<key_version>` | Spec Q2 + tiền tố miền + chừa xoay khoá |
| D4 | `id` sinh ở app (`crypto.randomUUID()`) **trước** khi mã hoá, rồi INSERT với id đó | AAD cần id |
| D5 | `kind`, `tenant_id`, `name` bất biến sau tạo | AAD bất biến; đổi = xoá + tạo |
| D6 | Cột `ciphertext`/`iv` không GRANT SELECT cho `hub_rw`; đọc chỉ qua `hub.secret_material(...)` SECURITY DEFINER | Lộ SQL injection/`select *` cũng không ra bản mã; mẫu `hub.workflow_secret` (0003) |
| D7 | Drizzle `hubSecrets` khai đủ cột (để INSERT/UPDATE có kiểu) nhưng repo **chỉ** select danh sách `SECRET_META_COLS`; không `db.select().from(hubSecrets)` | `select *` ⇒ 42501 do GRANT cột |
| D8 | Mọi ghi qua `withConfigWrite` (khoá `config_meta` → ghi → bump → audit → NOTIFY). Thêm tham số tuỳ chọn `scope?: HubScope` (mặc định `system`); route tenant chạy scope `user` của tenant đích ⇒ RLS chặn thêm một lớp. Giữ nguyên; nếu A44/A45 cho thấy JOIN `admin.*` (tenants/users) bị RLS lọc ở scope `user` thì đọc `admin.*` qua `withHubScope(system)` riêng và ghi "Quyết định trong lúc làm" | HUB-FR-69; phòng thủ nhiều lớp cho cách ly tenant |
| D9 | XOÁ cứng hàng (bản mã mất cùng hàng); `used_by` kiểm trước, FK RESTRICT (providers) là chốt cuối — 23503 ⇒ `SECRET_IN_USE` | Crypto-shred; không cần soft delete |
| D10 | `HUB_SECRETS_KEY` bắt buộc trong env schema (mọi môi trường); trùng `SECRET_MASTER_KEY` ⇒ fatal; tự kiểm seal/open lúc boot | Spec §2, AC-06, HUB-FR-04 |
| D11 | `AppDeps.hubSecretsKey?: SecretKey \| null` — vắng (chỉ test app không truyền) ⇒ POST/PUT có `value` trả 409 `NOT_CONFIGURED`; list/get/delete vẫn chạy | Không phải sửa mọi test `createApp` cũ |
| D12 | `useSecret(ref, fn)` dạng callback, không cache bản rõ; không bao giờ log/ném giá trị | HUB-BR-30, HUB-FR-04 |
| D13 | Route tenant `/admin/source-credentials*` dùng lại ngữ nghĩa `readTenant`/`writeTenant` của nguồn (bản riêng ném `NOT_FOUND`) | Nhất quán với `/admin/sources` |
| D14 | `used_by` của nhiều secret lấy **một** query gộp (`usedByMany(tx, ids)`) — không N+1 trong list | CONVENTIONS §6 |
| D15 | `kh_api_key` cho phép tenant hoặc nền tảng; chỉ platform_admin ghi; giá trị mờ đục (có thể JSON) | Q7 (khảo sát KH v6.4) |
| D17 | Không `last4`/`note` (Q11); `used_by` = `{type, id, key}`, `tenant` = `{id,key,name}`; list Studio vắng `tenant_id` ⇒ mọi secret (khớp plan-frontend D5/C1). FE cần sửa: DELETE có `?version=`, mã `SECRET_NAME_TAKEN`, `used_by` không có `name` | Thống nhất contract với FE |
| D16 | Logger: module secrets chỉ log `{ secret_id, kind, failure }`, không bao giờ truyền giá trị vào logger; **không** đổi `SENSITIVE_KEY` của logger (ngoài phạm vi) | Luật 4 |

## 1. File
| File | Việc | Task |
|---|---|---|
| `packages/contracts/src/hub-admin/secrets.ts` (+ export `index.ts`, test `secrets.test.ts` cạnh) | Schema spec §3 + `HUB_SECRET_ERRORS` | T4 |
| `packages/db/migrations-hub/0028_h4b1_secrets.sql` + `meta/_journal.json` idx 28 | DDL spec §4 | T4 |
| `packages/db/src/schema/hub-secrets.ts` | Drizzle `hubSecrets`, `HUB_SECRET_KIND_VALUES`, `SECRET_AUDIT_ACTIONS = ["rotate"]`, `SECRET_AUDIT_ENTITIES = ["secret"]` | T4 |
| `packages/db/src/schema/hub.ts` | Trải hai mảng audit vào `HUB_AUDIT_*_VALUES` (file đang 400 dòng ⇒ gộp dòng import/rút comment dòng 2 để giữ ≤ 400) | T4 |
| `packages/db/src/hub-h4b1.int.test.ts` | GRANT cột (42501 khi select ciphertext bằng `hub_api`), RLS, `secret_material`, FK, CHECK | T4 |
| `apps/hub-api/src/config/env.ts` · `server.ts` | `HUB_SECRETS_KEY` bắt buộc; `checkHubSecretsKey` (fatal: thiếu/sai/trùng master/tự kiểm hỏng; log chỉ tên biến) | T5a |
| `tools/scripts/src/keys-dev.ts` · `.env.example` | Sinh `HUB_SECRETS_KEY` khác `SECRET_MASTER_KEY`; thêm vào mọi `.env.test-*.local` đang có mà chưa có biến (lấy giá trị từ `.env.local`, không ghi đè). `db:test:create` (`packages/db/src/test-db-cli.ts`) sao từ `.env.local` nên file mới tự có | T5a |
| `.env.production.example` · `docs/PRODUCTION-NOTES.md` | `HUB_SECRETS_KEY=<base64 32 byte, KHÁC SECRET_MASTER_KEY>` + cảnh báo "mất khoá = mất mọi secret Hub, sao lưu ngoài repo"; dòng PRODUCTION-NOTES | T5a |
| `apps/hub-api/src/modules/secrets/secrets.crypto.ts` | §2.2 | T5a |
| `apps/hub-api/src/modules/secrets/secrets.rules.ts` | §2.1 (hàm thuần) | T5a |
| `…/secrets/secrets.errors.ts` | `secretError(code, details?)` như `sources.errors.ts` | T5 |
| `…/secrets/secrets.repo.ts` | SQL: insert, readForUpdate, update, delete, list, `usedByMany`, `nameTaken`, `tenantExists`, `readMaterial` | T5 |
| `…/secrets/secrets.service.ts` | create/list/get/update/remove (§3) | T5 |
| `…/secrets/secrets.use.ts` | `HubSecretReader.useSecret` (§2.3) | T5 |
| `…/secrets/secrets.routes.ts` · `secrets.mount.ts` · `README.md` | Studio + tenant routes; `SECRETS_PROTECTED_PREFIXES = ["/admin/source-credentials"]` | T5 |
| `apps/hub-api/src/modules/studio/studio-write.ts` | `withConfigWrite(deps, actor, fn, scope?)` | T5 |
| `apps/hub-api/src/app.h4a.ts` · `app.ts` | mount Studio route trong `mountH4a`; tenant route + prefix; `AppDeps.hubSecretsKey` | T5 |
| `tools/scripts/src/done-h4b1.ts` + script `done:h4b1` | Lệnh xong | T7 |

## 2. Hàm thuần (qc viết test trước)

### 2.1 `secrets.rules.ts`
```ts
export type HubSecretKind = "provider_api_key" | "kh_api_key" | "source_credential";
export type SecretRoute = "studio" | "tenant";
/** provider ⇒ tenantId null; source_credential ⇒ khác null; kh ⇒ cả hai. */
export function secretScopeOk(kind: HubSecretKind, tenantId: string | null): boolean;
/** studio: chỉ platform_admin, mọi kind. tenant: tenant_admin|platform_admin, CHỈ source_credential. member ⇒ false. */
export function canManageSecret(role: Role, kind: HubSecretKind, route: SecretRoute): boolean;
/** Như writeTenant/readTenant nguồn: tenant_admin = phiên (khác ⇒ ném NOT_FOUND); platform: write vắng ⇒
 *  VALIDATION_ERROR path tenant_id, read vắng ⇒ NOT_FOUND. */
export function credentialTenant(u: AuthUser, provided: string | undefined, mode: "read" | "write"): string;
/** before/after audit: không bao giờ có value/ciphertext/iv. */
export function secretAuditSnapshot(r: { name: string; kind: HubSecretKind; tenantId: string | null; version: number }):
  { name: string; kind: HubSecretKind; tenant_id: string | null; version: number };
/** `<kind>:<name>` (đã clip ≤ 200 bởi hub-audit). */
export function secretEntityName(kind: HubSecretKind, name: string): string;
/** Cursor list = base64url JSON [kind, lower(name), id]; hỏng ⇒ undefined (trang đầu), như module nguồn. */
export function encodeSecretCursor(k: [string, string, string]): string;
export function decodeSecretCursor(raw: string | undefined): [string, string, string] | undefined;
```

### 2.2 `secrets.crypto.ts`
```ts
export type SecretKey = { version: number; key: Uint8Array };
export type SealedSecret = { ciphertext: Uint8Array; iv: Uint8Array; keyVersion: number };
export type SecretMeta = { id: string; kind: HubSecretKind; tenantId: string | null };
/** Thiếu ⇒ Error("HUB_SECRETS_KEY thiếu"); sai base64/≠ 32 byte ⇒ Error("HUB_SECRETS_KEY không hợp lệ"). Không chứa giá trị. */
export function parseHubSecretsKey(b64: string | undefined, version?: number): SecretKey;
/** Trùng (so byte) ⇒ Error("HUB_SECRETS_KEY phải khác SECRET_MASTER_KEY"). master vắng ⇒ không ném. */
export function assertDistinctFromMaster(hub: SecretKey, masterB64: string | undefined): void;
export function hubSecretAad(m: SecretMeta, keyVersion: number): Uint8Array;  // D3
/** IV 12 byte mới mỗi lần (rand tiêm được cho test); ciphertext = bản mã ‖ tag 16. */
export function sealHubSecret(k: SecretKey, m: SecretMeta, value: string, rand?: (n: number) => Uint8Array): SealedSecret;
/** Sai khoá/AAD/tag/iv/key_version ⇒ Error("hub-secrets: giải mã thất bại") (message cố định). */
export function openHubSecret(k: SecretKey, m: SecretMeta, s: SealedSecret): string;
/** Boot: seal/open thử với id nil. */
export function selfTestHubSecretsKey(k: SecretKey): void;
```
AC-02 kiểm bằng `openHubSecret` với `kind`/`tenantId` đổi ⇒ ném; sửa 1 byte `ciphertext` ⇒ ném.

### 2.3 `secrets.use.ts` (nội bộ, không route)
```ts
export type SecretRef = { id: string; kind: HubSecretKind; tenantId: string | null };
export type SecretUseFailure = "key_missing" | "secret_missing" | "decrypt_failed";
export class SecretUseError extends Error { readonly code = "NOT_CONFIGURED"; readonly reason = "credential";
  constructor(readonly failure: SecretUseFailure) }   // message = `hub secret: <failure>`, không id/giá trị
export class HubSecretReader {
  constructor(d: { db: Db; key: SecretKey | null; log: Logger });
  /** Đọc bản mã qua `hub.secret_material(id, kind, tenantId)` (transaction ngắn, scope system), giải mã, gọi fn; không cache.
   *  Lỗi ⇒ log warn `{secret_id, kind, failure}` rồi ném SecretUseError. Giá trị chỉ sống trong fn. */
  useSecret<T>(ref: SecretRef, fn: (value: string) => Promise<T>): Promise<T>;
}
```
Bên dùng: K1 (`kh_api_key`, ref.tenantId = null hoặc tenant của run), H4b-2 provider `api` (null), P-c `source_credential` (tenant của run). **Người gọi phải truyền tenant của run**, không lấy từ input người dùng (reviewer kiểm ở mốc dùng). Giá trị không bao giờ được đưa vào payload job, `work/<job_id>/`, prompt, trace, audit, `detail` lỗi (HUB-BR-30/36).

## 3. Luồng service (`secrets.service.ts`)
Thứ tự kiểm mọi endpoint: role (middleware, 403) → parse zod (400) → `canManageSecret` (403) → `secretScopeOk` (400) → tenant tồn tại (400) → DB.

| Thao tác | Bước trong `withConfigWrite` (scope: studio = `system`; tenant route = `user` của tenant đích) |
|---|---|
| create | `nameTaken(kind, tenant, lower(name))` ⇒ 409 `SECRET_NAME_TAKEN` · key vắng ⇒ 409 `NOT_CONFIGURED` · id = randomUUID · `sealHubSecret` · INSERT (23505 ⇒ `SECRET_NAME_TAKEN`) · audit `create` · 201 |
| update | `readForUpdate(id, filter)` (`SELECT meta … FOR UPDATE`) không có ⇒ 404 · `version` ≠ ⇒ 409 `VERSION_CONFLICT {current, updated_at}` · seal giá trị mới (IV mới, cùng AAD) · `version+1`, `updated_at = now()`, `updated_by` · audit `rotate` (before/after snapshot) |
| remove | readForUpdate · version · `usedByMany([id])` ≥ 1 ⇒ 409 `SECRET_IN_USE {used_by}` · DELETE (23503 ⇒ tính lại used_by, 409) · audit `delete` · 204 |
| list/get | không qua `withConfigWrite`; `withHubScope` read (scope như trên) · `limit + 1` để biết `next_cursor` · `usedByMany(ids)` một query |

`filter` của route tenant: `kind = 'source_credential' AND tenant_id = $tenant` (sai ⇒ 404 `NOT_FOUND` cùng thân). Studio: `tenant_id IS NOT DISTINCT FROM $tenantQuery` không áp cho get/put/delete theo id (platform thấy mọi hàng).

Query & index (CONVENTIONS §6 mặc định, perf không chặn mốc):
| Query | Index |
|---|---|
| list (tuỳ `tenant_id`, `kind`) + `q` (ILIKE tên, escape `\` `%` `_` trong `q` + `ESCAPE '\'`) + cursor `(kind, lower(name), id) > (…)`; JOIN `admin.tenants` lấy `tenant {id,key,name}`; `updated_by` = JOIN `admin.users.username`, không có ⇒ null (như H4a) | `secrets_list_idx (tenant_id, kind, lower(name), id)` |
| `nameTaken` | `secrets_name_uq` |
| get/update/delete theo id | PK |
| `usedByMany` provider | `providers_secret_idx` |
| `usedByMany` source | `sources_tenant_idx` + lọc `config->>'credential_secret_id' = ANY($ids)` (ít hàng/tenant) |

## 4. Boot & env
`server.ts` sau bước master key: `checkHubSecretsKey(env)` ⇒ `parseHubSecretsKey` → `assertDistinctFromMaster` → `selfTestHubSecretsKey`; lỗi ⇒ `logger.fatal("hub_secrets_key_invalid", { reason })` (reason ∈ `missing|invalid|same_as_master|self_test`), `process.exit(1)`, không log giá trị. Env schema: `HUB_SECRETS_KEY: z.string().optional()` rồi kiểm ở boot (để thông báo rõ theo reason thay vì lỗi zod chung). `keys:dev`: thêm biến nếu chưa có, không ghi đè khoá cũ (mất khoá = mất mọi secret dev); **cũng thêm `HUB_SECRETS_KEY` (giá trị từ `.env.local`) vào mọi `.env.test-*.local` hiện có mà chưa có biến** (nếu không, Hub boot fatal ở mọi `test:int` cũ). Lệnh xong T5a: chạy `bun run keys:dev` rồi hồi quy `bun run test:int` xanh.

## 5. Kiểm "không lộ" (gợi ý cho qc, AC-01/07)
- Response: `JSON.stringify(body)` không chứa `value` ở mọi endpoint (kể cả 409 VERSION_CONFLICT `current`).
- Audit: `before/after/summary` không chứa `value`.
- Log: logger bắt (tiêm) cho create/rotate/delete/useSecret thành công và lỗi (key vắng, secret mất, giải mã hỏng) — không dòng nào chứa `value`.
- DB: sau thao tác, quét `SELECT t::text FROM hub.<bảng> t` mọi bảng schema `hub` (vai owner) — chỉ `secrets.ciphertext` (dạng bytea) được phép; không bảng nào chứa chuỗi `value`.
- `hub_api` `SELECT ciphertext FROM hub.secrets` ⇒ 42501; `agent_runtime` mọi SELECT ⇒ 42501; `secret_material` với tenant khác (scope user) ⇒ 0 hàng.

## 6. Rủi ro
| Rủi ro | Giảm |
|---|---|
| Cách ly tenant (`source_credential`, `kh_api_key` tenant) | RLS + filter rõ + scope user ở route tenant + `secret_material` kiểm GUC; security review T7 |
| Lộ qua log lỗi postgres (giá trị trong tham số câu lỗi) | Giá trị không bao giờ vào SQL — chỉ bản mã bytea; không có `last4` |
| Mất `HUB_SECRETS_KEY` ⇒ mất mọi secret Hub | Ghi rõ README module + `.env.example`; xoay khoá = mốc riêng (Q3) |
| `hub.ts` chạm trần 400 dòng | Hằng mới ở `hub-secrets.ts`, chỉ trải vào |
| `withConfigWrite` thêm tham số | Mặc định giữ hành vi cũ; test H4a hiện có phải xanh |

## 7. Thứ tự task BE
T4 (contract + DDL + Drizzle + int test DB) → T5a (crypto + rules + env/boot + keys:dev; thuần, unit) → T5 (repo/service/routes/useSecret/mount, int test) → T7 (`done:h4b1`, review + security review). FE T6 chỉ cần T4 (contract).
