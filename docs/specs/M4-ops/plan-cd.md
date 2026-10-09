---
spec: M4-ops
part: backend khối C (Import/Export, ADM-FR-54) + D (2FA TOTP, ADM-FR-08) + lib/mailer dùng chung
owner: backend-lead
requirements: [ADM-FR-54, ADM-FR-08, ADM-BR-04, ADM-BR-09, AC-A06, AC-A09]
---

# Plan backend M4 · khối C + D

A + B: `plan.md`; UI: `plan-frontend.md`. Luật: spec §2 (R10, R14–R16). Thư viện: [ADR-0005](../../adr/0005-m4-mail-qr-yaml-chart.md).

## 1. Quyết định chính

| # | Quyết định | Lý do / nguồn |
|---|---|---|
| D1 | Secret TOTP nằm ở **bảng riêng** `admin.user_totp` (không thêm cột vào `users`) + `admin.user_backup_codes`; `REVOKE ALL … FROM hub_ro` | không có đường lộ qua Hub hay snapshot audit `users` (R10) |
| D2 | Mã hoá AES-256-GCM bằng `SECRET_MASTER_KEY`, AAD `admin.user_totp:<user_id>:<key_version>` (miền khác `admin.secrets:`) | R16; thêm `sealBytes/openBytes(k, aad, …)` vào `lib/secret-crypto.ts`, `encryptSecret` giữ nguyên |
| D3 | Mã dự phòng lưu `HMAC-SHA256(pepper, code)`, pepper = `HKDF-SHA256(master key, info "admin.backup-codes.v1")`; tra trực tiếp theo hash | 8 ký tự ≈ 40 bit: SHA-256 trần dò offline được; có pepper thì lộ DB vẫn an toàn; dùng một lần bằng `UPDATE … WHERE used_at IS NULL RETURNING` |
| D4 | Mật khẩu đúng nhưng còn bước TOTP → **không** đưa bộ đếm sai về 0; chỉ về 0 sau khi qua TOTP | reset sau mật khẩu = kẻ có mật khẩu dò TOTP vô hạn; R16 |
| D5 | Chống dùng lại: lưu `last_used_step`; chỉ nhận bước `> last_used_step` trong cửa sổ ±1 bước (30 s) | R16; chặn cả mã cũ hơn mã vừa dùng |
| D6 | QR sinh **ở server** (`qrcode` → `qr_svg` data URL) cùng `otpauth_url`; FE chỉ `<img src={qr_svg}>` — không cần `qrcode` ở web (thay plan-frontend D2) | 0 byte bundle web; secret vốn trả cho client (khoá thủ công) |
| D7 | Import/Export dùng `yaml` 2.x (`maxAliasCount: 0`) thay `Bun.YAML` | Bun 1.3.14: file "billion laughs" 9 tầng → `Bun.YAML.parse` ném `Out of memory` (đo tại máy) |
| D8 | Import áp dụng: một `configWrite` (một tx, một NOTIFY `batch`), **một** dòng audit `import`; xung đột với ghi song song: `configWrite` nhận `expectBase` → sau bump `v ≠ base+1` thì ném → 409 `VERSION_CONFLICT` | R14; bump vẫn là câu cuối (hạng 14) |
| D9 | Biểu đồ Usage (khối A, FE): **bỏ `recharts` (ADR-0005)**, tự vẽ SVG cột theo ngày (≤ 31 cột) | `recharts@3.10.1` = 151 KB gzip > chunk 50 KB; §12 Q-C1 |
| D10 | Mailer: `lib/mailer` (interface `Mailer.send`) + `nodemailer` SMTP; thiếu `SMTP_URL` → mailer "tắt" ném `MailError("MAIL_DISABLED")` | A (T4) dùng cho cảnh báo quota (R05) |

## 2. Giao diện chung với khối A/B (thống nhất qua spec §3)

| Giao diện | Ai làm | Chữ ký | C/D dùng thế nào |
|---|---|---|---|
| Ghi audit | B (T1) | trong `configWrite`: `ch.audit(e: AuditInput)` (plan §4.1); tx không bump: `recordAudit(tx, e: AuditEntry)` câu cuối, `config_version` NULL | Import: **một** `ch.audit` (§8.3); 2FA: `recordAudit`, entity `user_totp` (§4.4) |
| `AUDIT_ENTITIES` | B | đã gồm `config`, `user_totp` (plan-contract §2.4) | allowlist `config` = `after` nguyên dạng (chỉ type/key/tên) — B thêm dòng |
| Secret tạo qua import | C (T8) | `createSecretTx(tx, ch, …, {audit: false})` | giữ đúng 1 dòng audit `import` (R14) |
| `configWrite` kiểm phiên bản gốc | C (T7) | `ConfigCall.expectBase?: number` → `withConfigWrite(…, {expectBase})`: sau bump, `v !== expectBase + 1` → ném `ConfigVersionMoved {current: v - 1}` (rollback) | T8 đổi thành 409 `VERSION_CONFLICT {current}` |
| Mailer | C/D (TM) | §9 | A (T4) inject `deps.mailer` |
| Đánh giá quota sau ghi | A (T4) | `evaluateTenant(ctx, tenantId)` sau commit (plan §5.2) | T8 gọi cho tenant có quota đổi qua import |
| Hạng khoá | — | `user_totp`, `user_backup_codes` = hạng **2b**; `tenant_quotas` do A xếp | §8.4 |

## 3. Contract khối C · `packages/contracts/src/transfer.ts`

Chỉ `platform_admin` (`requireRole("platform_admin")`; `tenant_admin`/`member` → 403 `FORBIDDEN`). Scope DB `platform`.

### 3.1 Export — `GET /admin/export?types=…`

| Trường | Kiểu | Luật |
|---|---|---|
| `types` (query) | CSV của `workflows\|commands\|features\|tenants\|groups\|grants` | bắt buộc, ≥ 1, không trùng, sai giá trị → 400 `VALIDATION_ERROR` |
| Response | `200`, `Content-Type: application/yaml; charset=utf-8`, `Content-Disposition: attachment; filename="config-v{n}.yaml"`, header `X-Config-Version: {n}` | body = `ConfigFileSchema` dạng yaml (`yaml.stringify`, `sortMapEntries: true`, `lineWidth: 0`), UTF-8 không BOM |

Một snapshot (`repeatable read, read only`, như `grants.matrix.ts`); phần tử sắp theo key.

`GET /admin/export/meta` (platform) → `{config_version: int, counts: {workflows, commands, features, tenants, groups, grants}: int}` — đếm đúng tập sẽ export (bỏ tenant `platform`, chỉ grant cho group), cùng snapshot.

### 3.2 `ConfigFileSchema` (zod, strict mọi cấp; dùng cho cả export và import)

| Khoá | Kiểu | Ghi chú |
|---|---|---|
| `format` | `"ai-system/config"` | bắt buộc |
| `format_version` | `1` | khác → lỗi `format_version` |
| `config_version` | int ≥ 0 | chỉ thông tin (hiện "từ config-v39") |
| `exported_at` | ISO UTC | thông tin |
| `secrets` | `{name: SecretName}[]` ≤ 500 | tên secret mà workflow trong file tham chiếu; **không** có giá trị/last4 (BR-04, AC-A06) |
| `workflows` | `{key, name, description, app_type, base_url, secret: SecretName, input_schema, output_field, enabled}[]` ≤ 2000 | field schema lấy từ `workflows.ts` (`CatalogKeySchema`, `BaseUrlSchema`, `InputSchemaSchema`…); `secret_id` → **tên** |
| `commands` | `{name, aliases, description, workflow: key, args, input_map, output, mode, timeout_s, enabled}[]` ≤ 2000 | từ `commands.ts`; không có `feature_ids` (thành viên feature chỉ khai ở `features.commands`) |
| `features` | `{key, name, description, icon, status, commands: CommandName[]}[]` ≤ 500 | `commands` = thay **cả tập** của feature đó (như PATCH `command_ids`) |
| `tenants` | `{key, name, max_concurrent_sub, entitlements: FeatureKey[], quotas: QuotaEntry[]}[]` ≤ 2000 | không có tenant `platform`; `QuotaEntry = {feature: FeatureKey\|null, max_runs, max_tokens, max_usd}` (kiểu theo R02); upsert theo (tenant, feature), dòng mọi giới hạn null → `SCHEMA`; `entitlements` chỉ thêm |
| `groups` | `{tenant: TenantKey, key, name, description}[]` ≤ 2000 | không có tenant `platform` |
| `grants` | `{tenant: TenantKey, group: GroupKey, feature: FeatureKey}[]` ≤ 5000 | chỉ grant cho **group** (grant cho user không export vì user không chuyển môi trường) |

Tham chiếu bằng **key/tên**, không id (R14). Khoá vắng = loại đó không có (không xoá gì).

### 3.3 Import — `POST /admin/import?dry_run=1|0`

Request JSON (`ImportRequestSchema`, strict):

| Trường | Kiểu | Luật |
|---|---|---|
| `file_name` | string 1–255, kết thúc `.yaml`/`.yml` (không phân biệt hoa thường) | sai → 400 `VALIDATION_ERROR` |
| `content` | string, `Buffer.byteLength(utf8) ≤ 1_048_576` | vượt → 413 `PAYLOAD_TOO_LARGE {max_bytes}`; route `bodyLimit` 2 MiB (JSON escape) → vượt cũng 413 |
| `secrets` | `Record<SecretName, string>` ≤ 500 khoá; giá trị theo `SecretValueSchema` của M2 | chỉ khi áp dụng; dry-run có thì bỏ qua (không đọc, không log) |
| `base_config_version` | int ≥ 0 | **bắt buộc khi áp dụng** (= `base_config_version` của dry-run); thiếu → 400 |
| `dry_run` (query) | `"1"` \| `"0"`, mặc định `"1"` | mặc định an toàn: không gửi thì không ghi |

**Dry-run → 200** `ImportPreviewSchema`:

| Trường | Kiểu |
|---|---|
| `valid` | boolean (= `errors.length === 0`) |
| `file_name` | string |
| `from_config_version` | int \| null (từ file) |
| `base_config_version` | int (config hiện tại lúc xem trước) |
| `summary` | `{added, updated, unchanged}` int ≥ 0 |
| `items` | `{type: "workflow"\|"command"\|"feature"\|"tenant"\|"group"\|"grant", key: string, op: "add"\|"update", before: object\|null, after: object}[]` — chỉ mục đổi; `key` của group/grant = `acme/sales`, `acme/sales/translate` |
| `missing_secrets` | `{name: SecretName, used_by: WorkflowKey[]}[]` (secret workflow trong file dùng, chưa có trong DB; sắp theo `name`) |
| `errors` | `{path: string, code: ImportErrorCode, message: string, params?: Record<string,string>, line?: int, col?: int}[]` ≤ 100 (cắt bớt + 1 lỗi `TOO_MANY_ERRORS`) |

`before/after` = dạng phần tử file. `ImportErrorCode` = `YAML_SYNTAX` · `SCHEMA` · `DUPLICATE_KEY` · `REF_NOT_FOUND` · `TENANT_NOT_FOUND` · `PLATFORM_TENANT` · `COMMAND_NEEDS_FEATURE` · `NOT_ENTITLED` · `RULE` (luật module trả, `params.code` = mã lỗi gốc, vd `INPUT_MAP_INVALID`, `SCHEMA_BREAKS_COMMANDS`, `BETA_GROUP_PROTECTED`, `CORE_FEATURE_PROTECTED`) · `TOO_MANY_ERRORS`. `message` tiếng Việt; FE dịch theo `code` + `params`.

**Áp dụng → 200** `ImportResultSchema` `{config_version: int, summary: {added, updated, unchanged}, secrets_created: int}`. Không có thay đổi → 200, `config_version` = hiện tại, không ghi/audit/NOTIFY.

| Lỗi khi áp dụng | HTTP · mã | details |
|---|---|---|
| file lỗi (tính lại trong tx) | 400 `IMPORT_INVALID` | `{errors: ImportError[]}` |
| thiếu giá trị secret | 400 `SECRETS_REQUIRED` | `{missing: SecretName[]}` |
| `secrets` có tên **không** thuộc `missing_secrets` (đã tồn tại / không dùng) | 400 `VALIDATION_ERROR` | `{fields:{secrets:[name]}}` — import không bao giờ đổi giá trị secret có sẵn |
| config đổi sau dry-run | 409 `VERSION_CONFLICT` | `{current: int}` → FE xem trước lại |
| quá kích thước | 413 `PAYLOAD_TOO_LARGE` | `{max_bytes: 1048576}` |

## 4. Contract khối D · `packages/contracts/src/totp.ts` (+ sửa `auth.ts`, `users.ts`)

### 4.1 Đổi contract có sẵn

| Schema | Thay đổi |
|---|---|
| `LoginResponseSchema` | thêm nhánh `TotpRequiredSchema {status:"totp_required", totp_token: string(1..4096), expires_in: 300}` |
| `MeSchema` | thêm `totp_enabled: boolean`, `totp_enabled_at: IsoDateTime\|null`, `backup_codes_left: int 0..10` (0 khi chưa bật) |
| `UserSchema` (list/chi tiết Users) | thêm `totp_enabled: boolean` (hiện mục `⋯ › Tắt 2FA`) |

### 4.2 Endpoint

| Endpoint | Ai | Request (strict) | 200 | Lỗi |
|---|---|---|---|---|
| `POST /auth/totp/verify` | không cần Bearer | `{totp_token, code: /^\d{6}$/}` **hoặc** `{totp_token, backup_code: /^[2-9a-hjkmnp-z]{4}-?[2-9a-hjkmnp-z]{4}$/}` (đúng một) | như login: `TokenGrant` (cookie web / body extension) hoặc `password_change_required` | 401 `INVALID_TOTP_TOKEN` (hỏng/hết hạn/không khớp); 401 `INVALID_OTP` (mã sai/đã dùng); 423 `TEMP_LOCKED {until}`; 403 `ACCOUNT_LOCKED` |
| `POST /auth/totp/setup` | `platform_admin`, `tenant_admin` | `{current_password}` | `{secret: base32 32 ký tự, otpauth_url, qr_svg: "data:image/svg+xml;base64,…", account_label: "acme · thu.ha", expires_in: 600}` | 400 `INVALID_CURRENT_PASSWORD` (tính bộ đếm); 423; 409 `TOTP_ALREADY_ENABLED` |
| `POST /auth/totp/enable` | như trên | `{code}` | `{backup_codes: string[10]}` dạng `xxxx-xxxx` (chỉ trả một lần) | 400 `INVALID_CURRENT_CODE` (**không** tính bộ đếm, R16); 409 `TOTP_SETUP_EXPIRED` (không có/hết hạn pending); 409 `TOTP_ALREADY_ENABLED` |
| `POST /auth/totp/disable` | như trên | `{current_password, code}` hoặc `{current_password, backup_code}` | `204` | 400 `INVALID_CURRENT_PASSWORD` / `INVALID_CURRENT_CODE` (cả hai tính bộ đếm); 423; 409 `TOTP_NOT_ENABLED` |
| `POST /auth/totp/backup-codes` | như trên | `{code}` (mã TOTP hiện tại; xem §12 Q-D1) | `{backup_codes: string[10]}`; mã cũ hết hiệu lực | 400 `INVALID_CURRENT_CODE` (tính bộ đếm); 423; 409 `TOTP_NOT_ENABLED` |
| `POST /admin/users/:id/totp/disable` | `platform_admin` (mọi tenant), `tenant_admin` (chỉ tenant mình) | body rỗng | `200 User` (đã `totp_enabled:false`) | 404 (ngoài phạm vi, BR-09); 403 `SELF_ACTION_FORBIDDEN` (chính mình); 409 `TOTP_NOT_ENABLED` |

`member` gọi `/auth/totp/setup|enable|disable|backup-codes` → 403 `FORBIDDEN` (M4-AC12). `GET /auth/me` đã có, chỉ thêm trường.

### 4.3 Mã lỗi mới (C + D) — thêm vào `API_ERRORS`, union status thêm `413`

| Mã | HTTP | Khối |
|---|---|---|
| `PAYLOAD_TOO_LARGE` | 413 | C |
| `IMPORT_INVALID` | 400 | C |
| `SECRETS_REQUIRED` | 400 | C |
| `INVALID_TOTP_TOKEN` | 401 | D |
| `INVALID_OTP` | 401 | D (bước đăng nhập; FE không refresh vì ở `/auth/*` chưa có phiên) |
| `INVALID_CURRENT_CODE` | 400 | D (đã đăng nhập; **400** để không kích hoạt refresh/đăng nhập lại của FE) |
| `TOTP_ALREADY_ENABLED` · `TOTP_NOT_ENABLED` · `TOTP_SETUP_EXPIRED` | 409 | D |

### 4.4 Audit 2FA (qua `recordAudit`, cùng tx)

| Sự kiện | action | entity · entity_id | before → after (allowlist) |
|---|---|---|---|
| tự bật | `create` | `user_totp` · user id | `null` → `{enabled: true, backup_codes_left: 10}` |
| tự tắt | `delete` | như trên | `{enabled: true, backup_codes_left}` → `null` |
| tạo lại mã dự phòng | `update` | như trên | `{backup_codes_left: n}` → `{backup_codes_left: 10}` |
| admin tắt hộ | `delete` | như trên (actor ≠ user) | như tự tắt |
| setup (pending), verify đăng nhập, mã sai | **không** ghi (Q6: login không ghi) | | |

`recordAudit` câu cuối tx, `entityName` = username, `tenant_id` = tenant của user. Không bao giờ có secret, hash, mã. Không bump `config_version`/NOTIFY (2FA không phải cấu hình Hub đọc).

## 5. Dữ liệu · migration `0008_admin_totp.sql` (sau `0007` của T0 khối A/B; Drizzle schema `packages/db/src/schema/totp.ts`)

**`admin.user_totp`** (một hàng/user)

| Cột | Kiểu | Null | Mặc định / ràng buộc |
|---|---|---|---|
| `user_id` | uuid | no | PK; FK kép `(tenant_id, user_id)` → `users(tenant_id, id)` ON DELETE CASCADE |
| `tenant_id` | uuid | no | FK `tenants` RESTRICT |
| `secret_ct` | bytea | no | `octet_length = 36` (20 byte + tag 16) |
| `secret_iv` | bytea | no | `octet_length = 12` |
| `key_version` | smallint | no | 1, `>= 1` |
| `enabled_at` | timestamptz | yes | null = đang setup |
| `pending_expires_at` | timestamptz | yes | CHECK `(enabled_at IS NULL) = (pending_expires_at IS NOT NULL)` |
| `last_used_step` | bigint | yes | bước TOTP cuối đã nhận |
| `created_at`, `updated_at` | timestamptz | no | `now()` |

**`admin.user_backup_codes`**

| Cột | Kiểu | Null | Ràng buộc |
|---|---|---|---|
| `id` | uuid | no | PK `gen_random_uuid()` |
| `tenant_id` | uuid | no | FK `tenants` RESTRICT |
| `user_id` | uuid | no | FK kép → `user_totp(tenant_id, user_id)` ON DELETE CASCADE (tắt 2FA = xoá hàng `user_totp` → mã đi theo) |
| `code_hash` | bytea | no | `octet_length = 32`; UNIQUE `(user_id, code_hash)` (index dùng khi tra mã) |
| `used_at` | timestamptz | yes | |
| `created_at` | timestamptz | no | `now()` |

Index `user_backup_codes_unused_idx (user_id) WHERE used_at IS NULL`; `user_totp` có `UNIQUE (tenant_id, user_id)` (đích FK kép).

RLS cả hai, policy `*_admin_rw` đúng mẫu `0006`; **không** policy `hub_ro` + `REVOKE ALL … FROM hub_ro` (0000 cấp SELECT mặc định). Test: `hub_ro` SELECT → `permission denied`; tenant khác → 0 hàng.

Không seed. Import/Export: không bảng mới (dùng `tenant_quotas` của A).

## 6. Luật thuần (QC viết test trước)

`apps/admin-api/src/lib/totp.ts` (RFC 6238/4226, chỉ `node:crypto`):
```ts
export const TOTP_STEP_S = 30, TOTP_DIGITS = 6, TOTP_WINDOW = 1, TOTP_SECRET_BYTES = 20;
export function base32Encode(b: Uint8Array): string;  // RFC 4648, không padding
export function base32Decode(s: string): Uint8Array;   // bỏ khoảng trắng, hoa/thường; ký tự lạ → ném
export function hotp(secret: Uint8Array, counter: bigint): string;
export function timeStep(now: Date): bigint;           // floor(unix_s / 30)
/** Bước khớp trong [T-1, T+1] và > lastUsedStep, so hằng thời gian (timingSafeEqual); không khớp → null. */
export function matchTotp(secret: Uint8Array, code: string, now: Date, lastUsedStep: bigint | null): bigint | null;
export function otpauthUrl(a: { secretB32: string; issuer: string; account: string }): string; // issuer "AI System", SHA1/6/30
```
Vector: RFC 6238 phụ lục B (SHA1, t = 59 → `287082`).

`apps/admin-api/src/modules/auth/totp/totp.rules.ts`:
```ts
export const BACKUP_CODE_COUNT = 10, BACKUP_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"; // 31 ký tự, bỏ 0/1/i/l/o
export const TOTP_TOKEN_TTL_S = 300, TOTP_SETUP_TTL_S = 600;
export function generateBackupCodes(randomBytes: (n: number) => Uint8Array): string[]; // 10 × "xxxx-xxxx", lấy mẫu loại bỏ byte ≥ 248 (như generateTempPassword), không trùng
export function normalizeBackupCode(raw: string): string | null;   // trim, lower, bỏ "-"/khoảng trắng; ≠ 8 ký tự hợp lệ → null
export function canUseTotp(role: Role): boolean;                   // platform_admin | tenant_admin
export type TotpState = { enabledAt: Date | null; pendingExpiresAt: Date | null } | null;
export function setupUsable(s: TotpState, now: Date): boolean;     // pending và chưa hết hạn
/** Thứ tự sau mật khẩu đúng (Q10): account_locked → totp_required (đã bật) → password_change_required → authenticated. */
export function loginNextStep(u: { canSignIn: boolean; totpEnabled: boolean; mustChangePassword: boolean }): "account_locked" | "totp_required" | "password_change_required" | "authenticated";
export function canResetTotpFor(actor: Actor, target: { id: string; tenantId: string }): RuleError | null; // tự mình → SELF_ACTION_FORBIDDEN; khác tenant với tenant_admin → NOT_FOUND
```

`apps/admin-api/src/modules/transfer/transfer.rules.ts`:
```ts
export type TransferType = "workflows" | "commands" | "features" | "tenants" | "groups" | "grants";
export type Snapshot = { configVersion: number; secrets: SecretName[] } & Partial<ConfigFileBody>; // dạng phần tử file
export function buildExportFile(s: Snapshot, types: readonly TransferType[], now: Date): ConfigFile;
export function exportFileName(configVersion: number): string;   // "config-v{n}.yaml"
/** So file với snapshot → items/summary/missing_secrets/errors. */
export function planImport(file: ConfigFile, s: Snapshot): ImportPlan;
export function diffOp(before: object | null, after: object): "add" | "update" | "unchanged"; // so sau chuẩn hoá
export function checkSecretsInput(missing: readonly string[], given: Record<string, string>): { missing: string[]; extra: string[] };
```
Luật module khác: gọi **rules** thuần của module đó (commands, workflows, features, groups, grants), không qua repo.

## 7. Luồng D chi tiết (bảo mật)

| Bước | Hành vi (if/else chính xác) |
|---|---|
| Login (sửa `auth.service.login`) | user không có / sai mật khẩu: như M1. Mật khẩu đúng → `loginNextStep`: `account_locked` → reset bộ đếm + 403 (như M1). `totp_required` → **không reset bộ đếm** (D4); vẫn kiểm `TEMP_LOCKED` dưới khoá hàng; ký `totp_token` (JWT EdDSA, `aud: "admin:totp"`, TTL 300, claims `{sub, tid, pwc, tte}`; `tte` = `enabled_at` ms) → 200 `totp_required`. Còn lại: như M1 |
| Verify | 1) token hỏng → 401 `INVALID_TOTP_TOKEN`. 2) tx scope tenant, khoá `users` NKU → `user_totp` NKU (2 → 2b). 3) user mất / `pwc` lệch / `enabled_at` ≠ `tte` → 401 `INVALID_TOTP_TOKEN`. 4) `!canSignIn` → 403 `ACCOUNT_LOCKED`; khoá tạm → 423. 5) `code`: `matchTotp(…, last_used_step)`; `backup_code`: `UPDATE … SET used_at=now() WHERE user_id=$ AND code_hash=$ AND used_at IS NULL RETURNING id`. 6) Sai → ghi `afterFailedLogin`, tx **trả** kết quả `wrong` (không ném, để commit) → service ném 401 `INVALID_OTP` (lần thứ 5 khoá 15 phút). 7) Đúng → `last_used_step = step` (TOTP), reset bộ đếm; `must_change_password` → `password_change_required` (như M1); không thì `markLoginSuccess` + `issueSession` |
| Setup | Kiểm mật khẩu như `changePasswordSelf` (sai → tính bộ đếm, 400; khoá → 423). Đã bật → 409. Sinh 20 byte CSPRNG, `sealBytes` → upsert `user_totp` pending (`pending_expires_at = now + 600 s`); setup lại thay pending cũ |
| Enable | Không có pending dùng được → 409 `TOTP_SETUP_EXPIRED`. `matchTotp` sai → 400 `INVALID_CURRENT_CODE` (**không** tính bộ đếm: người dùng đã đăng nhập và đang giữ secret). Đúng → `enabled_at = now`, `pending_expires_at = null`, `last_used_step = step`; xoá mã dự phòng cũ, chèn 10 hash; audit `create`; trả mã thô (không lưu, không log) |
| Disable (tự) | Kiểm mật khẩu (sai → tính bộ đếm, 400) rồi mã TOTP/dự phòng (sai → tính bộ đếm, 400 `INVALID_CURRENT_CODE`); đúng → xoá `user_totp` (cascade mã) + audit `delete` |
| Tạo lại mã | Kiểm `code` (sai → tính bộ đếm); đúng → xoá mã cũ, chèn 10 mã mới, cập nhật `last_used_step`; audit `update` |
| Admin tắt hộ | scope actor → `lockTarget` (như reset-password: tenants → users NKU) → `canResetTotpFor` → chưa bật → 409 `TOTP_NOT_ENABLED` → xoá + audit `delete`. Không thu hồi phiên |

So mã bằng `timingSafeEqual`; không log secret/`otpauth_url`/`qr_svg`/mã/`totp_token`; setup/enable trả `Cache-Control: no-store`. Bật 2FA không thu hồi phiên khác.

## 8. Luồng C chi tiết

### 8.1 Export
Tx `repeatable read, read only`, scope platform → `readSnapshot(tx, types)` (`ORDER BY key`, trần 5000 hàng/loại) → `buildExportFile` → `yaml.stringify`. Secret: repo chỉ SELECT `name` (`admin_rw` không có quyền cột `ciphertext/iv`, 0004).

### 8.2 Dry-run
1) kích thước ≤ 1 MiB; 2) `YAML.parse(content, {maxAliasCount: 0, uniqueKeys: true, schema: "core", prettyErrors: true})` — lỗi → `valid:false`, `YAML_SYNTAX` có `line/col`; 3) `ConfigFileSchema.safeParse` → `SCHEMA` với `path` dạng `commands[2].workflow` (từ `issue.path`); 4) tx `repeatable read, read only` → `readSnapshot` cho mọi loại file nhắc tới + loại được tham chiếu; 5) `planImport`. Không ghi gì (AC09). Không log `content`.

### 8.3 Áp dụng
1–3 như dry-run (lỗi → 400 `IMPORT_INVALID`); `checkSecretsInput` (thiếu → 400 `SECRETS_REQUIRED`; thừa → 400). 4) `configWrite({scope: platform, actor, expectBase: base_config_version})`: đọc snapshot **trong tx ghi** + khoá hàng sẽ sửa (§8.4) → `planImport` lại (lỗi → 400 `IMPORT_INVALID`) → ghi theo thứ tự §8.4 qua `transfer.repo` (upsert theo key, `version = version + 1`, `updated_by = actor`) → `ch.changed({entity, tenantId})` mỗi hàng đổi → `ch.audit` một lần: `{action: "import", entity: "config", entityId: null, entityName: file_name, tenantId: null, before: null, after: {from_config_version, added: [{type,key}], updated: [{type,key}], secrets_created: [name], truncated?: true}, summary: {file, added_count, updated_count}}` (≤ 500 mục/danh sách) → bump (kiểm `expectBase`). 5) Sau commit: `evaluateTenant` cho tenant có `quotas` đổi (A). Không xoá: chỉ feature có trong file mới bị thay tập `commands`; không thu hồi entitlement, không xoá grant/quota.

Secret mới: `secrets.service.createSecretTx(tx, ch, {name, value, note: "import"}, {audit: false})` (tách từ create hiện có). Tenant chưa có → `TENANT_NOT_FOUND` (Q11). ~~Command mới không thuộc feature nào trong file → `COMMAND_NEEDS_FEATURE`.~~ **[Đổi theo CR-055, 2026-10-09]** command không thuộc feature nào được phép; `COMMAND_NEEDS_FEATURE` gỡ khỏi `ImportErrorCode`. Grant cần entitlement (DB hoặc cùng file) → `NOT_ENTITLED`.

### 8.4 Thứ tự khoá (bổ sung plan M3 §6.1 — ngoại lệ **E4 · import**)
Khoá `NKU` theo id tăng trên mọi hàng có sẵn sẽ sửa, theo hạng: `tenants`(1) → `groups`(3) → `workflows`(5) → `commands`(6) → `command_names`(7) → `features`(8) → `feature_commands`(9) → `feature_entitlements`(10) → `tenant_quotas` (hạng A đặt) → `feature_grants`(11) → `secrets`(12, `SHARE` cho secret có sẵn được tham chiếu) → `config_meta`(14, bump cuối). **E4:** secret **mới** chèn trước workflow (FK) — như E1/E3: hàng chưa commit, chỉ secret POST cùng tên chờ ở `secrets_name_uq` và tx đó không giữ khoá khác → không vòng. Workflow có sẵn đổi `secret` → giữ `SHARE` secret sau khi đã khoá workflow (chiều 5 → 12, đúng hạng). T8 viết `transfer.lock-order.int.test.ts` theo `lib/lock-order.helpers.ts` (import ∥ command PATCH, import ∥ secret PUT).

## 9. Mailer · `apps/admin-api/src/lib/mailer/` (task TM; khối A dùng)

```ts
export type MailMessage = { to: readonly string[]; subject: string; text: string; html?: string };
export interface Mailer { send(m: MailMessage): Promise<void> }          // ném MailError khi lỗi; không retry bên trong
export class MailError extends Error { readonly code: "MAIL_DISABLED" | "MAIL_SEND_FAILED" | "MAIL_INVALID" }
export function createMailer(env: Pick<Env, "SMTP_URL" | "MAIL_FROM">): Mailer; // SMTP_URL vắng → disabledMailer
export function createMemoryMailer(): Mailer & { sent: MailMessage[] };          // test đơn vị
```
`MAIL_INVALID`: `to` 1–50 `EmailSchema`; `subject` 1–200, không CR/LF (header injection); `text` ≤ 100 KB. nodemailer timeout 5/5/10 s, không pool. Log lỗi chỉ `{recipients: n, code}`. Gửi sau commit là việc bên gọi (R05). Int test: Mailpit `GET :8025/api/v1/messages`.

## 10. Env, giả lập, phụ thuộc

| Env (`config/env.ts`) | Kiểu | Bắt buộc | Mặc định |
|---|---|---|---|
| `SMTP_URL` | `z.url({protocol: /^smtps?$/})` | không | vắng = tắt mail (cảnh báo lúc khởi động); dev + `.env.example` `smtp://127.0.0.1:1025` (TM) |
| `MAIL_FROM` | string ≤ 200, dạng `Tên <addr>` | không | `AI System <no-reply@ai-system.local>` |

`deps.secretKey` (M2) bắt buộc cho route 2FA và import (thiếu → 500 như secrets M2).

Thư viện (ADR-0005): `apps/admin-api`: `nodemailer@10.0.13`, `@types/nodemailer@8.0.2` (dev), `qrcode@1.5.4`, `@types/qrcode@1.5.6` (dev), `yaml@2.9.1`. Ghim chính xác.

QC: e2e tính mã từ `secret` của setup bằng `lib/totp.ts`; chống dùng lại test bằng `ctx.now` giả. Fixture `tests/fixtures/transfer/*.yaml` (bom alias, 1 MiB + 1 byte).

## 11. Task BUILD khối C + D (điền vào `tasks.md`)

Lệnh xong chung (thêm vào mỗi dòng): `bun run typecheck && bun run check:fn --files <file đổi> && bun run depcruise --all && bun run test:lock:verify`.

Danh sách task: xem `tasks.md` (nguồn chính).

`auth/` đã 10 file → TOTP ở `modules/auth/totp/` (CONVENTIONS §4); `auth.service.ts` (306 dòng) chỉ thêm nhánh `totp_required`.

## 12. Câu hỏi — đã chốt (người dùng 2026-10-03, spec §9)

Q-D1: tạo lại mã dự phòng đòi **mã TOTP hiện tại** trong ConfirmDialog (token truy cập bị lộ không đủ lấy mã mới). Q-C1: SVG tự vẽ, không `recharts` (plan-frontend D1). Q-C2: grant cho user không export (user không chuyển môi trường).
