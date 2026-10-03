---
spec: M4-ops
part: test-plan khối C (Import/Export, ADM-FR-54) + D (2FA, ADM-FR-08) + mailer
owner: qc
requirements: [ADM-FR-54, ADM-FR-08, ADM-BR-04, ADM-BR-09, AC-A06, AC-A09, M4-AC09, M4-AC10, M4-AC11, M4-AC12]
---

# Test-plan M4 · khối C + D

A + B: `test-plan.md`. Nguồn: spec §2 (R14–R16), §8, §9 Q6/Q10/Q11; `plan-cd.md` §3–9 (trỏ mục, không chép); ADR-0005; `admin-missing-screens.md` §8, §10 (nhãn e2e). Tên test: `"<mã> · <mã hàng> · mô tả"` (vd `ADM-FR-08 · D-L03 · …`).

## 0. Quy ước, dữ liệu, fixture

| Mục | Nội dung |
|---|---|
| Env int | `createM3Env()` (M3 `_fixtures.ts`): catalog M2/M3, user M1 (`platform/admin` SEED_PW, `admin2`; acme `binh`,`chi` tenant_admin; `an` member; globex `hoa` tenant_admin). Clock giả `env.clock` (T0 `2026-10-01T09:00:00Z`) |
| Oracle TOTP | `tests/acceptance/M4/_totp.ts` — **tự viết** RFC 4226/6238 bằng `node:crypto` (HMAC-SHA1, base32 RFC 4648), **không** import `lib/totp.ts` của sản phẩm: `b32(bytes)`, `unb32(s)`, `totpAt(secretB32, unixS)`, `stepOf(unixS)`. `e2e/support/totp.ts` re-export + `codeFor(secret, offsetSteps)` (theo `Date.now()`), `waitNextStep()` (`expect.poll` tới khi `stepOf(now)` đổi, timeout 31 s — không `sleep` cố định; sau đó dùng `codeFor(secret, 1)`) |
| Bật 2FA trong test | `enable2fa(env, tenant, user, pw)` trong `tests/acceptance/M4/_cd.ts`: `setup` → `enable` với `totpAt(secret, clock)`; trả `{secret, backupCodes, step}`. **Gọi trong thân `it`** (có `expect(status)`), không trong `beforeAll` — để ca đỏ đỏ ở route chưa có, không đỏ ở dựng dữ liệu |
| Secret TOTP rules | RFC 6238 phụ lục B: ASCII `12345678901234567890` = base32 `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ` |
| Rò rỉ | `leaked()`, `scanDatabase()`, `leakForms()` (M2); `captureLogs()` mới trong `_cd.ts` (spy `process.stdout.write`/`stderr.write` + `console.*` trong lúc chạy ca) |
| NOTIFY / version | `openListener()`, `track()` (M3 `_notify.ts`); `config_meta.version` qua owner |
| Dữ liệu yaml | `tests/acceptance/M4/_transfer-data.ts`: dựng chuỗi yaml trong code (không file 1 MiB trong repo): `baseFile()`, `bomAlias(levels=9)`, `padTo(bytes)` (thêm comment `#`), `multiByte(n)` ("ệ" 3 byte) |
| Mailpit | `http://127.0.0.1:8025/api/v1/search?query=subject:"…"`; trước ca: `DELETE /api/v1/search?query=subject:"[M4-qc]"`. Subject cố định có tiền tố `[M4-qc]` |
| Bẫy (CONVENTIONS §2) | `sql.json()` cho jsonb; ghi đè fixture theo lần gọi; listener lọc từ mốc `from` của ca; e2e chờ `waitForResponse`; dữ liệu hợp contract ở mọi trường không kiểm |

## 1. Luật thuần (bun test, không DB)

### 1.1 `tests/acceptance/M4/rules/totp.test.ts` — `lib/totp.ts`, `totp.rules.ts` (plan-cd §6)

| Mã | Hàm | Dữ liệu | Kỳ vọng |
|---|---|---|---|
| D-R01 · R16 | `hotp` | secret RFC, counter 0..9 | `755224 287082 359152 969429 338314 254676 287922 162583 399871 520489` (RFC 4226 phụ lục D) |
| D-R02 · R16 | `hotp(timeStep(t))` | t = 59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000 | `287082 081804 050471 005924 279037 353130` (RFC 6238 B, 6 số cuối, giữ số 0 đầu) |
| D-R03 | `timeStep` | t = 0; 29.999 s; 30; 59; 60 | `0n 0n 1n 1n 2n` |
| D-R04 | `base32Encode/Decode` | RFC 4648 §10: `""`,`f`,`fo`,`foo`,`foob`,`fooba`,`foobar` | `"" MY MZXQ MZXW6 MZXW6YQ MZXW6YTB MZXW6YTBOI` (không `=`); decode `"mzxw 6ytb oi"` → `foobar`; `"MZXW1"`, `"MZ!W"` → ném; 20 byte → 32 ký tự, round-trip |
| D-R05 · R16 | `matchTotp` | now = 1111111111 s (T); mã của T, T-1, T+1 | trả đúng bước T, T-1, T+1 |
| D-R06 · R16 | `matchTotp` | mã T-2, T+2; mã sai cố định khác cả 3 bước | `null` |
| D-R07 · R16 chống dùng lại | `matchTotp` | `lastUsedStep = T`: mã T; mã T-1; mã T+1 | `null`; `null`; `T+1` |
| D-R08 | `matchTotp` | `"28708"`, `"2870822"`, `"abcdef"`, `""` | `null`, không ném |
| D-R09 | `otpauthUrl` | `{secretB32: GEZD…, issuer: "AI System", account: "acme · thu.ha"}` | `new URL()` parse được; protocol `otpauth:`, host `totp`; label giải mã chứa `acme · thu.ha`; query `secret=GEZD…`, `issuer=AI System`, `algorithm=SHA1`, `digits=6`, `period=30` |
| D-R10 | hằng | — | `TOTP_STEP_S 30, TOTP_DIGITS 6, TOTP_WINDOW 1, TOTP_SECRET_BYTES 20, BACKUP_CODE_COUNT 10, TOTP_TOKEN_TTL_S 300, TOTP_SETUP_TTL_S 600`; `BACKUP_ALPHABET` dài 31, không chứa `0 1 i l o` |
| D-R11 · R16 | `generateBackupCodes` | `randomBytes` tất định: chuỗi byte 0..247 lặp | 10 mã `^[ALPHABET]{4}-[ALPHABET]{4}$`, đôi một khác nhau |
| D-R12 | `generateBackupCodes` | nguồn trả 248..255 xen giữa | byte ≥ 248 bị bỏ (mã giống hệt khi lọc trước các byte đó) |
| D-R13 | `generateBackupCodes` | nguồn lặp đúng 8 byte cho 2 mã đầu | vẫn 10 mã khác nhau |
| D-R14 | `normalizeBackupCode` | `" K7P2-9XQM "`, `"k7p2 9xqm"`, `"k7p29xq"`, `"k7p2-9xq0"`, `"k7p2-9xqm2"` | `k7p29xqm`, `k7p29xqm`, `null`, `null`, `null` |
| D-R15 · FR-08 | `canUseTotp` | 3 role | platform_admin, tenant_admin `true`; member `false` |
| D-R16 | `setupUsable` | `null`; enabled; pending hết hạn = now + 1 ms; = now; = now − 1 ms | `false, false, true, false, false` |
| D-R17 · Q10 | `loginNextStep` | (canSignIn, totp, mustChange) = (F,T,T), (T,T,T), (T,F,T), (T,F,F), (T,T,F) | `account_locked, totp_required, password_change_required, authenticated, totp_required` |
| D-R18 · BR-09 | `canResetTotpFor` | platform admin → binh; binh → chi; binh → hoa (globex); binh → binh; admin → admin | `null, null, NOT_FOUND, SELF_ACTION_FORBIDDEN, SELF_ACTION_FORBIDDEN` |

### 1.2 `tests/acceptance/M4/rules/transfer.test.ts` — `transfer.rules.ts` (plan-cd §6)

Snapshot dựng từ M2/M3 `_data.ts` (workflow `translate`, `invoice-check`, `summarize`, `report-export`, `report-tax`; secret `DIFY_TRANSLATE_KEY`, `DIFY_INVOICE_KEY`, `DIFY_OLD_KEY`; feature `ke-toan`, `dich-thuat`, `bao-cao`, `thu-nghiem`; tenant acme/globex + group).

| Mã | Hàm | Dữ liệu | Kỳ vọng |
|---|---|---|---|
| C-R01 · R14 | `exportFileName` | 43; 0 | `config-v43.yaml`; `config-v0.yaml` |
| C-R02 · R14 | `buildExportFile` | đủ 6 loại, now cố định | `ConfigFileSchema.parse` qua; `format`, `format_version 1`, `config_version`, `exported_at = now.toISOString()`; mỗi danh sách sắp theo key |
| C-R03 · AC-A06 | `buildExportFile` | như trên | `secrets` = đúng tên workflow trong file tham chiếu (`DIFY_INVOICE_KEY`, `DIFY_TRANSLATE_KEY`), không có `DIFY_OLD_KEY`; quét đệ quy: không khoá `id`, `*_id`, `value`, `last4`, `ciphertext` |
| C-R04 | `buildExportFile` | `types = ["commands"]` | chỉ khoá `commands` (+ khoá đầu file); `secrets ?? []` = `[]` |
| C-R05 | `diffOp` | `null`→obj; obj khác thứ tự khoá; đổi `name` | `add`, `unchanged`, `update` |
| C-R06 · AC09 | `planImport` | file: sửa `translate.description`, thêm workflow `report-new` (secret `DIFY_REPORT_KEY`) | items `{workflow, translate, update, before, after}` + `{workflow, report-new, add, before null}`; summary `{added 1, updated 1, unchanged = số còn lại trong file}`; `missing_secrets = [{name: DIFY_REPORT_KEY, used_by: [report-new]}]`; `errors = []` |
| C-R07 · R14 không xoá | `planImport` | file chỉ có `translate` không đổi | `items = []`, không có op nào khác `add/update` cho thực thể ngoài file |
| C-R08 | `planImport` | `commands[0].workflow = "translat"` | `errors[0] = {path: "commands[0].workflow", code: REF_NOT_FOUND}` |
| C-R09 · Q11 | `planImport` | `tenants: [{key: newco…}]` | lỗi `TENANT_NOT_FOUND` tại `tenants[0].key`; không item `add` cho tenant |
| C-R10 | `planImport` | `tenants: [{key: platform…}]` | `PLATFORM_TENANT` |
| C-R11 | `planImport` | 2 workflow cùng key `translate` | `DUPLICATE_KEY` tại `workflows[1].key` |
| C-R12 | `planImport` | command mới không nằm trong `features[].commands` nào; rồi thêm vào `bao-cao.commands` | `COMMAND_NEEDS_FEATURE`; ca 2 không lỗi |
| C-R13 | `planImport` | grant `acme/<group>/thu-nghiem` chưa entitlement; ca 2: cùng file thêm vào `tenants[acme].entitlements` | `NOT_ENTITLED`; ca 2 không lỗi |
| C-R14 | `planImport` | command `input_map` trỏ field không có | `RULE`, `params.code = INPUT_MAP_INVALID` |
| C-R15 | `planImport` | feature `ke-toan.commands` đổi tập | 1 item `feature/ke-toan update`, `after.commands` = tập mới |
| C-R16 | `planImport` | key hiển thị group/grant | `acme/<group>`, `acme/<group>/<feature>` |
| C-R17 | `planImport` | 150 command lỗi `REF_NOT_FOUND` | `errors.length ≤ 100`, phần tử cuối `TOO_MANY_ERRORS` |
| C-R18 · R15 | `checkSecretsInput` | missing `[A, B]`, given `{A, C}`; given `{A, B}` | `{missing:[B], extra:[C]}`; `{[],[]}` |

### 1.3 `tests/acceptance/M4/rules/contracts-cd.test.ts` — contract C + D (plan-cd §3, §4.1–4.3)

| Mã | Schema | Kỳ vọng |
|---|---|---|
| C-K01 · BR-04 | `ConfigFileSchema` | mẫu đủ 6 loại qua; khoá lạ ở gốc/phần tử lồng → fail; `format` khác, `format_version: 2` → fail; `secrets[0].value` / `secrets[0].last4` → fail; `workflows[0].secret_id` → fail; tenant thiếu `quotas` theo schema A |
| C-K02 | `ImportRequestSchema` | `x.YML` qua; `x.json`, 256 ký tự, khoá lạ → fail; `base_config_version: -1` fail |
| C-K03 | `ImportPreviewSchema`, `ImportResultSchema` | mẫu hợp lệ qua; `op: "delete"` fail; `errors[0].code` ngoài 10 mã → fail |
| D-K01 | verify request | `{totp_token, code:"012345"}` qua; `code:"12345"`, `"12a456"`, có cả `code`+`backup_code`, không có cả hai, khoá lạ → fail; `backup_code: "K7P2-9XQM"`, `"k7p29xqm"` qua |
| D-K02 · M4-AC11 | `LoginResponseSchema` | `{status:"totp_required", totp_token, expires_in:300}` qua; `expires_in: 600` fail; nhánh M1 vẫn qua |
| D-K03 | `MeSchema`, `UserSchema` | thiếu `totp_enabled` fail; `backup_codes_left` 0..10 qua, 11/-1 fail |
| D-K04 | `API_ERRORS` | chứa 9 mã: `PAYLOAD_TOO_LARGE 413, IMPORT_INVALID 400, SECRETS_REQUIRED 400, INVALID_TOTP_TOKEN 401, INVALID_OTP 401, INVALID_CURRENT_CODE 400, TOTP_ALREADY_ENABLED 409, TOTP_NOT_ENABLED 409, TOTP_SETUP_EXPIRED 409` (tập đầy đủ M4 kiểm ở test-plan A+B) |

### 1.4 `tests/acceptance/M4/rules/mailer.test.ts` — `lib/mailer` (plan-cd §9)

| Mã | Dữ liệu | Kỳ vọng |
|---|---|---|
| M-R01 · D10 | `createMailer({})` (không `SMTP_URL`) → `send` hợp lệ | reject `MailError`, `code = MAIL_DISABLED` |
| M-R02 · chống header injection | `createMailer({SMTP_URL:"smtp://127.0.0.1:1"})`: subject có `\r\n`, `\n`; `to: []`; 51 địa chỉ; `"not-an-email"`; subject 201 ký tự; text 100 KB + 1 | mỗi ca reject `MAIL_INVALID` (kiểm trước khi kết nối: không phải `MAIL_SEND_FAILED`) |
| M-R03 | `createMemoryMailer().send(m)` | `sent` = `[m]` |

## 2. Integration D · 2FA (`*.int.test.ts`, DB test + app thật)

### 2.1 `tests/acceptance/M4/totp-setup.int.test.ts` (T9b)

| Mã | Dữ liệu / bước | Kỳ vọng |
|---|---|---|
| D-S01 · FR-08 | binh `POST /auth/totp/setup {current_password: PW}` | 200; `secret` `^[A-Z2-7]{32}$`; `otpauth_url` chứa `secret=`; `qr_svg` bắt đầu `data:image/svg+xml;base64,`; `account_label "acme · binh"`; `expires_in 600`; header `Cache-Control: no-store`. DB `user_totp`: `enabled_at null`, `pending_expires_at = clock + 600 s`, `secret_ct` 36 byte, `secret_iv` 12 byte, `key_version 1`; 20 byte `unb32(secret)` **không** là chuỗi con của `secret_ct` |
| D-S02 · R16 + FR-07 | setup `current_password` sai ×5, rồi đúng | 400 `INVALID_CURRENT_PASSWORD` ×5 (`failed_logins` tăng 1..5); lần 6 → 423 `TEMP_LOCKED {until = clock+15'}` |
| D-S03 | setup 2 lần (secret S1, S2); enable bằng mã S1; rồi mã S2 | S1 ≠ S2; 400 `INVALID_CURRENT_CODE`; 200 |
| D-S04 · R16 | enable khi chưa setup; setup + clock +601 s rồi enable | 409 `TOTP_SETUP_EXPIRED` cả hai |
| D-S05 · D-plan §7 Enable | enable mã sai ×6 | 400 `INVALID_CURRENT_CODE` ×6; `failed_logins` **không đổi**; không 423 |
| D-S06 · M4-AC11 | enable mã đúng | 200 `backup_codes` 10 mã `^[ALPHABET]{4}-[ALPHABET]{4}$` khác nhau; `no-store`. DB: `enabled_at = clock`, `pending_expires_at null`, `last_used_step = stepOf(clock)`; `user_backup_codes` 10 hàng, `code_hash` 32 byte, `used_at null`; không hàng nào bằng `sha256(code)` hay chứa mã thô |
| D-S07 | đã bật: setup; enable | 409 `TOTP_ALREADY_ENABLED` cả hai |
| D-S08 | `GET /auth/me` trước / sau bật / sau dùng 1 mã dự phòng (D-L06) | `{false, null, 0}` → `{true, clock ISO, 10}` → `backup_codes_left 9` |
| D-S09 · R10, §4.4 | audit sau setup, enable | setup: 0 dòng; enable: đúng 1 dòng `create`, entity `user_totp`, `entity_id` = binh, `tenant_id` acme, `before null`, `after {enabled:true, backup_codes_left:10}`; `config_meta.version` không đổi; 0 NOTIFY |
| D-S10 · tự tắt | disable: mật khẩu sai; mật khẩu đúng + mã sai; mật khẩu đúng + mã đúng | 400 `INVALID_CURRENT_PASSWORD` (+1 bộ đếm); 400 `INVALID_CURRENT_CODE` (+1 bộ đếm); 204. DB `user_totp` 0 hàng, `user_backup_codes` 0 hàng (cascade); audit `delete` before `{enabled:true, backup_codes_left:10}` after `null`; me `totp_enabled false` |
| D-S11 | disable bằng `backup_code`; disable khi chưa bật | 204; 409 `TOTP_NOT_ENABLED` |
| D-S12 · Q-D1 | backup-codes: mã sai; mã đúng (bước sau `last_used_step`); khi chưa bật | 400 `INVALID_CURRENT_CODE` (+1 bộ đếm); 200 10 mã mới, không trùng mã cũ; mã cũ đăng nhập → 401 `INVALID_OTP`, mã mới → 200; audit `update` `{backup_codes_left: n}` → `{10}`; 409 `TOTP_NOT_ENABLED` |
| D-S13 · M4-AC12 | `an` (member) gọi setup/enable/disable/backup-codes; không Bearer | 403 `FORBIDDEN` ×4; 401 `UNAUTHORIZED` |
| D-S14 | enable `code:"12345"`; disable có cả `code` + `backup_code`; khoá lạ | 400 `VALIDATION_ERROR` |
| D-S15 | platform `admin` bật được | 200 (setup + enable), `account_label` bắt đầu `platform · ` |

### 2.2 `tests/acceptance/M4/totp-login.int.test.ts` (T9c)

| Mã | Dữ liệu / bước | Kỳ vọng |
|---|---|---|
| D-L01 · M4-AC11 | binh đã bật; `POST /auth/login` đúng | 200 `{status:"totp_required", totp_token, expires_in:300}`; không `access_token`, không Set-Cookie; JWT `aud "admin:totp"`, `exp-iat = 300`, `sub` = binh, `tid` = acme, có `pwc`, `tte` |
| D-L02 | verify `code = totpAt(secret, clock+30 s)` (bước > bước đã dùng khi bật) — web; lần khác với `X-Client: extension` | 200 TokenGrant + cookie `ai_rt` (web); extension: `refresh_token` trong body; `last_login_at = clock`, `failed_logins 0`, `last_used_step` = bước vừa dùng |
| D-L03 · R16 chống dùng lại | login lại, verify **cùng** mã D-L02; rồi mã bước cũ hơn | 401 `INVALID_OTP` cả hai; `failed_logins` +1 mỗi lần |
| D-L04 · plan D4 | 4 lần sai mật khẩu → login đúng mật khẩu | `totp_required`; `failed_logins` vẫn **4**; verify mã sai 1 lần → 401 (`failed_logins 5`, `locked_until = clock+15'`); verify mã đúng (cùng token) → 423 `TEMP_LOCKED`; login lại → 423 |
| D-L05 · M4-AC11 khoá tạm | 5 mã sai liên tiếp | 401 `INVALID_OTP` ×5; mã đúng → 423 `{until}`; clock = until → login + mã bước mới → 200, `failed_logins 0`, `locked_until null` |
| D-L06 · M4-AC11 mã dự phòng | verify `backup_code = codes[0]`; login lại dùng `codes[0]`; `codes[1]` viết HOA không gạch | 200; 401 `INVALID_OTP`; 200. DB: 2 hàng `used_at` khác null |
| D-L07 · token hỏng | `totp_token` = chuỗi rác; access token; `change_token`; ký bằng khoá khác; hết hạn (clock +301 s) | 401 `INVALID_TOTP_TOKEN` ×5; `failed_logins` không đổi |
| D-L08 · token mất hiệu lực | lấy token rồi: (a) admin reset mật khẩu binh; (b) binh tắt 2FA (phiên khác); (c) tắt rồi bật lại | verify mã đúng → 401 `INVALID_TOTP_TOKEN` cả 3 |
| D-L09 · Q10 thứ tự | chi bật 2FA, owner đặt `must_change_password = true`; login → verify | `totp_required` → 200 `{status:"password_change_required", change_token}` |
| D-L10 · R04 M1 | binh bật 2FA rồi `active=false`: login đúng; ca 2: lấy token rồi khoá user → verify | 403 `ACCOUNT_LOCKED` (không có `totp_token`); 403 `ACCOUNT_LOCKED` |
| D-L11 | `an` (không bật) login | TokenGrant như M1 (luồng cũ không đổi) |
| D-L12 | verify `code:"12a456"`, có cả 2 trường, không trường nào | 400 `VALIDATION_ERROR` |
| D-L13 · Q6 | sau D-L01..L06 | số dòng `audit_log` không đổi do login/verify |
| D-L14 · R16 song song | 2 verify song song cùng mã đúng (2 token) | đúng 1 × 200, 1 × 401 `INVALID_OTP` |
| D-L15 · FR-07 song song | 10 verify sai song song + 1 đúng | `locked_until` khác null; lần đúng kế → 423 |

### 2.3 `tests/acceptance/M4/totp-admin-reset.int.test.ts` (T9d)

| Mã | Dữ liệu / bước | Kỳ vọng |
|---|---|---|
| D-A01 · Q10 | platform admin `POST /admin/users/{binh}/totp/disable` | 200 `User` `totp_enabled false`; DB 0 hàng `user_totp`/`user_backup_codes` của binh; audit `delete`, `actor` = admin, `entity_id` binh, `tenant_id` acme, before `{enabled:true, backup_codes_left:10}`, after `null`; binh login → TokenGrant thẳng |
| D-A02 · BR-09 · AC-A09 | binh → chi; binh → hoa (globex, đã bật); binh → `UNKNOWN_ID` | 200; 404 `NOT_FOUND` (hàng `user_totp` của hoa còn nguyên); 404 |
| D-A03 | binh → binh; admin → admin | 403 `SELF_ACTION_FORBIDDEN` |
| D-A04 | target chưa bật (an) | 409 `TOTP_NOT_ENABLED` |
| D-A05 · M4-AC12 | `an` (member) → chi | 403 `FORBIDDEN` |
| D-A06 | `GET /admin/users`, `/admin/users/:id` | `totp_enabled` đúng từng user; quét: không khoá `totp_secret`, `secret_ct`, `backup`, `code_hash` |
| D-A07 · plan §7 giữ phiên | binh đăng nhập `X-Client: extension` (có `refresh_token`, `access_token`) trước khi admin tắt hộ; sau khi tắt: `/auth/me` bằng access token cũ; `POST /auth/refresh` bằng refresh token cũ | 200; 200 (TokenGrant mới) — không thu hồi phiên |

### 2.4 `tests/acceptance/M4/totp-db.int.test.ts` (T9a)

| Mã | Dữ liệu | Kỳ vọng |
|---|---|---|
| D-DB01 · plan §5 | `information_schema` | 2 bảng, cột/kiểu/null đúng plan §5; CHECK: `secret_ct` 35 byte → 23514; `enabled_at null` + `pending_expires_at null` → 23514; `code_hash` 31 byte → 23514 |
| D-DB02 · BR-09 | role `admin_api` scope globex SELECT 2 bảng; INSERT với `tenant_id` acme | 0 hàng của acme; INSERT → 42501/RLS lỗi |
| D-DB03 · D1, R10 | `SET ROLE hub_ro` SELECT 2 bảng; `has_table_privilege('hub_ro', …, 'SELECT')` | 42501; `false` |
| D-DB04 | owner xoá user (có 2FA) | hàng `user_totp`, `user_backup_codes` theo FK cascade biến mất |
| D-DB05 · BR-04 | sau bật + đăng nhập + tạo lại mã: `scanDatabase(owner, [secret, ...backupCodes, totp_token, otpauth_url])` | `[]` (kể cả `audit_log`) |
| D-DB06 · BR-04 log | `captureLogs()` quanh setup/enable/verify/backup-codes/disable | log không chứa secret, `otpauth_url`, `qr_svg`, mã TOTP đã gửi, mã dự phòng, `totp_token`, `current_password` |

## 3. Integration C · Import / Export

Phụ lục [test-plan-cd-transfer.md](test-plan-cd-transfer.md): `export.int` C-E01..E09, `import-dry-run.int` C-I01..I14, `import-apply.int` C-A01..A15.

## 4. Mailer với Mailpit · `tests/acceptance/M4/mailer.int.test.ts` (TM)

| Mã | Dữ liệu | Kỳ vọng |
|---|---|---|
| M-I01 · D10 | `createMailer({SMTP_URL:"smtp://127.0.0.1:1025", MAIL_FROM:"AI System QC <qc@ai-system.local>"})`, to `binh@acme.test`, subject `[M4-qc] gửi thử`, text `Xin chào` | resolve; Mailpit search subject → đúng 1 thư, To `binh@acme.test`, From `qc@ai-system.local`, Subject nguyên văn UTF-8, Text `Xin chào` |
| M-I02 | không `MAIL_FROM` | From = `no-reply@ai-system.local`, tên `AI System` |
| M-I03 | `SMTP_URL smtp://127.0.0.1:1` (cổng đóng) | reject `MAIL_SEND_FAILED` trong ≤ 15 s |
| M-I04 · log | `captureLogs()` quanh M-I03 | log không chứa địa chỉ `binh@acme.test` và nội dung thư |

(Email cảnh báo quota R05: test-plan A+B.)

## 5. E2E

Phụ lục `test-plan-cd-e2e.md` (vượt trần 30 KB, WORKFLOW Kỷ luật token #5; lệnh `bunx playwright test e2e/m4-`): `e2e/m4-2fa.spec.ts` E-2FA-01..13, `e2e/m4-transfer.spec.ts` E-TR-01..11.

## 6. Ma trận độ phủ

| Yêu cầu | Hàng test |
|---|---|
| ADM-FR-08 (MUST) | D-R01..R18, D-K01..K04, D-S*, D-L*, D-A*, D-DB*, E-2FA-* |
| ADM-FR-54 (MUST) | C-R*, C-K01..K03, C-E*, C-I*, C-A*, E-TR-* |
| ADM-BR-04 | C-R03, C-K01, C-E02, C-I07, C-I08, C-A05, D-DB03, D-DB05, D-DB06, D-A06, E-2FA-09, E-TR-03, E-TR-05 |
| ADM-BR-09 · AC-A09 | D-R18, D-A02, D-DB02, C-A14 |
| AC-A06 (vế export) | C-R03, C-E02, E-TR-03 |
| M4-AC09 | C-R06, C-E01, C-E09, C-I01..I03, E-TR-01..04 |
| M4-AC10 | C-A01..A08, E-TR-05 |
| M4-AC11 | D-S06, D-L01..L06, E-2FA-01..06 |
| M4-AC12 (phần C+D) | D-S13, D-A05, C-E06, C-I12, E-2FA-12 |
| M4-R14 | C-R*, C-E*, C-I09, C-I10, C-A04..A10 |
| M4-R15 | C-R18, C-A01, C-A02 |
| M4-R16 | D-R*, D-S01..S06, D-L03..L08, D-L14 |
| M4-R10 (audit C+D) | D-S09, D-S10, D-S12, D-A01, D-L13, C-A05 |
| Mailer (plan §9, R05 hạ tầng) | M-R01..R03, M-I01..I04 |

Không có test: lock-order E4 (`transfer.lock-order.int.test.ts` — backend T8 tự viết, plan-cd §8.4); `evaluateTenant` sau import (khối A).

## 7. File test sẽ tạo (Q2)

`tests/acceptance/M4/_totp.ts` · `_cd.ts` · `_transfer-data.ts` · `rules/totp.test.ts` · `rules/transfer.test.ts` · `rules/contracts-cd.test.ts` · `rules/mailer.test.ts` · `totp-setup.int.test.ts` · `totp-login.int.test.ts` · `totp-admin-reset.int.test.ts` · `totp-db.int.test.ts` · `export.int.test.ts` · `import-dry-run.int.test.ts` · `import-apply.int.test.ts` · `mailer.int.test.ts` · `e2e/support/totp.ts` (gồm `enable2faApi`) · `e2e/m4-2fa.spec.ts` · `e2e/m4-transfer.spec.ts`. Sửa `e2e/support/helpers.ts` `resetFixture()`: xoá `admin.user_totp` (cascade mã) mỗi lần reset.

## 8. Test khoá cũ cần sửa (Q2, cập nhật lock, ghi lý do)

| File | Ca | Lý do · cách sửa |
|---|---|---|
| `tests/acceptance/M1/rules/contracts.test.ts` | `LoginResponseSchema phân biệt theo status` (mẫu `me`); dòng 55 `API_ERRORS` 36 mã | `MeSchema` thêm 3 trường bắt buộc → mẫu thêm `totp_enabled:false, totp_enabled_at:null, backup_codes_left:0`; số mã: đổi sang `toMatchObject` tập cũ (tập đủ M4 kiểm ở test mới) |
| `tests/acceptance/M2/rules/contracts.test.ts` | dòng 77 (`toEqual` 36 mã), 116 | như trên — **phối hợp qc A+B** (cùng thêm mã) |
| `tests/acceptance/M3/rules/contracts.test.ts` | dòng 70 | như trên |
| `tests/acceptance/M3/rules/contracts-users.test.ts` | mẫu `u(0)` `UserSchema` | thêm `totp_enabled:false` |
| `tests/acceptance/M1/db-schema.int.test.ts`, `M2/db-schema.int.test.ts` | danh sách bảng `admin.*` cố định (nếu `toEqual`) | thêm `admin.user_totp`, `admin.user_backup_codes` (+ bảng A/B) — phối hợp qc A+B |
| `tests/acceptance/M1/auth-*.int.test.ts`, `e2e/auth.spec.ts` | — | **không sửa**: fixture M1 không có user bật 2FA, luồng cũ giữ nguyên (D-L11 kiểm lại) |

## 9. Đã chốt (spec-readiness lần 1)

- Nút xác nhận trong `alertdialog "Tắt xác thực hai bước?"` = "Tắt xác thực hai bước" (trong phạm vi dialog); nút `⋯` hàng Users = `button "Thao tác khác"`; sai mật khẩu/mã ở dialog tắt/tạo lại → `twofa.error.wrongCreds`.
- Tập mã `API_ERRORS` M1–M3: `toMatchObject` (§8); đếm 48 chỉ ở test-plan A+B R20.
- Độ phủ: FR-08, FR-54 MUST đủ (xem §6).

## 10. Đỏ đúng lý do (điền ở Q2)

| File | Ca đỏ / tổng | Đỏ ở | Ghi chú |
|---|---|---|---|
| (chưa chạy) | | | |
