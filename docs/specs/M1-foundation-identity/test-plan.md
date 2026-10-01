# Test plan · M1-foundation-identity (qc)

Chế độ WRITE (trước Gate) · 2026-10-01 · Chỉ có **kế hoạch**: chưa viết file test. File test được viết ở task Q2 (sau Gate G1), đỏ vì chưa có code, rồi khoá ở Q3.
"Đúng" = các luật `M1-R01…R22` (`spec.md` §2), contract `spec.md` §3 (bảng endpoint + bảng mã lỗi `API_ERRORS`), dữ liệu `spec.md` §4, 3 AC của BA (`AC-A01`, `AC-A02`, `AC-A09`) và 8 AC do spec đề xuất (`M1-AC01…M1-AC08`, qc **xác nhận cả 8**, xem mục 8). Chữ ký hàm thuần: `plan.md` §4; seed/`createApp`/DB: `plan.md` §6–§7; nhãn UI nguyên văn: `plan-frontend.md` §7–§8. Không đọc code implementation.

## 1. Quy ước

- **Thư mục:** `tests/acceptance/M1/` (đúng `spec.md` §8 và `tasks.md` Q2; mã FR/BR/NFR nằm ở **tên test**, nên `trace` (T-TRACE-2) vẫn tính). Hàm thuần ở `tests/acceptance/M1/rules/`. E2E ở `e2e/`. Helper dùng chung `tests/acceptance/M1/_fixtures.ts` (không chứa `it(...)`).
- **Tên test:** `it("<mã chính> · <AC/luật> · <hành vi>")`, ví dụ `ADM-FR-07 · AC-A01 · lần sai thứ 5 vẫn 401, lần 6 → 423 TEMP_LOCKED`. Mã chính là FR/BR/NFR; AC và `M1-Rnn` đi sau. Không để chuỗi dạng `it("<mã khác>` trong dữ liệu mẫu (như M0 mục 1).
- **Loại:**
  - **rules** (`bun test`, không DB): hàm thuần trong `*.rules.ts` + hằng/schema contract.
  - **int** (`*.int.test.ts`, `bun run test:int`, cần Postgres): API qua `createApp(cfg, deps)` in-process + DB `ai_system_test`; truy vấn DB trực tiếp.
  - **proc** (int có spawn `bun apps/admin-api/src/server.ts`, cổng 3092): kiểm hành vi tiến trình (thoát khi role DB sai, log không lộ bí mật, CORS thật).
  - **e2e** (Playwright, chromium, locale `vi-VN`).
  - **lệnh kiểm**: lệnh ở gốc repo, qc chạy ở VERIFY/T8 và CI.
- **App trong test (theo `plan.md` §6.2):** `createApp({version, corsOrigins}, { db: createDb(TEST_ADMIN_API_DATABASE_URL), keys, appEnv: "test", dummyHash, now: clock.now })`. `keys` sinh bằng `generateKeyPairSync("ed25519")` trong fixture (PEM PKCS8/SPKI, `kid="test-kid"`), nạp qua `loadJwtKeys`. `dummyHash` = `hashPassword("dummy")`. Migrate/seed/reset bằng owner `TEST_DATABASE_URL`; **mọi request API đi qua role `admin_api`** (không bao giờ owner) để RLS thật sự tham gia.
- **Đồng hồ:** `clock = { now: () => Date, set(d), advance(ms) }`, mặc định cố định `2026-10-01T09:00:00.000Z`. Dùng cho khoá tạm (R03: `until`, biên 15 phút). **Không** dùng `clock` cho refresh (ân hạn 10 s, hạn 30 ngày) và JWT: các test đó chỉnh `revoked_at`/`expires_at` bằng owner SQL (`update … set revoked_at = revoked_at - interval '11 seconds'`). Không `sleep` cố định; chờ theo điều kiện, hạn chót rõ ràng.
- **Giả mạo JWT** (token hết hạn, sai `aud`, sai khoá, `alg` khác): ký trong test bằng `jose` + khoá test (cần `jose` 6.2.12 làm devDependency ở **gốc** repo — đã Accepted ở ADR-0001, xem Lỗ hổng G3).
- **Cô lập dữ liệu:** `beforeAll` mỗi file int: `resetTestDb` → `runMigrations({url, appEnv:"development"})` (chạy cả migration dev để `admin_api` có LOGIN) → `runSeed`. `beforeEach` (file có đột biến): `resetFixture()` = owner `TRUNCATE admin.refresh_tokens, admin.users, admin.tenants CASCADE` → `runSeed` → chèn fixture mục 3. Hash argon2 tính **một lần mỗi file** (3 mật khẩu), chèn lại nhiều lần (~22 ms/hash, plan §9).
- **Ngoại lệ D2 (`db-schema.int.test.ts`):** chỉ dùng owner (`TEST_DATABASE_URL`) + `resetTestDb` + `runMigrations`; **không** `runSeed`, không import `_fixtures.ts` (có seed/app) và không dựng app, để chạy được ngay khi chỉ có migration (T2), trước seed (T3) và `createApp` (T5).
- Không `skip`/`only`; dữ liệu cố định, không ngẫu nhiên (uuid cố định dạng `01900000-0000-7000-8000-0000000000nn`); tất cả file dưới `tests/acceptance/**` và `e2e/**` vào `tests/.lock`.
- Kiểm mọi response lỗi bằng `ErrorResponseSchema` (M0) + `status === API_ERRORS[code]` + `X-Request-Id`; response thành công parse bằng schema contract tương ứng (`TokenGrantSchema`, `UserSchema`…).

## 2. Ma trận truy vết

Cột "Số test" = dự kiến (±10%). Ưu tiên theo `ba-admin.md`: FR-01…05, 60, 61, 63 là **MUST** (8 mã); FR-06, 07 SHOULD; BR/NFR kèm theo.

| Mã | Ưu tiên | Test chính (file ở mục 4) | Số test |
|---|---|---|---|
| ADM-FR-01 (đăng nhập) | MUST | A1 `auth-login`, A8 `server`, E1 `auth.spec` | 22 |
| ADM-FR-02 (refresh xoay vòng) | MUST | A2 `auth-refresh` | 14 |
| ADM-FR-03 (đăng xuất) | MUST | A2 `auth-refresh` (nhóm logout) | 5 |
| ADM-FR-04 (CRUD user, reset mật khẩu) | MUST | A5 `users`, E3 `users.spec` | 38 |
| ADM-FR-05 (khoá user thu hồi token) | MUST | A5 `users`, A2 | 9 |
| ADM-FR-06 (must_change_password) | SHOULD | A3 `auth-password`, E1 | 12 |
| ADM-FR-07 (khoá tạm 5 lần/15 phút) | SHOULD | A1, A3, R1 | 9 |
| ADM-FR-60 (CRUD tenant + first admin) | MUST | A4 `tenants`, E2 `tenants.spec` | 17 |
| ADM-FR-61 (khoá/mở khoá tenant) | MUST | A4, E2 | 9 |
| ADM-FR-63 (username duy nhất trong tenant) | MUST | A5, D2 `db-schema` | 4 |
| ADM-BR-05 (3 role) | — | A6 `middleware`, A5, R2 | 9 |
| ADM-BR-08 (không tự khoá/hạ; còn ≥ 1 admin) | — | A5, R2, E3 | 12 |
| ADM-BR-09 (cách ly tenant, 404) | — | A5, A4, D1 `db-rls` | 10 |
| ADM-NFR-01 (argon2id, token hash, EdDSA, không log bí mật) | — | A1, A2, A8, B1 | 8 |
| ADM-NFR-06 (seed, migration có version) | — | B1 `seed`, M0-migrate (sửa), D2 | 14 |
| ADM-NFR-07 (RLS + role không bypass) | — | D1, D2, D3 `db-guard` | 18 |
| AC-A01 · AC-A02 · AC-A09 | — | mục 7 (ánh xạ riêng) | gộp |
| M1-AC01…AC08 | — | mục 7 | gộp |
| M1-R22 (i18n) | — | C1 `i18n-labels`, lệnh `i18n:check` | 3 |

`ADM-FR-62` (Group), `FR-08` (2FA), `FR-54`, `ADM-NFR-03/05` **ngoài phạm vi M1** (spec §1): không test; `ADM-NFR-03` (CRUD < 300 ms) và ngân sách §6 do backend-lead đo ở `users.perf.int.test.ts`, qc chỉ chạy lại ở VERIFY.

## 3. Dữ liệu seed / fixture (`_fixtures.ts`)

Mật khẩu: `PW = "Test-Passw0rd-1"` (mọi user thường), `SEED_PW = "Seed-Admin-Pw-01"` (admin seed; hằng này **chỉ dùng cho test int**, truyền thẳng vào `runSeed({adminUsername:"admin", adminPassword: SEED_PW})`, không đọc env; trùng giá trị `SEED_ADMIN_PASSWORD` mà CI đặt), `TEMP_PW = "Temp-Passw0rd-1"` (user `must_change_password=true`). Mọi user không ghi `last_login_at` thì để null. Hash: argon2id qua `hashPassword` (`@ai/db`).

| Tenant | key | active | max_concurrent_sub | Ghi chú |
|---|---|---|---|---|
| platform | `platform` | true | null | do `runSeed` tạo (tên "Nền tảng") |
| acme | `acme` | true | 5 | tenant chính |
| globex | `globex` | true | null | tenant "khác" cho cách ly; chỉ 1 tenant_admin |
| zeta | `zeta` | **false** | null | tenant đã khoá sẵn (user `locked_by_tenant=true`) |

| Tenant | username | role | email | trạng thái / ghi chú |
|---|---|---|---|---|
| platform | `admin` | platform_admin | null | seed; `must_change_password=false` |
| platform | `admin2` | platform_admin | null | để test hai platform_admin khoá nhau |
| acme | `binh` | tenant_admin | binh@acme.test | `last_login_at = 2026-09-30T08:00:00Z` |
| acme | `chi` | tenant_admin | chi@acme.test | tenant_admin thứ hai; `last_login_at = 2026-09-30T08:00:00Z` |
| acme | `an` | member | null | `last_login_at` null |
| acme | `lan` | member | lan@acme.test | |
| acme | `dung` | member | null | `must_change_password=true`, mật khẩu `TEMP_PW` |
| acme | `em` | member | null | `active=false` |
| acme | `thu` | member | null | `last_login_at` null; dùng riêng cho ca khoá tạm của e2e (E1) |
| globex | `hoa` | tenant_admin | hoa@globex.test | **tenant_admin duy nhất** |
| globex | `an` | member | null | cùng username `an` ở tenant khác (FR-63) |
| globex | `khang` | member | null | |
| zeta | `zoe` | tenant_admin | zoe@zeta.test | `locked_by_tenant=true` |
| zeta | `zed` | member | null | `locked_by_tenant=true` |

Helper: `login(tenantKey, username, pw, {client?})`, `bearer(token)`, `api(app).get/post/patch(path, {token, body, cookie, headers})`, `sha256(token)`, `owner` (kết nối owner), `asAdminApi` (kết nối `admin_api`), `clock`, `resetFixture()`, `decode(jwt)` (jose `decodeJwt`/`decodeProtectedHeader`).

## 4. Danh sách file và ca kiểm

### R. Hàm thuần (rules; không DB)

**R1 `rules/auth.rules.test.ts`** — theo `plan.md` §4 `auth.rules.ts` (≈ 14 test; ADM-FR-01/02/06/07, NFR-01)
- Hằng: `MAX_LOGIN_ATTEMPTS=5`, `TEMP_LOCK_MS=900000`, `ACCESS_TOKEN_TTL_S=900`, `REFRESH_TOKEN_TTL_S=2592000`, `CHANGE_TOKEN_TTL_S=300`, `REFRESH_GRACE_MS=10000`.
- `normalizeLoginId("  ACMe ") → "acme"`.
- `isTempLocked`: `null`→false; `now+1ms`→true; `=== now`→false; quá khứ→false.
- `clearExpiredLock`: khoá hết hạn (`lockedUntil <= now`) → `{0,null}`; còn hạn giữ nguyên; `{3,null}` giữ `{3,null}`.
- `afterFailedLogin`: 0→1, 3→4 (`lockedUntil` null); 4 → `{failedLogins:0, lockedUntil: now+15'}` chính xác theo ms.
- `canSignIn`: bảng 8 tổ hợp (`active`, `lockedByTenant`, `tenantActive`): chỉ `(true,false,true)` → true.
- `outcomeAfterPasswordOk`: khoá (user/tenant/tenant khoá) thắng `mustChangePassword`; `mustChange` → `password_change_required`; còn lại `authenticated`.
- `classifyRefresh`: `valid`; `expired` (`expiresAt == now` và `< now`); `superseded` (rotated, 0 ms và đúng 10 000 ms); `reuse` (rotated, 10 001 ms); `reuse` cho mọi `revokedReason` khác (`logout`, `reuse`, `user_locked`…) kể cả trong 1 s. **Không** kiểm tổ hợp "revoked + expired" (Lỗ hổng G4).
- `isAcceptableNewPassword`: "" / 9 ký tự false; 10, 128 true; 129 false.
- `generateTempPassword`: với RNG giả trả dãy cố định → đúng 16 ký tự, mọi ký tự thuộc `TEMP_PASSWORD_ALPHABET` (62 ký tự khác nhau, đúng tập `[A-Za-z0-9]`); ánh xạ `ALPHABET[byte % 62]` theo thứ tự byte; byte ≥ 248 bị loại và không lệch (dãy chứa 248…255 xen kẽ → kết quả giống dãy đã bỏ chúng); hai dãy RNG khác nhau → hai mật khẩu khác nhau; không gọi nguồn ngẫu nhiên nào ngoài `randomBytes`.
- `changeTokenMatches(date.getTime(), date)` true; lệch 1 ms false.

**R2 `rules/users.rules.test.ts`** — `users.rules.ts` (≈ 16 test; ADM-FR-04/05/63, BR-05/08/09)
- `isAdminRole`, `canManageUsers` (member false).
- `resolveTenantScope`: `tenant_admin` + query tenant khác → vẫn tenant mình (cả read/write); `platform_admin` read thiếu query → `{tenantId:null}`; write thiếu → `{code:"TENANT_REQUIRED"}`; write có id → `{tenantId:id}`.
- `canSeeUser`: cùng tenant true, khác tenant false (→ 404 ở tầng route).
- `checkRoleAssignment`: tenant `platform` + `member`/`tenant_admin` → `ROLE_NOT_ALLOWED`; tenant thường + `platform_admin` → `ROLE_NOT_ALLOWED`; `tenant_admin` gán `platform_admin` → `ROLE_NOT_ALLOWED`; hợp lệ → null (platform↔`platform_admin`, thường↔`member`/`tenant_admin`).
- `checkRoleChange`: đổi role của `platform_admin` sang bất kỳ role nào khác (người khác thực hiện) → `ROLE_NOT_ALLOWED`; tự đổi role (member→tenant_admin) → `SELF_ACTION_FORBIDDEN`; đổi role người khác → null; giữ nguyên role (self) → null. Thứ tự khi vừa tự đổi vừa là platform_admin: xem G2.
- `checkSelfAction`: self `lock`/`reset_password` → `SELF_ACTION_FORBIDDEN`; người khác → null.
- `isEmailRequired`: chỉ `tenant_admin`.
- `checkLastAdmin` (BR-08), bảng: target `tenant_admin` active, khoá, `others=0` → `LAST_ADMIN {scope:"tenant"}`; `others=1` → null; target `platform_admin`, `others=0` → `{scope:"platform"}`; hạ role `tenant_admin→member` `others=0` → LAST_ADMIN, `others=2` → null; target `member` → luôn null; target đã `active=false` (không còn là admin) → null; `change {}` (không đổi trạng thái/role) → null; `change {active:true}` → null.
- `userStatus`: `locked` ⇔ `!active || lockedByTenant`.
- `bumpsVersion`: true với `display_name|email|role|locale|active|locked_by_tenant|must_change_password|name|max_concurrent_sub`; false với `[]`, `failed_logins`, `locked_until`, `last_login_at`.

**R3 `rules/tenants.rules.test.ts`** (3 test; ADM-FR-60/61): `PLATFORM_TENANT_KEY==="platform"`; `canManageTenants` chỉ `platform_admin`; `checkTenantLock({key:"platform"}) → PLATFORM_TENANT_LOCKED`, `acme → null`; `tenantStatus`.

**R4 `rules/contracts.test.ts`** (đường dẫn đầy đủ `tests/acceptance/M1/rules/contracts.test.ts`) (≈ 8 test; ADM-FR-01, 60, 04): `API_ERRORS` **bằng đúng** bảng spec §3 (23 mã, từng cặp mã→HTTP: 400×6 `VALIDATION_ERROR TENANT_REQUIRED ROLE_NOT_ALLOWED EMAIL_REQUIRED PASSWORD_UNCHANGED INVALID_CURRENT_PASSWORD`; 401×5; 403×3; 404; 409×6; 423; 500); hằng/regex (`COMPANY_KEY_RE`, `USERNAME_RE`, `PASSWORD_MIN_LEN=10`, `PASSWORD_MAX_LEN=128`, `DISPLAY_NAME_MAX=64`, `EMAIL_MAX=254`, `LIST_LIMIT_DEFAULT=50`, `LIST_LIMIT_MAX=200`, `TEMP_PASSWORD_LEN=16`; `ROLES`, `LOCALES`); `LoginRequestSchema` trim+lowercase `tenant_key`/`username`, mật khẩu 1–128, trường lạ → fail; `ChangePasswordRequestSchema` đúng một trong hai dạng (cả hai/không có → fail); `TenantCreateRequestSchema` (`key` sai regex, `max_concurrent_sub` 0 / 10001 fail, null ok, `first_admin.email` bắt buộc); `TenantUpdateRequestSchema` từ chối `key`; `UserUpdateRequestSchema` từ chối `username`; `LoginResponseSchema` phân biệt `status`; list query `limit` 0/201 fail, `offset` âm / 100001 fail, mặc định 50/0, `q` rỗng bỏ.

### A. API tích hợp (int, in-process)

**A1 `auth-login.int.test.ts`** — `/auth/login` (ADM-FR-01, FR-07, FR-06, NFR-01; AC-A01; M1-R01…R05) ≈ 22 test
1. `acme/an` + `PW` → 200, `TokenGrantSchema` hợp lệ; `token_type "Bearer"`, `expires_in 900`, `user` = Me (`tenant.key "acme"`, `must_change_password false`).
2. **AC-A01 token:** header `alg=EdDSA`, `kid="test-kid"`; claim `sub`=id user, `tid`=id acme, `role "member"`, `iss "admin"`, `aud "ai-system"`, `exp - iat === 900`, có `sid`; chữ ký verify được bằng public key test.
3. Web: `Set-Cookie` có `ai_rt=`, `HttpOnly`, `SameSite=Strict`, `Path=/auth`, `Max-Age=2592000`, **không** `Secure` (appEnv test); body **không** có `refresh_token`. Với `appEnv:"production"` (app thứ hai) → có `Secure`.
4. Extension (`X-Client: extension`): body có `refresh_token` (≥ 43 ký tự base64url), **không** `Set-Cookie`; giá trị header khác (`Extension`, `web`) → coi là web.
5. Chuẩn hoá: `tenant_key " ACME "`, `username "AN"` → 200; `globex/an` → 200 với `tid` = globex (FR-63: cùng username khác tenant).
6. **M1-R01** (đồng nhất): tenant không tồn tại · user không tồn tại · sai mật khẩu · `em` (active=false) sai mật khẩu · `zeta/zed` sai mật khẩu → cả 5 là 401 `INVALID_CREDENTIALS`, **body giống nhau từng byte**, không `Set-Cookie`. (Thời gian verify giả không kiểm được tất định → G13.)
7. User không tồn tại không tạo/không tăng bộ đếm ở đâu (DB `users` không đổi sau 6 lần thử).
8. **AC-A01 khoá tạm (đồng hồ cố định):** 5 lần sai liên tiếp → `[401×5]` (lần 5 vẫn 401); lần 6 **đúng mật khẩu** → 423 `TEMP_LOCKED`, `details.until === "2026-10-01T09:15:00.000Z"`; trong lúc khoá, mật khẩu sai cũng 423 và **không** tăng bộ đếm; DB: `failed_logins=0`, `locked_until` đúng giá trị.
9. Biên hết khoá: `clock.set(until − 1 ms)` → vẫn 423; `clock.set(until)` → 200 (khoá `> now` mới tính) và `failed_logins=0`, `locked_until=null`.
10. Bộ đếm về 0 khi đăng nhập đúng: 4 sai + 1 đúng + 4 sai → vẫn 401 (không khoá); sau khoá hết hạn, 1 lần sai → `failed_logins=1` (đếm lại từ 1).
11. **M1-R04:** `em` + `PW` → 403 `ACCOUNT_LOCKED`; `zeta/zed` + `PW` → 403 (tenant khoá/`locked_by_tenant`); mật khẩu sai của hai user này → 401 `INVALID_CREDENTIALS`; 403 cũng đặt `failed_logins=0`.
12. **M1-R05:** `acme/dung` + `TEMP_PW` → 200 `{status:"password_change_required", change_token, expires_in:300}`; body **không** có `access_token`/`refresh_token`, không `Set-Cookie`; `change_token` có `aud "admin:password-change"`, `exp-iat===300`, `pwc` = `password_changed_at` epoch ms; không dùng làm Bearer (xem A6).
13. `last_login_at` được ghi khi đăng nhập thành công (≈ `clock.now`), **không** đổi khi thất bại / bị khoá; `users.version` không đổi sau mọi lần đăng nhập/thất bại (spec §3 "version chỉ tăng khi…").
14. Refresh token chỉ ở DB dưới dạng hash (NFR-01): `refresh_tokens.token_hash` = `sha256(token)` (bytea 32), `client` = `web`/`extension`, `family_id = id`, `expires_at ≈ now+30 ngày`; chuỗi token thô không xuất hiện ở bất kỳ cột nào của `admin.*`.
15. Mật khẩu lưu argon2id: `users.password_hash` bắt đầu `$argon2id$v=19$m=19456,t=2,p=1$`.
16. Validate: thiếu `tenant_key`/`username`/`password`; `password ""`; 129 ký tự; trường lạ; JSON hỏng (`issues[0].code "invalid_json"`) → 400 `VALIDATION_ERROR` với `details.issues[{path,code,message}]` đúng schema.
17. `Authorization` không bắt buộc ở `/auth/login`; `X-Request-Id` luôn có (M0).

**A2 `auth-refresh.int.test.ts`** — refresh + logout (ADM-FR-02, FR-03, FR-05; AC-A02, M1-AC04; M1-R07/R08) ≈ 19 test
1. **Xoay vòng:** đăng nhập → `POST /auth/refresh` (cookie) → 200 `TokenGrant` với access token mới (dùng được ở `GET /auth/me`) + cookie mới khác cookie cũ; DB: hàng cũ `revoked_at`≠null, `revoked_reason "rotated"`, `replaced_by` = id hàng mới, **cùng `family_id`**, `expires_at` hàng mới = hàng cũ (hạn tuyệt đối); sau 2 lần xoay `expires_at` vẫn bằng lần đăng nhập đầu.
2. Extension: refresh bằng body `{refresh_token}` + `X-Client: extension` → 200, `refresh_token` mới trong body, không cookie. Extension chỉ gửi cookie (không body) → 401 `INVALID_REFRESH_TOKEN`; web gửi body (không cookie) → 401 (quy tắc theo `X-Client`, G10).
3. Thiếu cookie/body, token lạ, token rỗng → 401 `INVALID_REFRESH_TOKEN`; web: response xoá cookie (`ai_rt=; Max-Age=0; Path=/auth`).
4. **ADM-FR-02 · ân hạn:** dùng lại token vừa xoay (≤ 10 s, chỉnh 9 s bằng owner) → 401 `REFRESH_SUPERSEDED`, response **không có `set-cookie`** (không xoá cookie, cookie hiện tại của client vẫn là token mới); chuỗi **không** bị thu hồi: token mới vẫn refresh được; DB không có hàng `revoked_reason='reuse'`.
5. **M1-AC04 · reuse:** sau khi `revoked_at` lùi 11 s → dùng lại token cũ → 401 `INVALID_REFRESH_TOKEN`; **mọi** hàng cùng `family_id` có `revoked_at` (hàng mới nhất `revoked_reason 'reuse'`); refresh bằng token mới của chuỗi → 401; cookie bị xoá.
6. Reuse chỉ thu hồi **đúng chuỗi**: phiên thứ hai của cùng user (đăng nhập lần 2, `family_id` khác) và phiên của user khác vẫn refresh được.
7. **Song song:** 5 `POST /auth/refresh` đồng thời cùng cookie → đúng 1 × 200 và 4 × 401 `REFRESH_SUPERSEDED` (cả 4 response **không có `set-cookie`**); DB: chuỗi có đúng 2 hàng (1 `rotated`, 1 sống); hàng sống refresh được.
8. Hết hạn: owner đặt `expires_at` quá khứ → 401 `INVALID_REFRESH_TOKEN` (không phải `REFRESH_SUPERSEDED`).
9. User/tenant không còn đăng nhập được: owner `update users set active=false` (không thu hồi token) → refresh 401 `INVALID_REFRESH_TOKEN`; tương tự `locked_by_tenant=true` và `tenants.active=false`.
10. **AC-A02 (phía Admin):** `an` (acme) đăng nhập kiểu extension; `binh` gọi `POST /admin/users/:an/lock` → 200; refresh của `an` → 401 `INVALID_REFRESH_TOKEN`; DB: mọi token của `an` `revoked_reason 'user_locked'`; access token đã cấp của `an` bị Admin chặn ngay (401 `UNAUTHORIZED`) và có `exp ≤ iat + 900` (Hub mất quyền chậm nhất 15 phút); token của user khác không bị đụng.
11. **Logout (FR-03):** cookie → 204 + xoá cookie; hàng `revoked_reason 'logout'`; refresh sau đó → 401 `INVALID_REFRESH_TOKEN`; idempotent: logout lần 2, token lạ, không token, body extension → 204 (không lỗi, không `Set-Cookie` lạ); `logout` không đụng phiên khác.
12. Không rò: response web **không bao giờ** chứa `refresh_token` trong body (đăng nhập, refresh, đổi mật khẩu bắt buộc); extension không bao giờ có `Set-Cookie`.

**A3 `auth-password.int.test.ts`** — đổi mật khẩu + `me` (ADM-FR-06, FR-07, NFR-01; M1-AC06; M1-R05/R06) ≈ 18 test
1. **Bắt buộc (M1-AC06):** đăng nhập `dung/TEMP_PW` → `change_token`; `new_password` 9 ký tự → 400 `VALIDATION_ERROR`; 129 → 400; `= TEMP_PW` → 400 `PASSWORD_UNCHANGED`; hợp lệ (`"New-Passw0rd-9"`) → 200 `TokenGrant` (+ cookie); DB: `must_change_password=false`, `password_changed_at` mới, `version+1`; đăng nhập lại bằng `TEMP_PW` → 401; bằng mật khẩu mới → 200 `authenticated` (không còn `password_change_required`).
2. `change_token` đã dùng (gửi lần 2) → 401 `INVALID_CHANGE_TOKEN` (`pwc` lệch); `change_token` hết hạn / sai khoá / sai chữ ký (ký bằng `jose`) → 401 `INVALID_CHANGE_TOKEN`; access token (`aud "ai-system"`) dùng làm `change_token` → 401 `INVALID_CHANGE_TOKEN`.
3. User bị khoá sau khi nhận `change_token` (owner `active=false`) → 403 `ACCOUNT_LOCKED`.
4. Thu hồi token khác: sau khi `dung` đổi mật khẩu (được reset trước để có phiên cũ: owner chèn 1 refresh token sống) → token cũ `revoked_reason 'password_changed'`.
5. **Tự đổi:** `an` (Bearer) `{current_password: PW, new_password}` → 204; mật khẩu cũ đăng nhập 401, mới 200; phiên **hiện tại** (`sid`) còn sống, phiên khác (family khác) `revoked_reason 'password_changed'`.
6. `current_password` sai → 400 `INVALID_CURRENT_PASSWORD` (**không** 401); 5 lần sai tính vào bộ đếm → lần 6 → 423 `TEMP_LOCKED {until}` (cả với mật khẩu hiện tại đúng); `new_password = current` → 400 `PASSWORD_UNCHANGED`; `new_password` < 10 → 400 `VALIDATION_ERROR`.
7. Dạng body: có cả `current_password` và `change_token`; không có cái nào; trường lạ → 400 `VALIDATION_ERROR`. Tự đổi không Bearer → 401 `UNAUTHORIZED`; `member` được phép tự đổi (BR-05).
8. **`GET /auth/me`:** 200 đúng `MeSchema` (`must_change_password:false`, `tenant:{id,key,name}`); không Bearer → 401. **`PATCH /auth/me {locale:"en"}`** → 200 `locale "en"`, DB `users.locale`, `version+1`; `locale:"fr"`, thiếu `locale`, trường lạ (`role`) → 400 `VALIDATION_ERROR`; không thể đổi `role` qua `PATCH /auth/me`.

**A4 `tenants.int.test.ts`** — `/admin/tenants*` (ADM-FR-60, FR-61, BR-09; M1-AC03; M1-R10/R15/R18) ≈ 26 test
- **List:** `admin` → 200 `{items,total,counts}` 4 tenant, sắp `key` tăng dần (`acme, globex, platform, zeta`); `user_count` đúng; `q=ACM` (ILIKE `key` và `name`); `status=locked` → chỉ `zeta`; `counts = {all:4, active:3, locked:1}` và `counts` **không** đổi theo `status`; `limit=1&offset=1` → 1 item, `total=4`; `limit=0`/`201`, `offset=-1`, tham số lạ → 400 `VALIDATION_ERROR`.
- **Tạo:** `POST` đầy đủ (`key "initech"`, `first_admin {username "lumbergh", display_name, email, locale "en"}`) → 201 đúng schema; `temp_password` khớp `^[A-Za-z0-9]{16}$`; `first_admin.role "tenant_admin"`, `must_change_password true`, `locale "en"`; tenant `active true`, `version 1`, `max_concurrent_sub null`; đăng nhập bằng mã công ty mới + `temp_password` → `password_change_required`; mật khẩu chỉ ở DB dạng argon2id (không lưu thô); hai lần tạo cho hai `temp_password` khác nhau.
- Lỗi tạo: `key` trùng (`ACME` viết hoa cũng trùng sau chuẩn hoá) → 409 `KEY_TAKEN` và DB không thêm hàng tenant/user nào; `key` sai (`a`, `A_b`, 33 ký tự), `max_concurrent_sub` 0 / 10001 / 1.5, `first_admin.email` thiếu/sai, `username` sai, trường lạ → 400 `VALIDATION_ERROR` và **không** tạo tenant (M1-R18, không có hàng "nửa vời"). (Lỗi giữa chừng trong transaction: backend-lead kiểm ở int test riêng — không chèn lỗi được từ API, G13.)
- **Xem/sửa:** `GET /:id` → `TenantDetail` với `stats {user_count, tenant_admin_count, locked_user_count}` đúng với fixture (acme: 7/2/1); id lạ / không phải uuid → 404 `NOT_FOUND`; `PATCH {version:1, name}` → 200, `version 2`, `updated_at` đổi; `version` cũ → 409 `VERSION_CONFLICT` với `details` parse được bằng `versionConflictDetailsSchema("tenant")`, `details.current` là bản mới nhất và `details.updated_at === details.current.updated_at`; body có `key` → 400; `max_concurrent_sub:null` xoá giới hạn.
- **Khoá (FR-61, M1-AC03):** `lock acme` → 200 `active false`, `status "locked"`; mọi user acme đang `active` có `locked_by_tenant=true`, `em` (đã `active=false`) **không** bị đổi `locked_by_tenant`; mọi refresh token acme bị thu hồi (`tenant_locked`); `an/PW` → 403 `ACCOUNT_LOCKED`, sai mật khẩu → 401; access token cũ của `an` → 401 `UNAUTHORIZED`; refresh cũ → 401 `INVALID_REFRESH_TOKEN`; tenant khác không đổi; idempotent: lock lần 2 → 200, `version` không đổi.
- **Mở khoá:** `unlock acme` → `active true`; `locked_by_tenant` gỡ cho các user bị khoá bởi tenant; `an/PW` đăng nhập lại được; **`em` (khoá riêng) vẫn 403 `ACCOUNT_LOCKED`**; idempotent.
- **`platform`:** `lock platform` → 409 `PLATFORM_TENANT_LOCKED`, DB không đổi. Lock/unlock id lạ → 404.
- **Phân quyền:** `tenant_admin` (binh) và `member` (an) gọi mọi endpoint `/admin/tenants*` → 403 `FORBIDDEN` (kể cả id lạ — kiểm role trước khi tra thực thể); không Bearer → 401 `UNAUTHORIZED`.

**A5 `users.int.test.ts`** — `/admin/users*` (ADM-FR-04, FR-05, FR-63, BR-05, BR-08, BR-09; AC-A02, AC-A09, M1-AC05, M1-AC07) ≈ 62 test
- **List/lọc (≈ 10):** `binh` → chỉ user acme (7), không thấy globex/platform; `?tenant_id=<globex>` bị bỏ qua cho `tenant_admin`; `admin` không `tenant_id` → mọi tenant, có `tenant_key`; `admin ?tenant_id=<globex>` → 3 user; sắp `username`, `id`; `q` khớp `username`/`display_name`/`email` (không phân biệt hoa thường); `role=tenant_admin`; `status=locked` (acme: `em`); `login=never` (acme: `an`, `lan`, `dung`, `em`, `thu`; không có `binh`, `chi` vì đã có `last_login_at`); `counts {all,active,locked}` theo cùng bộ lọc **trừ** `status`; `limit/offset/total`; `limit=201`, `login=sometimes`, tham số lạ → 400. `locked_until` hiện trong `User` khi bị khoá tạm.
- **Tạo (≈ 14):** `binh` tạo `member` (`username "nam"`) → 201 `{user, temp_password^[A-Za-z0-9]{16}$}`, `must_change_password true`, `locale "vi"`, thuộc acme; đăng nhập `nam/temp_password` → `password_change_required`. `admin` không `?tenant_id` → 400 `TENANT_REQUIRED`; `?tenant_id=` uuid không tồn tại → 404; `?tenant_id=<globex>` → tạo ở globex. `binh` truyền `?tenant_id=<globex>` → vẫn tạo ở **acme**. **M1-AC07:** `username "an"` tạo được ở tenant khác (đã có `an` ở cả acme/globex nên dùng `username "kim"` tạo ở cả hai) và trùng trong cùng tenant (`an` ở acme) → 409 `USERNAME_TAKEN` (cả khi viết `AN`); `EMAIL_TAKEN` (`LAN@ACME.test`, không phân biệt hoa thường), cùng email ở tenant khác được. `binh` tạo `platform_admin` → 400 `ROLE_NOT_ALLOWED`; `admin` tạo `member` ở tenant `platform` → 400 `ROLE_NOT_ALLOWED`; tạo `platform_admin` ở acme → 400 `ROLE_NOT_ALLOWED`. `tenant_admin` không email → 400 `EMAIL_REQUIRED`; `member` không email → 201. Tạo ở `zeta` (tenant khoá) → 201 với `locked_by_tenant true`, `status "locked"`. `username "NamNguyen"` (chữ hoa) → chuẩn hoá thành chữ thường, 201 và `user.username === "namnguyen"`; `username` 33 ký tự hoặc có ký tự lạ (`na m`, `na@m`) → 400 `VALIDATION_ERROR`; `display_name` trống/65 ký tự → 400; trường lạ → 400.
- **Xem/sửa (≈ 12):** `binh GET /:an` → 200; `PATCH {version, display_name}` → 200 `version+1`; `version` cũ → 409 `VERSION_CONFLICT {current: User}` (parse bằng `versionConflictDetailsSchema("user")`, `details.updated_at === details.current.updated_at`); body có `username` → 400; `email:null` cho `member` ok, cho `tenant_admin` → 400 `EMAIL_REQUIRED`; đổi `member→tenant_admin` không email → 400 `EMAIL_REQUIRED`, có email → 200; đổi sang email trùng → 409 `EMAIL_TAKEN`; `binh` tự đổi role → 403 `SELF_ACTION_FORBIDDEN`; `admin` đổi role `admin2` → 400 `ROLE_NOT_ALLOWED`; `admin` đổi `an` thành `platform_admin` → 400 `ROLE_NOT_ALLOWED`; `binh` hạ `chi` → 200 (acme còn `binh`); đăng nhập/`failed_logins` **không** làm `version` đổi.
- **AC-A09 / BR-09 (≈ 8):** `binh GET /admin/users/<id của globex/an>` → 404 `NOT_FOUND`, **body giống từng byte** với `GET` một uuid không tồn tại và với `:id = "abc"`; tương tự `PATCH`, `POST …/lock`, `…/unlock`, `…/logout-all`, `…/reset-password` trên user globex → 404 và DB không đổi (không khoá, không đổi mật khẩu, token còn). `hoa` (globex) không thấy `binh`. `admin` (platform) xem được cả hai tenant.
- **Khoá/mở khoá (FR-05, ≈ 9):** `binh lock an` → 200 `active false`, `status "locked"`, token thu hồi `user_locked`; `an` đăng nhập đúng → 403 `ACCOUNT_LOCKED`; idempotent (lần 2 → 200, `version` không đổi); `unlock an` → `active true`, **xoá khoá tạm** (`failed_logins 0`, `locked_until null`: khoá tạm bằng 5 lần sai rồi admin mở khoá → đăng nhập được ngay); `unlock` **không** gỡ `locked_by_tenant` (khoá tenant `zeta` rồi `unlock zed` → vẫn `status "locked"` và 403 khi đăng nhập). `logout-all` → 204: mọi refresh token (`logout_all`) bị thu hồi, `active` giữ nguyên, **access token đã cấp vẫn dùng được** (`GET /auth/me` 200 — M1-R09, không có danh sách thu hồi access token).
- **Reset mật khẩu (≈ 4):** `binh reset an` → 200 `{temp_password}` khớp 16 ký tự; `must_change_password true`; mật khẩu cũ → 401, `temp_password` → `password_change_required`; token của `an` bị thu hồi `password_reset`; `failed_logins`/`locked_until` về 0; hai lần reset cho hai mật khẩu khác nhau; `binh reset binh` → 403 `SELF_ACTION_FORBIDDEN`.
- **BR-08 (≈ 11):**
  - **M1-AC05 (a):** `hoa` (tenant_admin duy nhất của globex) `POST /:hoa/lock` → 403 `SELF_ACTION_FORBIDDEN`; tự hạ role → 403.
  - **M1-AC05 (b):** `admin` `lock hoa` → 409 `LAST_ADMIN {scope:"tenant"}`; `admin` `PATCH hoa {role:"member"}` → 409 `LAST_ADMIN`; sau khi `admin` tạo `tenant_admin` thứ hai ở globex → `lock hoa` thành công.
  - `admin lock zoe` (tenant `zeta` đang khoá, `zoe` là tenant_admin duy nhất) → 409 `LAST_ADMIN {scope:"tenant"}` (đếm admin áp cho cả tenant đang khoá, spec §3); `PATCH zoe {role:"member"}` cũng 409.
  - acme có `binh` + `chi`: `binh lock chi` → 200; sau đó `admin lock binh` → 409 `LAST_ADMIN`; `unlock chi` rồi `lock binh` → 200.
  - Đếm admin bỏ qua `locked_by_tenant` và tính mọi tenant (spec §3): globex còn `hoa` + admin thứ hai đã `active` nhưng `locked_by_tenant=true` (owner đặt) → vẫn tính là còn admin.
  - **Đồng thời:** `binh` và `chi` cùng lúc `POST …/lock` người kia (`Promise.all`) → đúng 1 kết quả 200 (kia: 409 `LAST_ADMIN` hoặc 401 `UNAUTHORIZED` nếu actor đã bị khoá trước khi xác thực); bất biến DB: acme còn ≥ 1 `tenant_admin` `active`. Lặp 10 vòng (fixture reset mỗi vòng). Tương tự `admin` ↔ `admin2` khoá nhau: luôn còn ≥ 1 `platform_admin` active.
  - `platform_admin` cuối cùng (`scope "platform"`): không tới được qua API (actor luôn là admin còn lại) → kiểm bằng R2 `checkLastAdmin` + test đồng thời ở trên.
- **BR-05 (≈ 4):** `member` (`an`) gọi `GET/POST /admin/users`, `PATCH/lock/unlock/logout-all/reset-password` → 403 `FORBIDDEN` (**M1-AC07**), cả khi body sai (role kiểm trước validate) và id lạ; `member` vẫn gọi được `/auth/me`, `/auth/logout`, đổi mật khẩu; `tenant_admin` không gán/không tạo `platform_admin`; `platform_admin` chỉ tồn tại ở tenant `platform`.

**A6 `middleware.int.test.ts`** — xác thực Bearer (NFR-01, BR-05, FR-05; ≈ 12 test)
Không Bearer / sai dạng → 401 `UNAUTHORIZED`; sai chữ ký (khoá khác); hết hạn (ký `exp` quá khứ); sai `aud` (dùng `change_token`); `alg: HS256`/`none`; sai `iss` → 401; **đọc lại DB mỗi request:** owner `active=false` → token còn hạn vẫn 401 ngay; owner hạ `role` `tenant_admin→member` (token vẫn claim `tenant_admin`) → `/admin/users` 403; owner khoá tenant → 401; user bị xoá khỏi DB (owner `delete`) → 401; `scope` platform chỉ khi role DB là `platform_admin`: token giả claim `role:"platform_admin"` của user `member` → 403 và không thấy dữ liệu tenant khác; mọi lỗi đúng `ErrorResponseSchema`.

**A7 `error-codes.int.test.ts`** — mã lỗi ↔ `API_ERRORS` (ADM-FR-01…; ≈ 4 test)
Bảng kịch bản `code → hàm gây lỗi` cho **22 mã** (mọi mã trừ `INTERNAL_ERROR`): chạy từng kịch bản trên fixture sạch, kiểm HTTP == `API_ERRORS[code]`, body parse `ErrorResponseSchema`, `message` tiếng Anh không rỗng, `details` đúng schema (`VALIDATION_ERROR.issues`, `VERSION_CONFLICT.current` (parse bằng `versionConflictDetailsSchema`, kèm `details.updated_at === details.current.updated_at`), `TEMP_LOCKED.until`, `LAST_ADMIN.scope`). Test cuối: tập mã đã chạy == `Object.keys(API_ERRORS)` trừ `INTERNAL_ERROR` (thêm mã mới vào contract mà thiếu kịch bản → đỏ). `INTERNAL_ERROR`: app dựng với `db` đã `close()` → `POST /auth/login` → 500, body `{error:{code:"INTERNAL_ERROR",…}}`, không có stack/chuỗi kết nối/`password` trong body.

**A8 `server.int.test.ts`** (proc, cổng 3092; ADM-NFR-07, NFR-01, FR-01; ≈ 8 test) — spawn `bun apps/admin-api/src/server.ts` với env: `PORT=3092`, `APP_ENV=test`, `CORS_ORIGINS=http://localhost:3000`, `ADMIN_API_DATABASE_URL=<admin_api>`, `JWT_*` sinh trong test.
1. `/health` 200; đăng nhập thật qua HTTP + `GET /auth/me` bằng token → 200.
2. **App thoát nếu role DB sai (NFR-07):** `ADMIN_API_DATABASE_URL = TEST_DATABASE_URL` (owner/superuser) → tiến trình thoát ≠ 0 trong hạn chót, đầu ra nhắc `ADMIN_API_DATABASE_URL`, không lộ mật khẩu DB; không bao giờ lắng nghe cổng (fetch `/health` thất bại).
3. Role có `BYPASSRLS` (owner tạo role phụ `admin_api_bypass_test` có `BYPASSRLS LOGIN`, dọn sau) → thoát ≠ 0; role sở hữu bảng trong `admin` → thoát ≠ 0.
4. Thiếu `ADMIN_API_DATABASE_URL` / `JWT_PRIVATE_KEY` → thoát ≠ 0, nêu **tên** biến, không in giá trị. Cặp khoá lệch (public của cặp khác) → thoát ≠ 0.
5. **Log không lộ bí mật:** đăng nhập (mật khẩu `Marker-Secret-Pw-7`), tạo user (nhận `temp_password`), refresh → gộp stdout+stderr của tiến trình không chứa mật khẩu, `temp_password`, access/refresh token, giá trị cookie, `Authorization`.
6. CORS: preflight `OPTIONS /auth/login` với `Origin: http://localhost:3000` → `Access-Control-Allow-Headers` gồm `Content-Type, Authorization, X-Client, X-Request-Id`; `Allow-Credentials: true`; origin lạ bị từ chối.

### B. Seed

**B1 `seed.int.test.ts`** (ADM-NFR-06, NFR-01; M1-AC01; M1-R20/R21; ≈ 12 test; owner `TEST_DATABASE_URL`)
1. DB sạch (sau migrate) → `runSeed` lần 1 trả `{tenant:"created", feature:"created", admin:"created"}`; lần 2 trả `{…"exists"×3}`.
2. Hàng tạo: đúng 1 tenant `platform` (`name "Nền tảng"`, `max_concurrent_sub null`, `active true`); 1 feature `core` (`name {"vi":"Cơ bản","en":"Core"}`, `status "on"`); 1 user `admin` (`role platform_admin`, `display_name "Platform Admin"`, `email null`, `locale "vi"`, `must_change_password false`, `active true`); hash `$argon2id$v=19$m=19456,t=2,p=1$`.
3. Lần 2 **không** đổi `password_hash` (so sánh chuỗi), `version`, `updated_at`, số hàng; lần 2 với `SEED_ADMIN_PASSWORD` khác → vẫn không đổi (không ghi đè mật khẩu).
4. **M1-AC01 đăng nhập bằng env:** sau seed, `login("platform","admin",SEED_PW)` qua app → 200 `role "platform_admin"`.
5. Tenant `platform` có sẵn (user khác) nhưng chưa có `admin` → tạo đúng user; đã có `admin` nhưng khác `role` → không ghi đè.
6. `loadSeedEnv`: thiếu `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` / `DATABASE_URL` → lỗi nêu **đúng tên biến** và không chứa giá trị; `SEED_ADMIN_PASSWORD` 9 ký tự, `SEED_ADMIN_USERNAME` `Admin!`/1 ký tự → lỗi nêu tên biến; `APP_ENV=production` + mật khẩu rỗng → lỗi.
7. CLI `bun packages/db/src/seed.ts` (env `DATABASE_URL=<test>`, `APP_ENV=test`, `SEED_*`): lần 1 in `db:seed OK: tenant created, feature created, admin created`, lần 2 `exists` ×3, exit 0; thiếu env → exit 1, đầu ra nêu tên biến và **không** chứa mật khẩu env.
8. Seed một transaction: DB hỏng giữa chừng (feature thiếu cột) không chèn lẻ — backend-lead kiểm; qc chỉ kiểm không có hàng nửa vời khi `SEED_ADMIN_USERNAME` hợp lệ nhưng `tenants.key` unique sẵn bị `platform` có name khác (không ghi đè).

### D. DB / RLS

**D1 `db-rls.int.test.ts`** (ADM-NFR-07, BR-09; **M1-AC02**; ≈ 16 test) — Owner chèn fixture (acme, globex, platform) bằng `TEST_DATABASE_URL`; truy vấn trực tiếp bằng `postgres` (`max:1`, để kiểm tái sử dụng kết nối) với `TEST_ADMIN_API_DATABASE_URL` (`admin_api`), **không đi qua app**. Đặt scope bằng `select set_config('app.scope', $1, true), set_config('app.tenant_id', $2, true)` trong `sql.begin`.
1. Không đặt scope: `count(*)` của `admin.users`, `admin.tenants`, `admin.refresh_tokens` đều = 0 (thiếu cấu hình → không thấy hàng nào).
2. **M1-AC02:** `scope=tenant, tenant_id=acme`, `select * from admin.users` **không có `WHERE`** → chỉ user acme (7), không có globex/platform; `admin.tenants` chỉ acme; `refresh_tokens` chỉ của acme. Lặp bằng `SET LOCAL ROLE admin_rw` từ owner (đúng chữ AC02: "role `admin_rw`").
3. Cô lập ghi: `update admin.users set display_name='x' where tenant_id = <globex>` (scope acme) → 0 hàng; `delete` → 0 hàng; `insert into admin.users (tenant_id=<globex>, …)` → lỗi `42501` (WITH CHECK); `insert` tenant mới ở scope tenant → `42501`; `update admin.tenants set name=… where id=<globex>` → 0 hàng.
4. `scope=platform` (không có `tenant_id`) → thấy cả 3 tenant; ghi được mọi tenant.
5. `app.tenant_id` rỗng/không phải uuid (`'abc'`) với scope tenant → lỗi hoặc 0 hàng, **không** rò dữ liệu; `app.scope='x'` lạ → như không có scope.
6. Không rò giữa transaction: transaction 1 đặt acme; transaction 2 trên **cùng kết nối** không đặt gì → 0 hàng; rollback không giữ scope.
7. Hàm SECURITY DEFINER: `admin_api` gọi `admin.tenant_id_by_key('acme')` → id acme (kể cả không có scope); key lạ → null; `tenant_id_by_refresh_hash(<sha256 token acme>)` → tenant acme; hash lạ → null. `SET ROLE hub_ro` rồi gọi cả hai hàm → lỗi quyền (`42501`); role `PUBLIC` không có EXECUTE.
8. Quyền `hub_ro`: `select password_hash from admin.users` → `42501`; `select id, tenant_id, username, role, active from admin.users` → thấy **cả hai** tenant (cột an toàn); `select * from admin.users` → `42501`; `select * from admin.refresh_tokens` → `42501`; `select * from admin.tenants` → thấy cả hai tenant; `select * from admin.features` ok; `insert`/`update` bất kỳ bảng `admin.*` → `42501`.
9. Thuộc tính role: `admin_api` có `rolcanlogin` (sau migrate dev/test), `rolsuper=false`, `rolbypassrls=false`, `rolcreatedb=false`, `rolcreaterole=false`, `rolreplication=false`, không sở hữu bảng nào trong `admin`; `pg_has_role('admin_api','admin_rw','member')`; `features` **không** bật RLS (`relrowsecurity=false`), 3 bảng còn lại `relrowsecurity=true`, **không** `FORCE`.
10. Hiệu quả RLS với app thật (BR-09 tầng hai): dựng app, token của `binh`; owner chèn thêm user globex; mọi list/get chỉ ra user acme; ngay cả khi gọi `/admin/users?tenant_id=<globex>`.

**D2 `db-schema.int.test.ts`** (ADM-NFR-06, FR-63, BR-05; ≈ 14 test; owner)
- `runMigrations` development: `{main:3, dev:2}`; lần 2 `{0,0}`; tạo đúng 4 bảng `admin.tenants|users|refresh_tokens|features` + 3 bảng `hub.*`; **không** có `groups`, `group_members`, `config_meta`, `secrets`, `workflows`, `commands`, `tenant_quotas`, `audit_log`, và **không** có cột `users.totp_secret` (spec §4, không làm 2FA).
- Ràng buộc/chỉ mục (chèn bằng owner, mong đợi đúng mã SQLSTATE + tên constraint): `tenants_key_uq` (`23505`); CHECK key `^[a-z0-9-]{2,32}$` (`23514` với `A`, `a`, `a_b`); `name` rỗng/129; `max_concurrent_sub` 0/10001; `users_tenant_username_uq` (cùng username khác tenant ok — **FR-63**); `users_tenant_email_uq` không phân biệt hoa thường, nhiều `email NULL` được phép; CHECK `role` (`superuser` → `23514`); CHECK `role <> 'tenant_admin' OR email IS NOT NULL`; `locale` (`fr`); `failed_logins < 0`; FK `users.tenant_id` RESTRICT (xoá tenant còn user → `23503`); `refresh_tokens`: `token_hash` 31 byte → `23514`, `token_hash` trùng → `23505`, `client` lạ, CHECK `(revoked_at IS NULL) = (revoked_reason IS NULL)`, `revoked_reason` lạ, xoá user CASCADE xoá token; `features.key`/`status` CHECK.
- Mặc định cột: `users.must_change_password true`, `locale 'vi'`, `active true`, `locked_by_tenant false`, `failed_logins 0`, `version 1`; `tenants.settings '{}'`.
- Chỉ mục tồn tại (theo `pg_indexes`): `users_tenant_role_active_idx`, `users_username_idx`, `refresh_tokens_user_active_idx`, `refresh_tokens_tenant_active_idx`, `refresh_tokens_family_idx`, `refresh_tokens_hash_uq`.
- production: `runMigrations({appEnv:"production"})` trả `{main:3, dev:0}`; có 4 bảng `admin.*`, 0 bảng `hub.*`; `to_regclass('drizzle.__drizzle_migrations_dev')` null.

**D3 `db-guard.int.test.ts`** (ADM-NFR-07; 4 test): `assertSafeDbRole(createDb(owner))` → ném (nêu `ADMIN_API_DATABASE_URL`); với `admin_api` → resolve; với role phụ có `BYPASSRLS` → ném; với role sở hữu bảng `admin` → ném. (Bổ sung cho A8: hành vi thoát tiến trình.)

### C. i18n

**C1 `i18n-labels.test.ts`** (M1-R22; ≈ 3 test, không DB): `vi.json` và `en.json` có **cùng tập key**; mọi key trong `plan-frontend.md` §7 có giá trị VI **và** EN nguyên văn (bảng cố định trong test, ví dụ `auth.error.invalid`, `auth.error.tempLocked`, `auth.error.accountLocked`, `session.expired.title`, `member.title`, `nav.main`, `nav.tenants`, `state.forbidden.title`, `state.notFound.title`, `state.offline.banner`, `errors.selfAction`, `errors.platformTenantLocked`, `errors.versionConflict`, `users.error.lastPlatformAdmin`); mọi nhãn e2e ở `plan-frontend.md` §8 xuất hiện làm giá trị đầy đủ trong `vi.json` (khoá khớp giữa e2e và i18n: "Mã công ty", "Tên đăng nhập", "Đăng nhập", "Đặt mật khẩu và tiếp tục", "Tạo tenant", "Thao tác khác", "Khoá tenant", "Mở khoá tenant", "Reset mật khẩu", "Đăng xuất mọi thiết bị", "Sao chép tất cả", …). Kèm lệnh kiểm `bun run i18n:check` exit 0.

### E. E2E (Playwright; nhãn nguyên văn `plan-frontend.md` §8; locale `vi-VN`, `Asia/Ho_Chi_Minh`)

Hạ tầng (xem G1): `e2e/support/prepare-db.ts` (reset + migrate + seed + fixture mục 3 bằng owner, hash tính một lần; **đọc `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD` từ `process.env`**; CI đặt `SEED_ADMIN_USERNAME=admin`, `SEED_ADMIN_PASSWORD=Seed-Admin-Pw-01`), `workers: 1`, mỗi file `test.beforeAll` gọi `resetFixture()`; spec trong file chạy `serial`. Đăng nhập UI qua helper `loginUI(page, tenant, username, pw)`.

**E1 `e2e/auth.spec.ts`** (ADM-FR-01, 06, 07, 03; ≈ 13 test; ca phiên hết hạn đã chuyển sang E3): tiêu đề `heading "Đăng nhập"` level 1; sai mật khẩu → `alert` "Sai mã công ty, tên đăng nhập hoặc mật khẩu." (không nêu trường nào sai), form giữ giá trị; nút "Đang đăng nhập…" khi gửi; user riêng `thu` (ca này **chạy cuối file**, không gọi `resetFixture()` sau đó): 5 lần sai + lần 6 → `alert` khớp `/Tạm khoá đến \d{2}:\d{2}/`; `binh` (tenant_admin, acme) đăng nhập đúng → `main` + `heading "Tổng quan"` + "Xin chào"; `navigation "Điều hướng chính"`: `binh` chỉ có `link "Users"`, không `Tenants`; `admin` có cả `link "Tenants"` và `link "Users"`; tải lại trang vẫn đăng nhập (refresh cookie); đăng xuất qua `button "Tài khoản của bạn"` → `menuitem "Đăng xuất"` → về `/login`, `POST /auth/logout` đã gọi; vào `/tenants` khi chưa đăng nhập → `/login?next=%2Ftenants`, đăng nhập xong về `/tenants`; `next=//evil.com` bị bỏ qua; tài khoản `em` → `alert` "Tài khoản đã bị khoá…"; **đổi mật khẩu bắt buộc (M1-AC06):** `dung` → `/change-password`, `heading "Đặt mật khẩu mới"`, không có `button "Bỏ qua"`, 9 ký tự → "Mật khẩu cần tối thiểu 10 ký tự", nhập lại lệch → lỗi, hợp lệ → vào khung, đăng nhập lại bằng mật khẩu mới thành công; `member` (`lan`) → `/member` `heading "Tài khoản của bạn dùng Chat App"`, vào `/users` bị chuyển về `/member`; tự đổi mật khẩu `/account/password` (sai hiện tại → lỗi dưới ô; đúng → toast "Đã đổi mật khẩu · các thiết bị khác đã được đăng xuất"); công tắc `button "English"` đổi nhãn sang "Sign in".

**E2 `e2e/tenants.spec.ts`** (ADM-FR-60, 61, BR-09; ≈ 9 test): `admin` → `/tenants` `table "Tenants"` có hàng `platform`, `acme`, `globex`; chip `radio "Đã khoá"` lọc `zeta`; `searchbox` lọc; `tenant_admin` vào `/tenants` → `heading "Bạn không có quyền xem trang này"` + `link "Về Tổng quan"`; tạo tenant (`link "+ Tạo tenant"` → `Mã công ty "initech"`, tên, email…) → `dialog "Đã tạo tenant initech"`: `textbox "Mật khẩu tạm"` khớp `^[A-Za-z0-9]{16}$`, `Esc`/click nền **không** đóng, `button "Đi tới tenant"` disabled tới khi tick `checkbox "Tôi đã lưu mật khẩu tạm"`, sau đó vào chi tiết; mã trùng → text "Mã công ty đã được dùng"; chi tiết: `tab "Thông tin"`, `textbox "Mã công ty"` readonly, sửa tên + `button "Lưu"` → toast `status` có nội dung "Đã lưu acme" (`tenants.toast.saved` = "Đã lưu {key}"); tab "Feature"/"Agent"/"Quota" hiện "Chưa khả dụng"; **khoá:** `button "Khoá tenant"` → `alertdialog "Khoá tenant acme?"`, `button "Khoá tenant"` trong dialog disabled tới khi gõ `acme` ở `textbox "Gõ acme để xác nhận"` → toast "Đã khoá acme"; user acme không đăng nhập được (kiểm UI hoặc API); `button "Mở khoá tenant"` → `alertdialog "Mở khoá acme?"` → toast "Đã mở khoá acme"; tenant `platform` không có nút khoá; id lạ → `heading "Không tìm thấy"`.

**E3 `e2e/users.spec.ts`** (ADM-FR-04, 05, BR-08, BR-09; ≈ 11 test, gồm ca phiên hết hạn): `binh` → `/users` `table "Users"` chỉ có user acme, hàng "binh (bạn)" menu `Thao tác khác` chỉ có `menuitem "Sửa"`; không có `combobox "Tenant"`; `admin` có `combobox "Tenant"`, mặc định "Tất cả tenant" → `button "+ Tạo user"` `aria-disabled="true"`; chọn `acme` → bật; tạo user: `dialog "Tạo user"` → khối `textbox "Mật khẩu tạm"` 16 ký tự, `button "Sao chép tất cả"`, đóng khi chưa sao chép → `alertdialog "Đóng mà chưa sao chép mật khẩu tạm?"`; username trùng → lỗi dưới ô; `tenant_admin` thiếu email → lỗi email; khoá `lan` qua `menuitem "Khoá"` → `alertdialog "Khoá lan?"` → badge "Đã khoá" + toast; `menuitem "Mở khoá"`; `Reset mật khẩu` → `alertdialog "Reset mật khẩu của lan?"` → mật khẩu tạm mới; `Đăng xuất mọi thiết bị` → `alertdialog "Đăng xuất lan khỏi mọi thiết bị?"`; **BR-08:** `hoa` (globex) mở drawer sửa chính mình: role disabled; `admin` khoá `hoa` (tenant_admin duy nhất) → thông báo "Tenant phải còn ít nhất một tenant_admin đang hoạt động"; `binh` mở `/users?drawer=edit&user=<id user globex>` → drawer "Không tìm thấy" (BR-09); phân trang `button "Sau"` khi > 50 user (fixture bổ sung 55 user cho một tenant `bulk` chèn bằng owner, một hash). **phiên hết hạn:** `binh` đăng nhập, vào `/users`, mở drawer `dialog "Tạo user"`, điền `textbox "Tên đăng nhập"`; owner đặt `active=false` cho `binh`; bấm `button "Tạo user"` → request nhận 401 `UNAUTHORIZED`, refresh cũng 401 → `dialog "Phiên đăng nhập đã hết hạn"` hiện ra; owner đặt lại `active=true`, nhập mật khẩu trong dialog, `button "Đăng nhập"` → dialog đóng, form còn nguyên giá trị đã điền và **không tự gửi lại** (DB không có user mới cho tới khi bấm lại `Tạo user`);

**E4 `e2e/m1-flow.spec.ts`** (**M1-AC08**; 1 test, `ADM-FR-01 · M1-AC08 · …`): đăng nhập bằng `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD` (đọc từ `process.env`, cùng nguồn với `prepare-db`) + mã công ty `platform` → shell (`navigation "Điều hướng chính"`) → `link "Tenants"` → `+ Tạo tenant` → điền → `Tạo tenant` → `dialog "Đã tạo tenant …"` hiện mật khẩu tạm một lần → tick, đi tới tenant → `Tài khoản của bạn` → `Đăng xuất` → `/login`. Sau đó đăng nhập bằng mã công ty mới + mật khẩu tạm → `/change-password` (mật khẩu tạm dùng được đúng một lần).

### M0 (sửa test khoá)

**`e2e/smoke.spec.ts`** (test khoá M0, M0-AC18) — thêm vào Q2, thay đổi phạm vi dự kiến (M1 có route guard, không phải tranh chấp): mở `/` khi chưa đăng nhập phải chuyển sang `/login`; `heading` level 1 "Đăng nhập"; `document.title` "Đăng nhập · Admin"; `html[lang="vi"]`; không có console error / pageerror. Bỏ các kỳ vọng cũ (H1 "Admin Console", text "Bảng quản trị nền tảng AI", title "Admin Console"). Giữ: status 200, landmark `main`, ảnh logo "EvoluConsulting" `naturalWidth > 0` nếu `/login` vẫn có logo (nếu không, bỏ ca logo và ghi lý do). Lock lại ở Q3.

**`tests/acceptance/ADM-NFR-06/migrate.int.test.ts`** — thay đổi phạm vi dự kiến, **không** phải tranh chấp (M1 thêm migration theo `spec.md` §4): `{main:1,dev:1}` → `{main:3,dev:2}`; danh sách bảng `admin`+`hub` thêm `admin.features|refresh_tokens|tenants|users`; "không có bảng admin.*" → "đúng 4 bảng admin.*"; production `{main:1,dev:0}` → `{main:3,dev:0}` và 4 bảng `admin.*` (0 `hub.*`); các kiểm vai trò `admin_rw`/`hub_ro`/default privileges giữ nguyên. Cập nhật ở Q2 và đưa vào lock lại ở Q3 (M0 đã khoá — sửa phải ghi lý do tại `spec.md` §10 hoặc "Quyết định trong lúc làm"). Các test M0 khác (`health`, `server.int`, `ci-workflow`, `mocks`…) giữ nguyên; xem G11.

## 5. Cách kiểm các hành vi đặc biệt (tóm tắt)

| Chủ đề | Cách kiểm |
|---|---|
| RLS tồn tại, không bypass | D1: truy vấn trực tiếp role `admin_api` (NOBYPASSRLS, không owner) không `WHERE`; `SET LOCAL ROLE admin_rw` từ owner cho AC02; thiếu scope = 0 hàng; `42501` khi ghi sai tenant; kiểm không rò giữa 2 transaction trên một kết nối (`max:1`) |
| App từ chối kết nối nguy hiểm | D3 (hàm) + A8 (tiến trình thoát ≠ 0, nêu `ADMIN_API_DATABASE_URL`, không lộ mật khẩu) với owner / `BYPASSRLS` / chủ sở hữu bảng |
| Refresh xoay vòng | A2.1: hàng cũ `rotated`, `replaced_by`, cùng `family_id`, `expires_at` kế thừa |
| `REFRESH_SUPERSEDED` ≤ 10 s | A2.4 (lùi `revoked_at` 9 s bằng owner) + A2.7 (5 request song song: 1×200, 4×`REFRESH_SUPERSEDED`); không thu hồi chuỗi |
| Reuse thu hồi cả chuỗi | A2.5 (lùi 11 s): mọi hàng cùng `family_id` bị thu hồi, token mới nhất cũng chết; A2.6: chuỗi khác sống |
| Khoá tạm (lần 5 = 401, lần 6 = 423) | A1.8–A1.10 với đồng hồ cố định, `until` đúng `+15'`, biên `until-1ms`/`until`, đếm về 0 |
| BR-08 `LAST_ADMIN` | A5 (nhóm BR-08) + R2 `checkLastAdmin` + đồng thời `binh`↔`chi`, `admin`↔`admin2` + bất biến DB |
| Mã lỗi | A7 chạy đủ kịch bản cho 22 mã + so với `API_ERRORS`; R4 khoá bảng mã→HTTP |
| Cách ly tenant (404 đồng nhất) | A5 AC-A09: body 404 giống byte với id lạ và id không phải uuid; mọi phương thức |
| Seed idempotent | B1 (hai lần, hash không đổi) + CLI |
| Bí mật không vào log | A8.5 quét stdout+stderr của tiến trình thật |

## 6. Việc ngoài test của qc (nhắc để không thiếu)

Backend-lead giữ: `rls.int.test.ts` (plan §3.5), `auth.service.int.test.ts`, test song song nội bộ, test giao dịch tạo tenant lỗi giữa chừng, `users.perf.int.test.ts` (ngân sách spec §6). Frontend-lead giữ: unit hàm thuần FE (`normalize`, `format`, `strength`, `schemas`, `errors`, `refresh-lock`, `status`, `next`). qc chạy lại tất cả ở VERIFY nhưng không khoá chúng.

## 7. Ánh xạ AC → test

| AC | Loại | File → ca | Dữ liệu | Kỳ vọng chính |
|---|---|---|---|---|
| AC-A01 | int + e2e | A1.1–A1.3, A1.8–A1.9; E1 (đăng nhập, tạm khoá) | `acme/an`; 5 lần sai | 200 + JWT `sub,tid,role`, `exp=iat+900`, refresh token; lần 6 → 423 `until` = +15'; UI "Tạm khoá đến HH:MM" |
| AC-A02 | int | A2.10; A5 (lock); A6 | `an` extension, `binh` khoá | refresh sau khoá → 401 `INVALID_REFRESH_TOKEN`; access token bị Admin chặn ngay, `exp ≤ iat+900` (Hub: kiểm ở phía Admin theo spec §8) |
| AC-A09 | int | A5 (nhóm AC-A09); D1.10 | `binh` → user `globex/an` | 404 `NOT_FOUND`, body y hệt id không tồn tại; mọi phương thức |
| M1-AC01 | int | B1.1–B1.4 | DB sạch, env seed | 1/1/1 hàng, hash không đổi lần 2, đăng nhập bằng env thành công |
| M1-AC02 | int | D1.2 | role `admin_rw`/`admin_api`, scope acme | `select * from admin.users` không `WHERE` chỉ thấy acme |
| M1-AC03 | int | A4 (khoá/mở khoá) | khoá `acme` | 403/401 theo R01/R04, refresh cũ bị từ chối; sau mở khoá `em` vẫn khoá |
| M1-AC04 | int | A2.5–A2.6 | token đã xoay | 401 + token mới cùng chuỗi chết |
| M1-AC05 | int | A5 (BR-08 a, b) | `hoa`; `admin` | 403 `SELF_ACTION_FORBIDDEN`; 409 `LAST_ADMIN` |
| M1-AC06 | int + e2e | A3.1; E1 | `dung/TEMP_PW` | `password_change_required` → đổi → đăng nhập thường; < 10 bị từ chối |
| M1-AC07 | int | A5 (BR-05, tạo) | `an` (member); `kim` ở acme & globex | `member` → 403; username trùng khác tenant ok, cùng tenant 409 |
| M1-AC08 | e2e | E4 | seed `admin` | luồng đăng nhập → tạo tenant → mật khẩu tạm một lần → đăng xuất |

**Xác nhận AC bổ sung:** qc xác nhận cả 8 `M1-AC01…08`, không sửa. Ghi chú đọc: M1-AC03 "403/401 theo R01/R04" được chốt là **403 `ACCOUNT_LOCKED` khi đúng mật khẩu, 401 `INVALID_CREDENTIALS` khi sai** (spec R04). AC-A01 "thông báo tạm khoá đến HH:MM" kiểm ở API (`details.until`) và UI (E1), AC-A02 "mất quyền Hub chậm nhất 15 phút" kiểm gián tiếp (`exp ≤ iat+900` + refresh bị từ chối) theo spec §8.

## 8. Lệnh kiểm / CI

Lệnh xong M1 (chép nguyên văn spec §8): `docker compose up -d --wait && bun run db:migrate && bun run db:seed && bun run check && bun run typecheck && bun test && bun run test:int && bun run i18n:check && bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web check:bundle && bunx playwright test && bun run test:lock:verify && bun run trace --check`. Thêm bước qc ở VERIFY: `bun run db:setup` (hai lần: lần 2 in `exists` ×3), `bun run db:generate` (không sinh gì), `bun run trace ADM-FR-01` … `ADM-NFR-07`.
CI cần: `db:migrate` + `db:seed` **trước** e2e, env `ADMIN_API_DATABASE_URL`, `TEST_ADMIN_API_DATABASE_URL`, `SEED_*`, khoá JWT (`keys:dev`), `jose` ở gốc; Playwright `webServer` khởi động admin-api + admin-web (G1).

### 8.1 Mỗi file test chạy được (xanh) ở task nào

Khớp `tasks.md` (commit 30a9de5). Q2 viết tất cả (đỏ); cột dưới là task sau đó file được kỳ vọng xanh.

| File | Xanh sau |
|---|---|
| `rules/contracts.test.ts` (R4) | T2 |
| `db-schema.int.test.ts` (D2), `ADM-NFR-06/migrate.int.test.ts` (M0, sửa) | T2 |
| `rules/auth.rules.test.ts` (R1) | T4 |
| `db-guard.int.test.ts` (D3), `auth-login.int.test.ts` (A1), `auth-password.int.test.ts` (A3), `seed.int.test.ts` (B1), `ADM-NFR-06/server.int.test.ts` (M0) | T5 |
| `rules/tenants.rules.test.ts` (R3), `tenants.int.test.ts` (A4) | T6 |
| `rules/users.rules.test.ts` (R2), `users.int.test.ts` (A5) | T7 |
| `db-rls.int.test.ts` (D1), `auth-refresh.int.test.ts` (A2), `middleware.int.test.ts` (A6), `error-codes.int.test.ts` (A7), `server.int.test.ts` (A8) | T7 |
| `i18n-labels.test.ts` (C1) | FE2 |
| `e2e/smoke.spec.ts` (M0, sửa), `e2e/auth.spec.ts` (E1) | FE3 |
| `e2e/tenants.spec.ts` (E2) | FE4 |
| `e2e/users.spec.ts` (E3), `e2e/m1-flow.spec.ts` (E4) | FE5 |

## 9. Độ phủ kế hoạch

| Loại | Số file | Số test dự kiến |
|---|---|---|
| rules (R1–R4) | 4 | ≈ 41 |
| i18n (C1) | 1 | 3 |
| int API (A1–A7) | 7 | ≈ 163 |
| proc (A8) | 1 | 8 |
| int DB/seed (B1, D1–D3) | 4 | ≈ 46 |
| e2e (E1–E4) | 4 | ≈ 34 |
| **Tổng** | **21** (+2 file M0 sửa: `migrate.int.test.ts`, `e2e/smoke.spec.ts`) | **≈ 295** |

FR MUST (8 mã): FR-01, 02, 03, 04, 05, 60, 61, 63 đều có ≥ 1 test acceptance + API; FR-06, 07 (SHOULD) có test; BR-05/08/09, NFR-01/06/07 có test; AC-A01/A02/A09 + M1-AC01…08 đều có ca (mục 7). Độ phủ FR MUST kế hoạch: **8/8**.

## 10. Lỗ hổng cho spec-readiness (kèm mặc định đề xuất)

| # | Mức | Agent | Vấn đề | Mặc định qc áp dụng nếu không trả lời |
|---|---|---|---|---|
| G1 | **Cao** | frontend-lead + điều phối | E2E cần admin-api + DB đã seed và dữ liệu riêng (tenant acme, globex, zeta, user `dung`/`em`…) nhưng `playwright.config.ts` hiện chỉ chạy admin-web preview (M0). E2E đột biến dữ liệu, chạy song song sẽ đạp nhau; chạy lại không idempotent nếu dùng DB dev. Phụ thuộc thêm: Rsbuild `preview` có áp `server.proxy` không (plan-frontend §14) | E2E dùng DB `ai_system_test` (không phải DB dev). `webServer` là mảng 2 phần tử: (1) admin-api: `bun e2e/support/prepare-db.ts && bun apps/admin-api/src/server.ts` với `ADMIN_API_DATABASE_URL=$TEST_ADMIN_API_DATABASE_URL`, `PORT=3001`, `APP_ENV=test`; (2) admin-web build + preview (proxy → `http://localhost:3001`). `workers: 1`, `fullyParallel: false`. qc viết `e2e/support/prepare-db.ts` + fixture; frontend-lead/điều phối sửa `playwright.config.ts` (không thuộc phạm vi sửa của qc). Nếu preview không proxy → e2e chạy trên `rsbuild dev` + proxy |
| G2 | Cao | backend-lead | `checkRoleChange`: `platform_admin` tự hạ role vừa vi phạm "target là platform_admin → `ROLE_NOT_ALLOWED`" vừa "tự đổi role → `SELF_ACTION_FORBIDDEN`". `plan.md` §4 liệt kê `ROLE_NOT_ALLOWED` trước; BR-08/M1-R11 nói tự hạ role = 403 | `SELF_ACTION_FORBIDDEN` trước (khớp M1-R11/BR-08); qc ghi test theo mặc định này, chỉ kiểm cặp "người khác đổi role platform_admin → `ROLE_NOT_ALLOWED`" và "tự đổi role member/tenant_admin → `SELF_ACTION_FORBIDDEN`" cho tới khi chốt |
| G3 | Cao | backend-lead | Chữ ký hàm hạ tầng test cần nhưng `plan.md` chưa khai: `loadJwtKeys(env)` (kiểu đối số, kiểu trả `JwtKeys`), vị trí import `hashPassword`/`verifyPassword` (`@ai/db` hay `@ai/db/password`), `createDb`/`Db`, `assertSafeDbRole(db: Db)`, `runSeed`/`loadSeedEnv` import `@ai/db/seed`. Test giả mạo JWT cần `jose` ở gốc repo (isolated linker: không import được từ `apps/admin-api`) | `loadJwtKeys({JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, JWT_KID})`; `hashPassword`/`verifyPassword` export từ `@ai/db`; `jose` 6.2.12 thêm vào `devDependencies` gốc (ADR-0001 đã Accepted, không cần ADR mới); import `assertSafeDbRole` từ `apps/admin-api/src/lib/db-guard`, `runSeed`/`loadSeedEnv` từ `@ai/db/seed` |
| G4 | Thấp | backend-lead | `classifyRefresh` thứ tự khi token vừa `revoked` vừa `expired`; chuỗi `rotated` quá hạn | Thứ tự trong chú thích `plan.md` (kiểm `revoked` trước): `reuse`/`superseded` thắng `expired`. qc **không** kiểm tổ hợp này |
| G5 | Trung bình | frontend-lead | `plan-frontend.md` §4: "Tên công ty ≤ 100 (`NAME_MAX`)" mâu thuẫn contract/DB: `TenantName` 1–128, `NAME_MAX = 128` | Contract thắng: 128. FE sửa §4 (`≤ 128`) |
| G6 | Thấp | frontend-lead | `plan-frontend.md` §9.11 còn ghi mặc định `ADMIN_API_URL=http://localhost:4000`; backend chốt 3001 (`PORT=3001`) | 3001 (qc dùng 3001 trong e2e) |
| G7 | Cao | backend-lead | Đồng hồ: `plan.md` §6.1 chỉ nói `now` dùng cho khoá tạm. Chưa rõ `now` có áp cho `last_login_at`, `password_changed_at`, `iat/exp` JWT, `revoked_at`, `expires_at`, `locked_until` trong mọi SQL hay không | `deps.now` áp cho **mọi** so sánh/ghi liên quan khoá tạm (`locked_until`, `failed_logins`, `until`) và `last_login_at`; JWT `iat/exp` và `revoked_at/expires_at` dùng giờ thật/DB `now()`. qc không phụ thuộc chỗ nào khác (refresh chỉnh bằng owner SQL; token hết hạn tự ký bằng `jose`) |
| G8 | Trung bình | backend-lead | Hành vi no-op: `lock`/`unlock` lặp (đã nói idempotent) có tăng `version`/`updated_at` không? | Không tăng khi trạng thái không đổi (qc kiểm `version` bằng nhau) |
| G9 | Trung bình | backend-lead | Tạo user ở tenant bị khoá: `status` trả `locked` và `active=true`/`locked_by_tenant=true` — khớp spec §3; nhưng `tenant_admin` của tenant khoá (`zoe`) gọi API bị 401 nên không tạo được — chỉ `platform_admin` tạo | Giữ nguyên spec; test tạo ở `zeta` bằng `admin ?tenant_id=<zeta>` |
| G10 | Trung bình | backend-lead | Refresh khi gửi cả cookie lẫn body: ưu tiên nào? `X-Client` có phân biệt hoa/thường không? | Theo `X-Client`: đúng chuỗi `extension` (phân biệt hoa/thường) → chỉ đọc body; mọi giá trị khác/thiếu → chỉ đọc cookie. Test A1.4, A2.2 |
| G11 | Cao | backend-lead | Test M0 khoá còn sống sau M1: `server.int.test.ts` spawn server với env của tiến trình test; sau M1 server đòi `ADMIN_API_DATABASE_URL`, `JWT_*` hợp lệ + DB kết nối được → thất bại nếu `.env.local`/CI chưa có. `ci-workflow.test.ts` đòi 8 bước theo thứ tự (migrate/seed chuyển lên trước e2e không được làm đảo thứ tự 8 bước cũ) | `keys:dev` + `.env.example` + CI bổ sung biến mới để M0 tiếp tục xanh; thứ tự 8 bước cũ giữ nguyên (chèn thêm bước được). Nếu không giữ được → qc sửa test M0 ở Q2 (cần ghi lý do) |
| G12 | Trung bình | điều phối | Thứ tự task: `tasks.md` đặt Q2 (viết test) trước T1 (contract), nhưng test import `API_ERRORS`, schema, kiểu từ `@ai/contracts` → `bun run typecheck` phần test đỏ vì **thiếu import** (không phải đỏ theo hành vi) | Cho T1 (chỉ contract + test contract, không logic) chạy trước/cùng Q2 sau Gate; nếu không, Q2 chấp nhận typecheck đỏ vì import và ghi rõ ở báo cáo |
| G13 | Thấp | — | Không kiểm tất định được: (a) verify argon2 giả cho user không tồn tại (M1-R01, chống đo thời gian); (b) phân phối CSPRNG của `temp_password`; (c) lỗi giữa chừng trong transaction tạo tenant/seed | (a) chỉ kiểm body/status đồng nhất; (b) kiểm bằng RNG giả ở R1; (c) giao backend-lead kiểm ở int test riêng (qc chỉ kiểm không để lại hàng khi validate lỗi) |
| G14 | Thấp | docs-architect | `spec.md` §8 ghi AC-A01 "refresh token" nhưng web không trả refresh trong body (chỉ cookie) — qc kiểm "có refresh token" = cookie `ai_rt` (web) hoặc `refresh_token` trong body (extension) | Như mô tả A1.3–A1.4 |
| G15 | Thấp | backend-lead | M1-R19 / §6: bảng "ngân sách siết" (p95 login < 150 ms…) không có AC; M1 không kiểm trong acceptance | qc chạy lại `users.perf.int.test.ts` ở VERIFY và báo số, không khoá |

Không chặn (đã có đáp án trong spec): AC bổ sung (xác nhận 8/8), tên file `tests/acceptance/M1/` (theo spec/tasks), quy tắc chọn kênh refresh theo `X-Client` (A6 spec).

## 11. Nhật ký

- 2026-10-01 · qc · WRITE (test-plan) · chưa có file test; Q2/Q3 sau Gate G1.
