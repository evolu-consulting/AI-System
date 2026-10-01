---
id: M1-foundation-identity
title: Nền tảng & danh tính (DB admin + RLS + seed, Auth, Tenants, Users, App shell)
milestone: M1
status: approved            # draft → ready → approved → in-progress → done
requirements: [ADM-FR-01, ADM-FR-02, ADM-FR-03, ADM-FR-04, ADM-FR-05, ADM-FR-06, ADM-FR-07, ADM-FR-60, ADM-FR-61, ADM-FR-63, ADM-BR-05, ADM-BR-08, ADM-BR-09, ADM-NFR-01, ADM-NFR-06, ADM-NFR-07, AC-A01, AC-A02, AC-A09]
design: [docs/ROADMAP.md#M1, docs/design/admin/ba-admin.md#51-auth--user, docs/design/admin/ba-admin.md#52-tenant--group, docs/design/admin/ba-admin.md#6-luật-nghiệp-vụ, docs/design/admin/ba-admin.md#7-mô-hình-dữ-liệu-schema-admin, docs/design/admin/ba-admin.md#8-api, docs/design/admin/ba-admin.md#10-yêu-cầu-phi-chức-năng, docs/design/admin/ba-admin.md#11-tiêu-chí-nghiệm-thu-các-kịch-bản-chính, docs/design/admin/ui-admin.md#4-khung-ứng-dụng-app-shell, docs/design/admin/ui-admin.md#71-đăng-nhập--đổi-mật-khẩu, docs/design/admin/ui-admin.md#79-users, docs/design/admin/ui-admin.md#713-tenants, docs/design/admin/ui-admin.md#9-trạng-thái-validation-thông-báo, docs/design/admin/ui-admin.md#15-song-ngữ-vien, docs/specs/_design/admin-missing-screens.md, docs/adr/0001-stack.md, docs/readiness/2026-10-01-admin-m1-m4.md, canvas: Login · ChangePassword · TenantCreate · Users · Sidebar · States · Main]
owner: backend-lead + frontend-lead
---

# M1 Nền tảng & danh tính

Mốc: [ROADMAP M1](../../ROADMAP.md). Nền: [M0-bootstrap](../M0-bootstrap/spec.md) (monorepo, migration `0000_init_schemas`, mock, app web trắng). Không chép BA; chỉ ghi phần cụ thể hoá.

## 1. Phạm vi

**Làm:**
- **DB:** migration schema `admin` (bảng theo BA §7 mà M1 cần, xem §4), RLS theo `app.tenant_id` (ADM-NFR-07), seed idempotent: tenant `platform`, feature `core`, `platform_admin` đầu tiên từ env `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` (vế seed của ADM-NFR-06; M0 chỉ phủ vế migration).
- **Auth** (FR-01, 02, 03, 06, 07): `POST /auth/login` (mã công ty + username + password), `/auth/refresh` (xoay vòng), `/auth/logout`, `/auth/change-password`, `GET/PATCH /auth/me` (đọc hồ sơ, đổi `locale`). JWT EdDSA qua `jose`, argon2id qua `Bun.password`, khoá tạm 5 lần/15 phút, `must_change_password`.
- **Tenants** (FR-60, 61): CRUD (không có Xoá), khoá/mở khoá (`POST /admin/tenants/:id/{lock,unlock}`), tạo kèm `tenant_admin` đầu tiên + mật khẩu tạm hiện một lần. Chỉ `platform_admin`.
- **Users** (FR-04, 05, 63): list/tạo/sửa, khoá/mở khoá, reset mật khẩu, đăng xuất mọi thiết bị. `tenant_admin` chỉ trong tenant mình (BR-09).
- **Luật:** BR-05 (3 role), BR-08 (không tự khoá/hạ role; luôn còn ≥ 1 `platform_admin` active, mỗi tenant (kể cả đang khoá) còn ≥ 1 `tenant_admin` active), BR-09 (cách ly tenant, 404), NFR-01 (bảo mật mật khẩu/token/khoá).
- **Web (`apps/admin-web`):** app shell (sidebar, topbar, breadcrumb, menu avatar, route guard theo role), i18n VI/EN đầy đủ cho các màn M1, màn Đăng nhập, Đổi mật khẩu (bắt buộc và tự đổi), Tenants (danh sách, tạo, chi tiết tab Thông tin + Users), Users (danh sách + drawer), bộ trạng thái chung ([UI §9](../../design/admin/ui-admin.md), [missing-screens §12](../_design/admin-missing-screens.md)), refresh âm thầm + modal đăng nhập lại.

**Không làm (mốc khác):**
- **2FA/TOTP (FR-08), Import/Export (FR-54): M4** (người dùng chốt 2026-10-01). Không có cột `totp_secret`, không có route `/auth/totp/*`, ẩn mục 2FA ở menu avatar.
- **Group CRUD (FR-62): M3** theo ROADMAP (xem Mơ hồ A1). M1 không có bảng-API group; cột "Group" của Users và bộ lọc theo group ẩn/trống.
- Màn "Cài đặt đăng nhập" `/auth-settings`: loại khỏi M1–M4, ẩn menu (readiness #14). Chính sách mật khẩu cố định trong code.
- Chống ghi đè UI (modal 409, FR-55 = M3), NOTIFY `config_changed` (FR-53 = M3), audit ghi/đọc (FR-51/52 = M4), Quota/Chi phí (M4), tab Feature/Agent/Quota của Tenant (hiện "Chưa khả dụng"), Tổng quan đầy đủ (M4; M1 chỉ trang chủ tạm), "Hiện còn N lần thử" (bỏ), IP/VPN allowlist (ADM-NFR-05, ngoài v1), rate-limit theo IP.
- Hub verify JWT: chỉ cung cấp public key qua env; không có code Hub.

## 2. Nghiệp vụ

Luật nghiệp vụ gốc: [BA §5.1–5.2, §6](../../design/admin/ba-admin.md). Bảng dưới là phần **cụ thể hoá**; dòng gắn `[RD#n]` lấy từ [readiness](../../readiness/2026-10-01-admin-m1-m4.md) (đã chấp nhận), `ĐX` = đề xuất của docs-architect, **đã chấp nhận: Người dùng chấp nhận tại Gate 2026-10-01** (xem §9, [readiness.md](readiness.md)). Các lệch so với readiness/BA ghi ở [CR-006..010](../../CHANGE-REQUESTS.md).

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| M1-R01 | Tra tenant theo `key` đã `trim().toLowerCase()`. Mọi thất bại xác thực (tenant không có, user không có, sai mật khẩu, user `active=false`, tenant khoá) trả **cùng** 401 `INVALID_CREDENTIALS` + cùng message; user không tồn tại vẫn chạy một lần verify argon2 giả (chống đo thời gian) | FR-01, UI 7.1, RD#24, ĐX (đã chấp nhận) |
| M1-R02 | JWT: header `alg=EdDSA`, `kid`; claim `sub`(=user_id), `tid`(=tenant_id), `role`, `iat`, `exp`=`iat`+900, `iss="admin"`, `aud="ai-system"`. Refresh token: chuỗi ngẫu nhiên ≥ 32 byte, DB chỉ lưu hash, hạn 30 ngày | FR-01, NFR-01, RD#5 |
| M1-R03 | Khoá tạm: bộ đếm `failed_logins` theo user. Lần sai thứ 5 → `locked_until = now+15 phút`. Trong lúc khoá, mọi lần đăng nhập (kể cả đúng mật khẩu) → 423 `TEMP_LOCKED {until}` (ISO UTC; UI hiển thị "Tạm khoá đến HH:MM" theo giờ trình duyệt). Đăng nhập đúng hoặc hết hạn khoá → đếm về 0. Không có bộ đếm cho user không tồn tại | FR-07, AC-A01, RD#24, ĐX (đã chấp nhận) |
| M1-R04 | Khoá bởi admin (`active=false`) hoặc tenant khoá: trả 403 `ACCOUNT_LOCKED` **chỉ khi mật khẩu đúng**; sai mật khẩu vẫn là M1-R01 (không lộ user tồn tại khi chưa có mật khẩu) | RD#24, ĐX (đã chấp nhận) |
| M1-R05 | `must_change_password=true` và mật khẩu đúng → 200 `{status:"password_change_required", change_token}` (hạn 5 phút, dùng một lần, chỉ gọi được `/auth/change-password`), **không** cấp access/refresh token. Đổi xong → cấp token như đăng nhập thường | FR-06, RD#23 |
| M1-R06 | Đổi mật khẩu: mật khẩu mới ≥ 10 ký tự, khác mật khẩu cũ. Chế độ tự đổi cần `current_password`; chế độ bắt buộc dùng `change_token` (mật khẩu tạm đã được xác thực khi đăng nhập). Thành công → `must_change_password=false`, thu hồi mọi refresh token **khác** của user | UI 9, RD#23, ĐX (đã chấp nhận) |
| M1-R07 | Refresh: đổi token hợp lệ → access token mới + refresh mới (bản cũ `revoked_at`, gắn cùng `family_id`). Dùng lại token đã thu hồi (reuse) → thu hồi **cả chuỗi** `family_id`, 401 `INVALID_REFRESH_TOKEN`. User/tenant bị khoá → 401. Web: cookie `httpOnly; SameSite=Strict; Path=/auth`; extension: trong body (cách phân biệt: Mơ hồ A6) | FR-02, RD#22 |
| M1-R08 | Đăng xuất: thu hồi refresh token hiện tại (cookie/body); idempotent (token lạ/đã thu hồi vẫn 204) | FR-03 |
| M1-R09 | Khoá user (`POST /admin/users/:id/lock`) → `active=false` + thu hồi mọi refresh token (FR-05). Access token đã cấp còn hiệu lực tối đa 15 phút — **không** có danh sách thu hồi access token. `logout-all` = thu hồi mọi refresh token, giữ `active` | FR-05, AC-A02 |
| M1-R10 | Khoá tenant (cấm với `platform`, 409 `PLATFORM_TENANT_LOCKED`): `tenants.active=false`; mọi user đang `active=true` → `locked_by_tenant=true`; thu hồi mọi refresh token của tenant. Mở khoá: chỉ gỡ `locked_by_tenant`; user bị khoá riêng (`active=false` trước đó) vẫn khoá | FR-61, RD#21 |
| M1-R11 | BR-08: không tự khoá/tự hạ role (403 `SELF_ACTION_FORBIDDEN`); khoá/hạ role làm hết `platform_admin` active (toàn hệ thống) hoặc `tenant_admin` active (đếm ở **mọi** tenant, kể cả tenant đang khoá) → 409 `LAST_ADMIN`. `tenant_admin` khác được hạ role nếu tenant còn ≥ 1 | BR-08, RD#49, CR-007 |
| M1-R12 | Role gán được: `tenant_admin` chỉ gán `member`/`tenant_admin` trong tenant mình; `platform_admin` chỉ tồn tại trong tenant `platform`; `platform_admin` tạo user ở tenant nào cũng phải chỉ định tenant (M1-R14). `member`: mọi `/admin/*` → 403 `FORBIDDEN`. `tenant_admin` gọi endpoint chỉ-platform (Tenants) → 403 `FORBIDDEN` | BR-05, UI 7.9 |
| M1-R13 | Cách ly: `tenant_admin` truy cập user/tenant của tenant khác → 404 `NOT_FOUND` (cùng body với id không tồn tại), cả GET/PATCH/POST. Tầng repository luôn lọc `tenant_id` **và** RLS bật (`app.tenant_id` đặt theo transaction) — cả hai (xem Mơ hồ B2) | BR-09, NFR-07, RD#17 |
| M1-R14 | `platform_admin` chọn tenant bằng `?tenant_id=`; thiếu → list trả mọi tenant, thao tác ghi trả 400 `TENANT_REQUIRED` (URL web dùng `?tenant=<key>`) | RD#38 |
| M1-R15 | Định danh: mã công ty `^[a-z0-9-]{2,32}$` unique, **bất biến** sau khi tạo; username `^[a-z0-9._-]{2,32}$` unique trong tenant (FR-63), bất biến; trùng → 409 `KEY_TAKEN` / `USERNAME_TAKEN`. Không có Xoá tenant, không có Xoá user (chỉ Khoá) | FR-63, RD#25, ĐX (đã chấp nhận) |
| M1-R16 | `email` bắt buộc với `tenant_admin`, tuỳ chọn với `member`, unique trong tenant (không phân biệt hoa thường) | RD#9 |
| M1-R17 | Mật khẩu tạm: 16 ký tự `[A-Za-z0-9]` sinh bằng CSPRNG, trả **một lần** trong response tạo user/tenant/reset (`temp_password`); không lưu ở dạng đọc được, không log; user được tạo luôn `must_change_password=true`. Reset mật khẩu thu hồi mọi refresh token của user | UI 7.9, RD#53, ĐX (đã chấp nhận) |
| M1-R18 | Tạo tenant một transaction: tenant + `tenant_admin` đầu tiên (lỗi một nửa → không tạo gì). `max_concurrent_sub` null/số nguyên ≥ 1 | FR-60 |
| M1-R19 | Danh sách: `{items,total}`, `?q&limit=50&offset`, `limit` tối đa 200. Lỗi `{error:{code,message,details?}}` (M0 `ErrorResponseSchema`); `PATCH` nhận `version`, lệch → 409 `VERSION_CONFLICT` (UI xử lý ở M3, Mơ hồ A3); body `{error:{code,message,details:{current, updated_at}}}`, `updated_by` thêm ở M4 | RD#3, RD#4, CR-008 |
| M1-R20 | Seed: chạy bởi `bun run db:seed` và sau `db:migrate`; idempotent (chạy lần 2 không đổi gì, không đổi mật khẩu). Tạo `platform` (name "Nền tảng", `max_concurrent_sub` null), feature `core` (`{vi:"Cơ bản",en:"Core"}`, `status=on`), `platform_admin` (`SEED_ADMIN_USERNAME`, hash argon2id của `SEED_ADMIN_PASSWORD`, `must_change_password=false`, `locale=vi`). Thiếu env → exit 1 nêu tên biến, không in giá trị. Cấm chạy seed với `APP_ENV=production` nếu `SEED_ADMIN_PASSWORD` rỗng | NFR-06, ĐX (đã chấp nhận) |
| M1-R21 | Tenant `platform` và feature `core` seed thì `core` **tự hiệu lực** với mọi user active, không cần entitlement/grant (logic ở Hub/M3; M1 chỉ seed hàng) | RD#7 |
| M1-R22 | Chuỗi giao diện song ngữ: `packages/i18n/locales/vi.json` + `en.json` khớp key (`bun run i18n:check`); `users.locale` đổi qua `PATCH /auth/me`; mặc định `vi` | UI 15, M0 T-I18N-1 |

## 3. Contract (backend-lead)
File: `packages/contracts/src/{common,auth,tenants,users}.ts` (zod 4, export qua `index.ts`). Chi tiết hiện thực: [plan.md](plan.md) §2–§3.

**Quy ước chung**
- Route gốc của admin-api: `/auth/*`, `/admin/*` (không tiền tố). JSON UTF-8; thời gian = chuỗi ISO 8601 UTC (`z.iso.datetime()`); id = uuid (`z.uuid()`, app sinh v7 bằng `Bun.randomUUIDv7()`).
- Mọi body/query parse bằng schema **strict** (trường lạ → 400). `:id` không phải uuid → 404 `NOT_FOUND` (cùng body với id không tồn tại).
- Lỗi: `{error:{code,message,details?}}` (`ErrorResponseSchema` M0). `message` tiếng Anh cố định; web dịch theo `code`.
  - `VALIDATION_ERROR.details = {issues:[{path:(string|number)[], code:string, message:string}]}` (lấy từ issue zod; JSON hỏng → `issues:[{path:[],code:"invalid_json",…}]`).
  - `VERSION_CONFLICT.details = {current: <bản mới nhất, cùng schema response của endpoint>, updated_at: ISO}` (`updated_at` = `current.updated_at`; `updated_by` để M4 khi có audit — chốt ở Gate M1). Readiness #4 đặt các trường ở gốc; M0 `ErrorResponseSchema` strict nên đặt trong `details`.
  - `TEMP_LOCKED.details = {until: ISO}`.
- Bearer: `Authorization: Bearer <access_token>`. Token thiếu/sai chữ ký/hết hạn/sai `aud`, hoặc user không còn đăng nhập được (khoá, khoá theo tenant, tenant khoá) → 401 `UNAUTHORIZED`. Middleware **đọc lại user từ DB mỗi request** (role, `active`, `locked_by_tenant`, tenant `active`): Admin chặn ngay khi khoá/hạ role; Hub vẫn tin token tới `exp` (M1-R09).
- Role: `member` gọi `/admin/*` → 403 `FORBIDDEN`; `tenant_admin` gọi `/admin/tenants*` → 403 `FORBIDDEN`. Kiểm role **trước** khi tra thực thể.
- Client: header `X-Client: extension` → refresh token trả/nhận trong **body** (`refresh_token`); thiếu header hoặc giá trị khác → **web**: refresh token chỉ ở cookie `ai_rt` (`HttpOnly; SameSite=Strict; Path=/auth; Max-Age=2592000`; thêm `Secure` khi `APP_ENV=production`), không bao giờ có trong body. CORS cho phép header `X-Client`, `credentials: true`.
- List: query `q?` (trim, ≤ 100, rỗng = bỏ), `limit` (int 1–200, mặc định 50), `offset` (int 0–100000, mặc định 0); response `{items, total, counts}` với `counts = {all, active, locked}` tính theo cùng bộ lọc **trừ** `status`.

**Kiểu dùng chung** (`common.ts`)
- `Role = "platform_admin" | "tenant_admin" | "member"` · `Locale = "vi" | "en"` · `EntityStatus = "active" | "locked"`.
- `TenantKey = string` trim+lowercase, `^[a-z0-9-]{2,32}$` · `Username = string` trim+lowercase, `^[a-z0-9._-]{2,32}$` · `Email = z.email()` trim+lowercase, ≤ 254 · `DisplayName` trim 1–64 · `TenantName` trim 1–128 · `NewPassword` 10–128 ký tự (không trim) · `Version` int ≥ 1.
- Hằng export (dùng được ở trình duyệt, không import I/O): `COMPANY_KEY_RE = /^[a-z0-9-]{2,32}$/`, `USERNAME_RE = /^[a-z0-9._-]{2,32}$/`, `PASSWORD_MIN_LEN = 10`, `PASSWORD_MAX_LEN = 128`, `DISPLAY_NAME_MAX = 64`, `NAME_MAX = 128` (tên tenant), `EMAIL_MAX = 254`, `LIST_LIMIT_DEFAULT = 50`, `LIST_LIMIT_MAX = 200`, `TEMP_PASSWORD_LEN = 16`; enum `ROLES`, `LOCALES`; `ErrorCode` (union mọi mã trong bảng dưới) + `API_ERRORS: Record<ErrorCode, status>`.
- Tên schema export: `LoginRequestSchema`, `LoginResponseSchema`, `RefreshRequestSchema`, `RefreshResponseSchema`, `ChangePasswordRequestSchema`, `MeSchema`, `MeUpdateRequestSchema`, `TenantSchema`, `TenantDetailSchema`, `TenantListQuerySchema`, `TenantListResponseSchema`, `TenantCreateRequestSchema`, `TenantCreateResponseSchema`, `TenantUpdateRequestSchema`, `UserSchema`, `UserListQuerySchema`, `UserListResponseSchema`, `UserCreateRequestSchema`, `UserCreateResponseSchema`, `UserUpdateRequestSchema`, `TempPasswordResponseSchema`, helper `listResponseSchema(item)` → `ListResponse<T> = {items: T[], total, counts}`; kiểu TS cùng tên bỏ hậu tố `Schema`.
- `Me = {id, tenant:{id, key, name}, username, display_name, email: string|null, role, locale, must_change_password: false}` (luôn `false` với người giữ access token).
- `User = {id, tenant_id, tenant_key, username, display_name, email: string|null, role, locale, status, active, locked_by_tenant, locked_until: ISO|null (khoá tạm FR-07), must_change_password, last_login_at: ISO|null, created_at, updated_at, version}` — `status = "locked"` ⇔ `!active || locked_by_tenant`.
- `Tenant = {id, key, name, active, status, max_concurrent_sub: int|null, user_count (mọi user của tenant, kể cả đang khoá), created_at, updated_at, version}` · `TenantDetail = Tenant & {stats:{user_count, tenant_admin_count, locked_user_count}}`.
- `TokenGrant = {status:"authenticated", access_token, token_type:"Bearer", expires_in:900, user: Me, refresh_token?}` (`refresh_token` chỉ khi extension).
- `PasswordChangeRequired = {status:"password_change_required", change_token, expires_in:300}`.
- `LAST_ADMIN.details = {scope: "platform" | "tenant"}`.

**Token** (M1-R02, bổ sung): access token có thêm claim `sid` (= `refresh_tokens.family_id` của phiên) để "thu hồi mọi refresh token **khác**" (M1-R06); Hub bỏ qua `sid`. `change_token` = JWT EdDSA cùng khoá, `aud="admin:password-change"` (access token đòi `aud="ai-system"` nên hai loại không dùng lẫn), claim `sub`, `tid`, `pwc` (= `users.password_changed_at` epoch ms), `exp`=`iat`+300; dùng một lần vì đổi mật khẩu cập nhật `password_changed_at` → `pwc` lệch.

| Method | Path | Role | Request | Response | Lỗi (HTTP · code) |
|---|---|---|---|---|---|
| POST | `/auth/login` | công khai | `LoginRequest {tenant_key: string trim+lower 1–64, username: string trim+lower 1–64, password: string 1–128}` · header `X-Client?` | 200 `TokenGrant \| PasswordChangeRequired` (web: kèm `Set-Cookie ai_rt`) | 400 `VALIDATION_ERROR` · 401 `INVALID_CREDENTIALS` · 423 `TEMP_LOCKED {until}` · 403 `ACCOUNT_LOCKED` |
| POST | `/auth/refresh` | công khai | web: cookie `ai_rt`, body rỗng · extension: `{refresh_token: string 1–200}` | 200 `TokenGrant` (token mới, cookie mới) | 401 `INVALID_REFRESH_TOKEN` (thiếu/lạ/hết hạn/reuse/user hoặc tenant khoá; web: xoá cookie) · 401 `REFRESH_SUPERSEDED` (token vừa bị xoay ≤ 10 s bởi request song song; **không** thu hồi chuỗi; response **không có** header `Set-Cookie` — không xoá, không đặt cookie, để không đè cookie mới của request thắng; client thử lại 1 lần) |
| POST | `/auth/logout` | công khai | như refresh (cookie hoặc body `{refresh_token?}`) | 204 (web: xoá cookie) | — (idempotent, M1-R08) |
| POST | `/auth/change-password` | bắt buộc: công khai · tự đổi: Bearer (mọi role) | `ChangePasswordRequest = {change_token, new_password} \| {current_password: 1–128, new_password}` (đúng một trong hai dạng) | bắt buộc: 200 `TokenGrant` (như đăng nhập) · tự đổi: 204 | 400 `VALIDATION_ERROR` (mật khẩu < 10 / > 128) · 400 `PASSWORD_UNCHANGED` · 400 `INVALID_CURRENT_PASSWORD` (tính vào bộ đếm khoá tạm) · 423 `TEMP_LOCKED` (tự đổi) · 401 `INVALID_CHANGE_TOKEN` · 403 `ACCOUNT_LOCKED` (bắt buộc, user/tenant vừa bị khoá) · 401 `UNAUTHORIZED` |
| GET | `/auth/me` | Bearer (mọi role) | — | 200 `Me` | 401 `UNAUTHORIZED` |
| PATCH | `/auth/me` | Bearer (mọi role) | `{locale}` (không cần `version`: tuỳ chọn cá nhân, ghi sau thắng; vẫn tăng `users.version`) | 200 `Me` | 400 `VALIDATION_ERROR` · 401 |
| GET | `/admin/tenants` | platform_admin | `?q` (khớp `key`/`name`, ILIKE) `&status?&limit&offset` | 200 `{items: Tenant[], total, counts}` sắp `key` tăng dần | 401 · 403 `FORBIDDEN` · 400 `VALIDATION_ERROR` |
| POST | `/admin/tenants` | platform_admin | `TenantCreateRequest {key: TenantKey, name: TenantName, max_concurrent_sub?: int 1–10000 \| null (mặc định null), first_admin: {username, display_name, email (bắt buộc), locale? (mặc định "vi")}}` | 201 `{tenant: Tenant, first_admin: User, temp_password: string(16)}` | 400 `VALIDATION_ERROR` · 409 `KEY_TAKEN` · 401 · 403 |
| GET | `/admin/tenants/:id` | platform_admin | — | 200 `TenantDetail` | 404 `NOT_FOUND` · 401 · 403 |
| PATCH | `/admin/tenants/:id` | platform_admin | `TenantUpdateRequest {version, name?, max_concurrent_sub?: int\|null}` (`key` không có trong schema → 400) | 200 `Tenant` | 400 · 404 · 409 `VERSION_CONFLICT {current: Tenant, updated_at}` |
| POST | `/admin/tenants/:id/lock` | platform_admin | body rỗng | 200 `Tenant` (idempotent khi đã khoá) | 404 · 409 `PLATFORM_TENANT_LOCKED` |
| POST | `/admin/tenants/:id/unlock` | platform_admin | body rỗng | 200 `Tenant` (idempotent) | 404 |
| GET | `/admin/users` | platform_admin, tenant_admin | `?tenant_id?` (chỉ platform_admin; tenant_admin: bỏ qua, luôn tenant mình) `&q` (khớp `username`/`display_name`/`email`) `&role?&status?&login=never?&limit&offset` | 200 `{items: User[], total, counts}` sắp `username`, `id` | 401 · 403 · 400 |
| POST | `/admin/users` | platform_admin (bắt buộc `?tenant_id=`), tenant_admin (tenant mình) | `UserCreateRequest {username, display_name, email?: Email\|null, role, locale? = "vi"}` | 201 `{user: User, temp_password: string(16)}` | 400 `TENANT_REQUIRED` · 400 `VALIDATION_ERROR` · 400 `ROLE_NOT_ALLOWED` · 400 `EMAIL_REQUIRED` · 404 (tenant_id lạ) · 409 `USERNAME_TAKEN` · 409 `EMAIL_TAKEN` |
| GET | `/admin/users/:id` | platform_admin, tenant_admin | — | 200 `User` | 404 (gồm user tenant khác, M1-R13) |
| PATCH | `/admin/users/:id` | platform_admin, tenant_admin | `UserUpdateRequest {version, display_name?, email?: Email\|null, role?, locale?}` (`username` không có trong schema) | 200 `User` | 400 `ROLE_NOT_ALLOWED` / `EMAIL_REQUIRED` · 403 `SELF_ACTION_FORBIDDEN` (tự đổi role) · 404 · 409 `VERSION_CONFLICT {current: User, updated_at}` / `LAST_ADMIN` / `EMAIL_TAKEN` |
| POST | `/admin/users/:id/lock` | platform_admin, tenant_admin | body rỗng | 200 `User` (idempotent) | 403 `SELF_ACTION_FORBIDDEN` · 404 · 409 `LAST_ADMIN` |
| POST | `/admin/users/:id/unlock` | platform_admin, tenant_admin | body rỗng | 200 `User` (`active=true`, xoá khoá tạm; **không** gỡ `locked_by_tenant`) | 404 |
| POST | `/admin/users/:id/logout-all` | platform_admin, tenant_admin | body rỗng | 204 | 404 |
| POST | `/admin/users/:id/reset-password` | platform_admin, tenant_admin | body rỗng | 200 `{temp_password: string(16)}` | 403 `SELF_ACTION_FORBIDDEN` (tự reset → dùng change-password) · 404 |

Bảng mã lỗi → HTTP (`API_ERRORS` trong `common.ts`, nguồn duy nhất cho BE/FE/QC): `VALIDATION_ERROR` 400 · `TENANT_REQUIRED` 400 · `ROLE_NOT_ALLOWED` 400 · `EMAIL_REQUIRED` 400 · `PASSWORD_UNCHANGED` 400 · `INVALID_CURRENT_PASSWORD` 400 · `UNAUTHORIZED` 401 · `INVALID_CREDENTIALS` 401 · `INVALID_REFRESH_TOKEN` 401 · `REFRESH_SUPERSEDED` 401 · `INVALID_CHANGE_TOKEN` 401 · `FORBIDDEN` 403 · `ACCOUNT_LOCKED` 403 · `SELF_ACTION_FORBIDDEN` 403 · `NOT_FOUND` 404 · `VERSION_CONFLICT` 409 · `KEY_TAKEN` 409 · `USERNAME_TAKEN` 409 · `EMAIL_TAKEN` 409 · `LAST_ADMIN` 409 · `PLATFORM_TENANT_LOCKED` 409 · `TEMP_LOCKED` 423 · `INTERNAL_ERROR` 500.

**Luật cụ thể hoá ở biên** (bổ sung §2, hàm thuần khai báo ở plan.md §4):
- Đăng nhập theo thứ tự: tenant theo key → user theo username (không có ở bước nào → verify argon2 giả → 401) → đang khoá tạm (`locked_until > now`) → 423, không verify → khoá tạm đã hết → đếm về 0 → verify sai: `failed_logins+1`; chạm 5 → `locked_until=now+15'`, đếm về 0; trả 401 (lần 5 vẫn 401, lần 6 mới 423 — AC-A01) → verify đúng: đếm về 0 → `!active \|\| locked_by_tenant \|\| !tenant.active` → 403 `ACCOUNT_LOCKED` → `must_change_password` → `PasswordChangeRequired` → cấp token, `last_login_at=now`.
- Refresh: chuỗi `family_id` có hạn **tuyệt đối** 30 ngày từ lúc đăng nhập (token xoay vòng kế thừa `expires_at`). Token đã thu hồi lý do `rotated` trong ≤ 10 s → `REFRESH_SUPERSEDED`; mọi trường hợp đã thu hồi khác → thu hồi cả chuỗi + `INVALID_REFRESH_TOKEN`.
- Admin "đang hoạt động" để đếm BR-08: `platform_admin`: `active=true` toàn hệ thống; `tenant_admin`: `active=true` trong tenant (bỏ qua `locked_by_tenant`, áp cho **mọi** tenant kể cả đang khoá — chặt hơn BA để mở khoá tenant luôn còn ≥ 1 tenant_admin). Kiểm dưới khoá `SELECT … FOR UPDATE` hàng `tenants` của tenant đích (chống hai admin khoá nhau đồng thời).
- Role gán được (`ROLE_NOT_ALLOWED`): tenant `platform` chỉ có `platform_admin`; tenant khác chỉ `tenant_admin`/`member`; `tenant_admin` không gán `platform_admin`. Đổi role user `platform_admin` → luôn `ROLE_NOT_ALLOWED`.
- `email` bắt buộc khi role (sau thay đổi) là `tenant_admin` → `EMAIL_REQUIRED`; xoá email (`null`) của tenant_admin cũng vậy.
- Tạo user trong tenant đang khoá: cho phép, user mới `locked_by_tenant=true`.
- `version` chỉ tăng khi đổi trường admin sửa được hoặc trạng thái (`display_name`, `email`, `role`, `locale`, `active`, `locked_by_tenant`, `must_change_password`, `name`, `max_concurrent_sub`); đăng nhập (`failed_logins`, `locked_until`, `last_login_at`) **không** tăng `version`.
- Đổi role **không** thu hồi refresh token (Admin đọc role từ DB mỗi request; Hub nhận role mới sau ≤ 15 phút).

Sự kiện / NOTIFY: không có ở M1 (FR-53 = M3).

## 4. Dữ liệu (backend-lead)
**Phạm vi bảng (B1):** M1 tạo `admin.tenants`, `admin.users` (không `totp_secret`, thêm `email`, `locked_by_tenant`, `last_login_at`, `password_changed_at`), `admin.refresh_tokens` (thêm `tenant_id`, `family_id`, `client`, `revoked_reason`, `replaced_by`), `admin.features` (A2: chỉ bảng + seed `core`, API ở M2). **Không** tạo ở M1: `groups`, `group_members` (M3), `config_meta` (M3), `secrets`, `workflows`, `commands`, `feature_*` (M2/M3), `tenant_quotas` (M4), `audit_log` (M4).
Kiểu chung: `id uuid PK DEFAULT gen_random_uuid()` (app luôn truyền v7); `timestamptz`; `version integer NOT NULL DEFAULT 1 CHECK (version >= 1)`; `created_at`/`updated_at timestamptz NOT NULL DEFAULT now()` (`updated_at` đổi cùng `version`).

| Bảng | Cột | Kiểu | Null | Default | Ràng buộc / index | RLS |
|---|---|---|---|---|---|---|
| `tenants` | `id` | uuid | không | `gen_random_uuid()` | PK | bật: `id` = `app.tenant_id` hoặc `app.scope`=`platform` |
| | `key` | text | không | — | UNIQUE `tenants_key_uq`; CHECK `key ~ '^[a-z0-9-]{2,32}$'`; bất biến (app) | |
| | `name` | text | không | — | CHECK `char_length(name) BETWEEN 1 AND 128` | |
| | `active` | boolean | không | `true` | | |
| | `max_concurrent_sub` | integer | có | null | CHECK `IS NULL OR BETWEEN 1 AND 10000` | |
| | `settings` | jsonb | không | `'{}'` | chưa dùng ở M1 | |
| | `version`, `created_at`, `updated_at` | | | | | |
| `users` | `id` | uuid | không | `gen_random_uuid()` | PK | bật: `tenant_id` = `app.tenant_id` hoặc scope `platform` |
| | `tenant_id` | uuid | không | — | FK `tenants(id)` ON DELETE RESTRICT | |
| | `username` | text | không | — | UNIQUE `users_tenant_username_uq (tenant_id, username)` (FR-63; phục vụ đăng nhập + list theo tenant); CHECK `~ '^[a-z0-9._-]{2,32}$'` | |
| | `email` | text | có | null | UNIQUE `users_tenant_email_uq (tenant_id, lower(email)) WHERE email IS NOT NULL`; CHECK `char_length(email) <= 254` | |
| | `password_hash` | text | không | — | argon2id PHC string | |
| | `display_name` | text | không | — | CHECK `char_length BETWEEN 1 AND 64` | |
| | `role` | text | không | — | CHECK `IN ('platform_admin','tenant_admin','member')`; CHECK `role <> 'tenant_admin' OR email IS NOT NULL` | |
| | `locale` | text | không | `'vi'` | CHECK `IN ('vi','en')` | |
| | `active` | boolean | không | `true` | khoá bởi admin = `false` | |
| | `locked_by_tenant` | boolean | không | `false` | RD#21 | |
| | `must_change_password` | boolean | không | `true` | | |
| | `failed_logins` | smallint | không | `0` | CHECK `>= 0` | |
| | `locked_until` | timestamptz | có | null | khoá tạm FR-07 | |
| | `last_login_at` | timestamptz | có | null | RD#33 | |
| | `password_changed_at` | timestamptz | không | `now()` | claim `pwc` của change_token | |
| | `version`, `created_at`, `updated_at` | | | | INDEX `users_tenant_role_active_idx (tenant_id, role) WHERE active` (đếm LAST_ADMIN); INDEX `users_username_idx (username, id)` (list mọi tenant của platform_admin) | |
| `refresh_tokens` | `id` | uuid | không | `gen_random_uuid()` | PK | bật: `tenant_id` = `app.tenant_id` hoặc scope `platform`; **không** cấp cho `hub_ro` |
| | `user_id` | uuid | không | — | FK `users(id)` ON DELETE CASCADE; INDEX `refresh_tokens_user_active_idx (user_id) WHERE revoked_at IS NULL` | |
| | `tenant_id` | uuid | không | — | FK `tenants(id)` ON DELETE CASCADE (để RLS không cần join); INDEX `refresh_tokens_tenant_active_idx (tenant_id) WHERE revoked_at IS NULL` (khoá tenant) | |
| | `family_id` | uuid | không | — | B3: = `id` của token đầu chuỗi (lúc đăng nhập); INDEX `refresh_tokens_family_idx (family_id)` | |
| | `token_hash` | bytea | không | — | SHA-256 của token (32 byte ngẫu nhiên, base64url 43 ký tự); UNIQUE `refresh_tokens_hash_uq`; CHECK `octet_length = 32` | |
| | `client` | text | không | — | CHECK `IN ('web','extension')` | |
| | `user_agent` | text | có | null | cắt ≤ 512 ký tự | |
| | `expires_at` | timestamptz | không | — | hạn tuyệt đối của chuỗi | |
| | `revoked_at` | timestamptz | có | null | | |
| | `revoked_reason` | text | có | null | CHECK `IN ('rotated','reuse','logout','logout_all','user_locked','tenant_locked','password_changed','password_reset')`; CHECK `(revoked_at IS NULL) = (revoked_reason IS NULL)` | |
| | `replaced_by` | uuid | có | null | id token kế tiếp khi `rotated` (không FK) | |
| | `created_at` | timestamptz | không | `now()` | | |
| `features` | `id` | uuid | không | `gen_random_uuid()` | PK | **không** bật (catalog toàn hệ thống; quyền ghi do app, M2) |
| | `key` | text | không | — | UNIQUE; CHECK `~ '^[a-z0-9-]{2,32}$'` | |
| | `name` | jsonb | không | — | `{vi, en?}` (zod ở biên, M2) | |
| | `description` | jsonb | không | `'{}'` | | |
| | `icon` | text | có | null | | |
| | `status` | text | không | `'on'` | CHECK `IN ('on','off','beta')` | |
| | `version`, `created_at`, `updated_at` | | | | | |

**Role DB và RLS (B2 — cách ly tenant; SQL đầy đủ ở plan.md §3):**
- `ai` (owner, superuser ở dev) chỉ dùng cho **migrate, seed, reset test**. Bảng do owner tạo; owner bỏ qua RLS (không `FORCE`) — chủ ý, đây là đường bảo trì.
- **`admin_api`** (mới): role `LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`, `IN ROLE admin_rw`, không sở hữu bảng nào. admin-api **chỉ** kết nối bằng `ADMIN_API_DATABASE_URL` (role này). Migration chính tạo role `NOLOGIN`; migration dev/test `migrations-dev/0001_admin_api_login_dev.sql` đặt `LOGIN PASSWORD 'admin_api_dev_pw'`; production do vận hành đặt mật khẩu (PRODUCTION-NOTES). Khởi động admin-api **từ chối chạy** (exit 1) nếu `current_user` là superuser, có `BYPASSRLS`, hoặc sở hữu bảng trong schema `admin`.
- Ngữ cảnh mỗi request = **một transaction** mở bằng `select set_config('app.scope', $scope, true), set_config('app.tenant_id', $tid, true)` (transaction-local, không rò sang request khác trong pool). `scope='tenant'` + `tenant_id` của actor; `scope='platform'` **chỉ** khi user đọc từ DB có role `platform_admin` (tenant `platform`). Policy `admin_rw` (FOR ALL, USING = WITH CHECK): `current_setting('app.scope', true) = 'platform' OR <cột tenant> = NULLIF(current_setting('app.tenant_id', true), '')::uuid` — thiếu cấu hình → **không thấy hàng nào**.
- Repository **vẫn luôn** lọc `tenant_id` tường minh (NFR-07); `platform_admin` có `?tenant_id=` thì lọc theo đó, không có thì list mọi tenant (M1-R14).
- Trước khi có ngữ cảnh (đăng nhập, refresh, logout) dùng 2 hàm `SECURITY DEFINER` hẹp, chỉ `admin_rw` được `EXECUTE`, `SET search_path = pg_catalog, pg_temp`: `admin.tenant_id_by_key(p_key text) RETURNS uuid` và `admin.tenant_id_by_refresh_hash(p_hash bytea) RETURNS uuid`. Chỉ trả `tenant_id`; app đặt `scope='tenant'` rồi đọc user/token qua RLS như thường. `change_token` mang sẵn `tid`.
- `hub_ro` (Hub, chỉ đọc, xem chéo tenant để tính quyền): policy `FOR SELECT TO hub_ro USING (true)` trên `tenants`, `users`; `REVOKE SELECT ON admin.refresh_tokens FROM hub_ro`; trên `users` thu hồi quyền bảng và chỉ `GRANT SELECT (id, tenant_id, username, display_name, email, role, locale, active, locked_by_tenant, created_at, updated_at, version)` — không đọc `password_hash`, bộ đếm khoá. `features` không RLS, `hub_ro` SELECT theo default privileges M0.

**Migration** (thứ tự): `0001_admin_identity.sql` (drizzle-kit sinh từ `packages/db/src/schema/admin.ts`: 4 bảng, CHECK, index) → `0002_admin_rls.sql` (`drizzle-kit generate --custom`: role `admin_api`, `ENABLE ROW LEVEL SECURITY`, policy, 2 hàm SECURITY DEFINER, GRANT/REVOKE cho `hub_ro`) → dev/test `migrations-dev/0001_admin_api_login_dev.sql`. `db:migrate` giữ nguyên nghĩa M0 (chỉ migration).
**Seed** (M1-R20): `packages/db/src/seed.ts`, chạy bằng `bun run db:seed` (owner `DATABASE_URL`), dev tiện dùng `bun run db:setup` (= `db:migrate && db:seed`). Một transaction, `INSERT … ON CONFLICT DO NOTHING` theo `tenants.key`, `features.key`, `(tenant_id, username)` → lần 2 không đổi gì (kể cả `password_hash`). Env `SEED_ADMIN_USERNAME` (khớp `Username`), `SEED_ADMIN_PASSWORD` (10–128) — thiếu/sai → exit 1 nêu tên biến, không in giá trị. Seed admin `display_name` = "Platform Admin", `email` null, `locale` vi, `must_change_password=false`.

## 5. UI (frontend-lead)
Artboard có trong `docs/design/canvas/`: Login, ChangePassword, TenantCreate, Users, Sidebar, States, Main (shell). Màn không có artboard theo mẫu trong [admin-missing-screens](../_design/admin-missing-screens.md): Tenants danh sách §4.1, Tenant chi tiết §4.3 (chỉ tab Thông tin + Users; Feature/Agent/Quota hiện "Chưa khả dụng"), Users §5, Đổi mật khẩu tự đổi §9.2, Trạng thái chung §12. Câu chữ VI/EN nguyên văn nằm ở các mục đó; frontend-lead chép vào `locales/*.json`, ghi nhãn e2e vào bảng dưới. Menu M1: Tổng quan (tạm), Tenants (platform_admin), Users. Cắt phần 2FA, group, config badge (Mơ hồ C1–C3).

Chi tiết đầy đủ (route, trạng thái từng màn, câu chữ VI/EN mới, nhãn e2e, validate, lỗi API → UI, hiệu năng, a11y): [plan-frontend.md](plan-frontend.md). Bảng dưới là tóm tắt; câu chữ nguyên văn ở `admin-missing-screens.md` (§4, 5, 9, 12) và [plan-frontend.md §7](plan-frontend.md).

| Màn / thành phần | Trạng thái (tải · rỗng · lỗi · không quyền) | Câu chữ VI | Câu chữ EN | Role + nhãn cho e2e |
|---|---|---|---|---|
| Đăng nhập `/login` | nút "Đang đăng nhập…" · — · `alert` chung (không nói rõ trường sai) · đã đăng nhập → `/` | Đăng nhập · "Sai mã công ty, tên đăng nhập hoặc mật khẩu." · "Tạm khoá đến {HH:MM}" | Sign in · "Wrong company code, username or password." · "Temporarily locked until {time}" | `textbox "Mã công ty"` · `textbox "Tên đăng nhập"` · `getByLabel("Mật khẩu")` · `button "Đăng nhập"` · `alert` |
| Đổi mật khẩu bắt buộc `/change-password` | nút loading · — · token hết hạn → `alert` + "Đăng nhập lại" | Đặt mật khẩu mới · Đặt mật khẩu và tiếp tục | Set a new password · Set password and continue | `getByLabel("Mật khẩu mới")` · `getByLabel("Nhập lại mật khẩu mới")` · `button "Đặt mật khẩu và tiếp tục"` · không có "Bỏ qua" |
| Đổi mật khẩu tự đổi `/account/password` · Member `/member` | nút loading · — · sai MK hiện tại → lỗi dưới ô | Đổi mật khẩu · Tài khoản của bạn dùng Chat App | Change password · Your account uses Chat App | `getByLabel("Mật khẩu hiện tại")` · `button "Đổi mật khẩu"` · `heading "Tài khoản của bạn dùng Chat App"` |
| App shell | skeleton khi khởi tạo phiên · — · mất kết nối banner · dialog phiên hết hạn · menu ẩn mục không quyền | Tổng quan · Tenants · Users · Tài khoản của bạn · Đăng xuất | Overview · Tenants · Users · Your account · Sign out | `navigation "Điều hướng chính"` · `button "Tài khoản của bạn"` · `menuitem "Đăng xuất"` · `dialog "Phiên đăng nhập đã hết hạn"` |
| Tenants `/tenants`, `/tenants/new` | skeleton bảng · "Chưa có tenant khách hàng nào…" · `ErrorState` · tenant_admin → 403 | Tenants · + Tạo tenant · Tạo tenant · Đã tạo tenant {key} | Tenants · + New tenant · Create tenant · Tenant {key} created | `link "+ Tạo tenant"` · `table "Tenants"` · `textbox "Mã công ty"` · `button "Tạo tenant"` · `dialog "Đã tạo tenant acme"` · `textbox "Mật khẩu tạm"` · `checkbox "Tôi đã lưu mật khẩu tạm"` |
| Tenant chi tiết `/tenants/:id` | skeleton · — · 404 nếu id lạ · 409 `VERSION_CONFLICT` → toast + Tải lại · tab Feature/Agent/Quota "Chưa khả dụng" | Khoá tenant · Mở khoá tenant · Chưa khả dụng | Lock tenant · Unlock tenant · Not available yet | `tab "Thông tin"` · `button "Khoá tenant"` · `alertdialog "Khoá tenant acme?"` · `textbox "Gõ acme để xác nhận"` · `button "Lưu"` |
| Users `/users` + drawer | skeleton · "Chưa có người dùng nào ngoài bạn…" · `ErrorState` · tenant lạ/khác → 404 · "Tất cả tenant" → `+ Tạo user` bị khoá | Users · + Tạo user · Tạo user · Reset mật khẩu · Khoá · Đăng xuất mọi thiết bị | Users · + New user · Create user · Reset password · Lock · Sign out everywhere | `table "Users"` · `button "+ Tạo user"` · `dialog "Tạo user"` · `button "Thao tác khác"` → `menuitem` · `textbox "Mật khẩu tạm"` · `alertdialog "Khoá cuong.le?"` |

Validate (khớp contract, câu lỗi ở plan-frontend §4): mã công ty `^[a-z0-9-]{2,32}$` (ô tự chuyển thường + bỏ dấu) · tên đăng nhập `^[a-z0-9._-]{2,32}$` · tên hiển thị bắt buộc ≤ 64 · email bắt buộc với `tenant_admin`, đúng định dạng · slot subscription số nguyên ≥ 1 hoặc trống · mật khẩu mới ≥ 10 và ≤ 128, nhập lại khớp, khác mật khẩu hiện tại · server: `KEY_TAKEN`, `USERNAME_TAKEN`, `EMAIL_TAKEN` hiện dưới ô tương ứng.

Quyết định FE đã chốt (chi tiết plan-frontend §0): C1–C3 như ghi ở trên · access token chỉ trong bộ nhớ, refresh cookie httpOnly · chống đua refresh nhiều tab bằng Web Locks + BroadcastChannel (B4) · bảng phân trang server, không virtualize/TanStack Table ở M1 · mật khẩu tạm hiện nguyên 16 ký tự, không chèn dấu `-` · ADR-0004 (`sonner`, `@hookform/resolvers`) Accepted (Gate 2026-10-01).

## 6. Hiệu năng
Mặc định theo `CONVENTIONS.md` §6 và ADM-NFR-03 (CRUD < 300 ms). Bundle web: `check:bundle` giữ ngân sách M0 (JS ≤ 150 KB gzip ban đầu, route-split các màn).

**argon2id:** `Bun.password` `{algorithm:"argon2id", memoryCost: 19456 (KiB), timeCost: 2}` (p=1) = mức khuyến nghị OWASP (m=19 MiB, t=2, p=1). Đo trên máy dev 2026-10-01 (Bun 1.3.14, 10 lần verify): 19456/2 = **22 ms**; 47104/1 = 31 ms; mặc định Bun 65536/2 = 84 ms. Chọn 19456/2 vì M1 không có rate-limit IP: bộ nhớ mỗi lần verify nhỏ (19 MiB) chịu được dồn đăng nhập. Verify đọc tham số từ chuỗi hash nên đổi tham số sau này không cần migrate. Hash giả cho M1-R01 tính một lần lúc khởi động với cùng tham số.

**Ngân sách siết cho M1** (p95, DB 5.000 user/tenant, máy dev): `POST /auth/login` < 150 ms · `POST /auth/refresh` < 50 ms · middleware xác thực (verify JWT + đọc user theo PK) < 5 ms · `GET /admin/users` < 100 ms · mọi CRUD còn lại < 300 ms. Pool `postgres` `max: 10`.

| Truy vấn | Index dùng |
|---|---|
| Đăng nhập: tenant theo key / user theo username | `tenants_key_uq` (qua `admin.tenant_id_by_key`) / `users_tenant_username_uq` |
| Refresh/logout theo token | `refresh_tokens_hash_uq` (qua `admin.tenant_id_by_refresh_hash`, rồi theo PK) |
| Middleware đọc actor | `users` PK + `tenants` PK |
| `GET /admin/users` (một tenant) sắp `username` + `counts` | `users_tenant_username_uq`; `?q` ILIKE trên `username/display_name/email` quét các hàng của tenant (≤ 5.000, ước < 10 ms) — không thêm `pg_trgm` ở M1 |
| `GET /admin/users` mọi tenant (platform) | `users_username_idx (username, id)` |
| `GET /admin/tenants` + `user_count` | `tenants_key_uq`; đếm `GROUP BY tenant_id` qua `users_tenant_username_uq` |
| Đếm admin còn lại (LAST_ADMIN) | `users_tenant_role_active_idx` |
| Thu hồi token theo user / tenant / chuỗi | `refresh_tokens_user_active_idx` / `refresh_tokens_tenant_active_idx` / `refresh_tokens_family_idx` |

Kiểm: `apps/admin-api/src/modules/users/users.perf.int.test.ts` (backend-lead, T7) nạp 5.000 user, đo p95 20 lần `GET /admin/users?q=…` và `POST /auth/login` in-process. Hàng `refresh_tokens` hết hạn chưa được dọn ở M1 (TECH-DEBT).

## 7. Phụ thuộc & giả lập

| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Postgres 16 | compose `postgres`; DB `ai_system_test` cho `test:int`. Migrate/seed/reset bằng owner (`TEST_DATABASE_URL`); app và test RLS bằng role `admin_api` (`TEST_ADMIN_API_DATABASE_URL`) — xem §4 |
| SMTP (Mailpit) | Chưa dùng ở M1 (email quota ở M4) |
| Redis | Chưa dùng ở M1 (không rate-limit IP) |
| Hub | Không cần; M1 chỉ xuất public key (`JWT_PUBLIC_KEY`, `JWT_KID`) |

**Env** (`.env.example` + CI):
- Mới: `ADMIN_API_DATABASE_URL=postgres://admin_api:admin_api_dev_pw@localhost:5432/ai_system` (admin-api runtime), `TEST_ADMIN_API_DATABASE_URL=postgres://admin_api:admin_api_dev_pw@localhost:5432/ai_system_test` (test tích hợp chạy app/RLS). Giá trị dev, không phải secret (giống `ai_dev_pw`). `.env.local` cũ không có hai dòng này → admin-api báo "Env không hợp lệ: ADMIN_API_DATABASE_URL"; chép từ `.env.example` (ghi ở README admin-api).
- Đã có từ M0, M1 bắt đầu dùng: `JWT_PRIVATE_KEY` (PEM PKCS8 Ed25519), `JWT_PUBLIC_KEY` (PEM SPKI), `JWT_KID` (1–64 ký tự) — admin-api `config/env.ts` validate, khởi động ký thử + verify thử một token (cặp khoá lệch → exit 1); `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD` — chỉ `seed.ts` đọc. `DATABASE_URL` giữ nghĩa owner (migrate/seed). `SECRET_MASTER_KEY` chưa dùng ở M1 (M2), không validate.
- CI (`.github/workflows/ci.yml`): thêm `ADMIN_API_DATABASE_URL`, `TEST_ADMIN_API_DATABASE_URL`, `SEED_ADMIN_USERNAME=admin`, `SEED_ADMIN_PASSWORD=Seed-Admin-Pw-01` (giá trị dev cố định, không phải secret; e2e đọc `SEED_ADMIN_*` từ env), env e2e `ADMIN_API_URL=http://localhost:3001`, `APP_ENV=test`, `PORT=3001`, `JWT_*`; khoá JWT dev sinh trong job (`bun run keys:dev` ghi `.env.local`); bước `db:migrate` + `db:seed` chuyển lên **trước** E2E (e2e M1 cần DB + seed).

Thư viện mới: `jose` 6.2.12 (đã Accepted trong ADR-0001) — thêm vào `apps/admin-api` (dependencies) + gốc (devDependencies, cho test). **Không** cài `@hono/zod-validator` (có trong bảng ADR-0001) — tự viết `parseJson/parseQuery` ~30 dòng để kiểm soát định dạng `VALIDATION_ERROR`. Không cần ADR backend mới.

## 8. Tiêu chí nghiệm thu (qc)

Ba AC dưới trích nguyên văn [BA §11](../../design/admin/ba-admin.md). qc điền cột Test và dữ liệu cụ thể trong `test-plan.md`.

| AC | Given / When / Then (nguyên văn BA) | Test |
|---|---|---|
| AC-A01 | **Đăng nhập.** Given user `an` của tenant `acme` đang active, When đăng nhập đúng mã công ty `acme` và mật khẩu, Then nhận access token (có `user_id`, `tenant_id`, `role`, hết hạn sau 15 phút) và refresh token. Given sai mật khẩu 5 lần, When thử lần thứ 6, Then bị từ chối với thông báo "tạm khoá đến HH:MM". | `tests/acceptance/M1/…` (qc) |
| AC-A02 | **Khoá user.** Given user `an` đang đăng nhập trên Extension, When tenant admin khoá `an`, Then lần refresh tiếp theo thất bại, và chậm nhất sau 15 phút `an` mất quyền truy cập Hub. | (qc) |
| AC-A09 | **Cách ly tenant.** Given tenant admin của `acme`, When gọi `GET /admin/users/:id` với id của user thuộc tenant `globex`, Then nhận 404. | (qc) |

Ghi chú đọc AC: claim `user_id`/`tenant_id` ở AC-A01 = `sub`/`tid` theo M1-R02; "mất quyền truy cập Hub" kiểm ở phía Admin bằng `exp ≤ iat+900` và refresh bị từ chối (Hub chưa có, theo readiness #12).

**AC bổ sung do spec đề xuất** (qc xác nhận hoặc sửa; mã `M1-ACnn`, không phải AC của BA):

| AC | Given / When / Then | Luật |
|---|---|---|
| M1-AC01 | Seed hai lần liên tiếp trên DB sạch: có đúng 1 tenant `platform`, 1 feature `core`, 1 `platform_admin`; lần hai không đổi `password_hash`; đăng nhập bằng env thành công | NFR-06, R20 |
| M1-AC02 | Với RLS: kết nối role `admin_rw`, `app.tenant_id`=acme, `SELECT` trực tiếp bảng `users` chỉ thấy user acme dù không có `WHERE` | NFR-07, R13 |
| M1-AC03 | Khoá tenant `acme`: user acme đăng nhập → 403/401 theo R01/R04, refresh cũ bị từ chối; mở khoá: user bị khoá riêng vẫn không đăng nhập được | FR-61, R10 |
| M1-AC04 | Refresh token dùng lại sau khi đã xoay → 401 và token mới của cùng chuỗi cũng mất hiệu lực | FR-02, R07 |
| M1-AC05 | `tenant_admin` duy nhất của tenant tự khoá mình → 403; `platform_admin` khoá nốt `tenant_admin` cuối → 409 `LAST_ADMIN` | BR-08 |
| M1-AC06 | `must_change_password`: đăng nhập trả `password_change_required`; đổi mật khẩu → đăng nhập lại bình thường; mật khẩu mới < 10 ký tự bị từ chối | FR-06 |
| M1-AC07 | `member` gọi `GET /admin/users` → 403; username `an` tạo được ở cả `acme` và `globex`, trùng trong cùng tenant → 409 | BR-05, FR-63 |
| M1-AC08 (e2e) | Đăng nhập admin web bằng seed → vào shell → Tenants → tạo tenant → thấy dialog mật khẩu tạm một lần → đăng xuất | FR-01, 60, 04 |

Lệnh xong: `docker compose up -d --wait && bun run db:migrate && bun run db:seed && bun run check && bun run typecheck && bun test && bun run test:int && bun run i18n:check && bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web check:bundle && bunx playwright test && bun run test:lock:verify && bun run trace --check`

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- Mọi mặc định trong [readiness 2026-10-01](../../readiness/2026-10-01-admin-m1-m4.md) được chấp nhận; áp dụng ở M1: #4 (định dạng lỗi), #5 (JWT EdDSA, claim), #14 (không có "Cài đặt đăng nhập"), #17 (RLS + repository + role), #21 (`locked_by_tenant`, cấm khoá `platform`), #22 (refresh reuse, cookie), #23 (`password_change_required`, đổi mật khẩu), #24 (mã lỗi, không "Còn N lần thử"), #25 (username), #38 (`?tenant_id=`), #39/#40 (env, thư viện), #47, #49, #53.
- **Bỏ** "Còn N lần thử" (câu hỏi 1). **2FA và Import/Export không thuộc M1, để M4** (câu hỏi 2). **EdDSA** (câu hỏi 3).
### Đề xuất đã chấp nhận (docs-architect đề xuất; **Người dùng chấp nhận tại Gate 2026-10-01**, mục Cao (b) #5–#15 — xem [readiness.md](readiness.md); nhãn `ĐX` ở §2)
Các mặc định mới (`[ĐX]` ở M1-R01, 03, 04, 06, 15, 17, 20) và nguồn mặc định `admin-missing-screens.md` §15 (không có Xoá tenant; mã công ty/username bất biến; reset mật khẩu đăng xuất mọi thiết bị; mật khẩu tạm 16 ký tự; giao diện tách 4 nhóm bằng CSS (4 `<span>`), giá trị hiển thị/sao chép là chuỗi gốc 16 ký tự, không chèn `-`). `admin-missing-screens.md` §15 (15.1, 15.2, 15.5) đã được người dùng duyệt tại Gate 2026-10-01 — danh sách mơ hồ đầy đủ ở báo cáo bàn giao của docs-architect (A1–C3), tóm tắt:
- A1 FR-62 (Group) nằm trong dải "FR-60–63" của M1 nhưng ROADMAP M3 cũng liệt kê → M1 **không** làm Group.
- A2 `features` cần cho seed `core` dù FR-30 thuộc M2 → bảng tạo ở M1, API M2.
- A3 `PATCH` + `version` → 409 có sẵn từ M1, modal UI ở M3.
- A4 Ghi audit từ M1: không (FR-51 = M4) → lịch sử M1 không có trong Nhật ký; ghi TECH-DEBT nếu chọn khác.
- A5 Seed `must_change_password=false` (xem M1-R20).
- A6 Phân biệt web/extension khi trả refresh token: header `X-Client: extension` → body, ngược lại cookie.
- B1 Phạm vi bảng M1; B2 RLS vs role kết nối (owner/superuser bỏ qua RLS) — backend-lead chốt trong §4.
- C1–C3 Menu/trang chủ/config badge ở shell M1.

### Backend-lead PLAN (2026-10-01; theo thứ tự nguồn Luật 2; đã duyệt ở Gate M1 2026-10-01)
- **Xác nhận** A1, A2, A3, A5, A6 như trên; A4: M1 không ghi audit → TECH-DEBT "thay đổi tenant/user trước M4 không có trong Nhật ký" (điều phối/docs-architect ghi). A5: claim `sub`/`tid` (= `user_id`/`tenant_id` của AC-A01), thêm `sid`. A6: chỉ kiểm phía Admin (`exp ≤ iat+900`, refresh bị từ chối).
- **Xác nhận các `[ĐX]` §2:** R01 (401 đồng nhất + verify giả — chống dò user/thời gian); R03 (lần sai thứ 5 vẫn 401, lần 6 → 423; khoá tạm kiểm **trước** verify; 423 chỉ lộ user tồn tại sau 5 lần sai — chấp nhận theo RD#24); R04 (403 chỉ khi đúng mật khẩu — kẻ dò phải có mật khẩu); R05/R06 (`change_token` không trạng thái, một lần nhờ `pwc`); R15, R17 (16 ký tự `[A-Za-z0-9]` ≈ 95 bit, lấy mẫu loại bỏ để không lệch); R19 (`limit` ≤ 200); R20 (seed `must_change_password=false` vì mật khẩu do vận hành đặt qua env secret). R20 "chạy sau `db:migrate`" hiểu là **thứ tự**: `db:migrate` giữ nguyên (CI M0 không có env seed), thêm `db:seed` và `db:setup`.
- **B2 (cách ly tenant):** role đăng nhập riêng `admin_api` (NOBYPASSRLS, không sở hữu bảng) + RLS theo `app.scope`/`app.tenant_id` transaction-local + 2 hàm SECURITY DEFINER chỉ trả `tenant_id` + kiểm role DB lúc khởi động (§4). Loại phương án "`SET LOCAL ROLE admin_rw` trên kết nối owner": session vẫn là superuser, một query quên bọc transaction là bỏ qua RLS.
- **B3:** `family_id` = id token đầu chuỗi; reuse → thu hồi theo `family_id`. Hạn chuỗi tuyệt đối 30 ngày (không trượt) — đơn giản, giới hạn thời gian một token bị lộ còn dùng được.
- **B4 (nhiều tab):** BE ân hạn 10 s: token vừa `rotated` dùng lại → 401 `REFRESH_SUPERSEDED`, không thu hồi chuỗi; FE vẫn tuần tự hoá bằng Web Locks (plan-frontend §3.3) và thử lại một lần khi gặp mã này (cookie lúc đó đã là token mới).
- Middleware Admin đọc user từ DB mỗi request (khoá/hạ role có hiệu lực ngay ở Admin), Hub vẫn theo `exp`.
- BR-08 đếm `tenant_admin` `active=true` ở **mọi** tenant (kể cả đang khoá) — chặt hơn BA để mở khoá tenant không bao giờ ra tenant không có admin; `LAST_ADMIN.details.scope`.
- Tự reset mật khẩu của chính mình qua `/admin/users/:id/reset-password` → 403 `SELF_ACTION_FORBIDDEN` (dùng đổi mật khẩu). Mở khoá user xoá luôn khoá tạm.
- Mật khẩu hiện tại sai ở chế độ tự đổi **tính vào** bộ đếm khoá tạm (chống dò mật khẩu bằng phiên bị lấy cắp).
- Contract theo yêu cầu frontend-lead (plan-frontend §9): nhận tên mã `INVALID_CURRENT_PASSWORD`, `PASSWORD_UNCHANGED`, `INVALID_CHANGE_TOKEN`, `status:"authenticated"`, `locked_until`, `stats.{user_count,tenant_admin_count,locked_user_count}`, `counts`, `LAST_ADMIN.details.scope`, hằng/regex export. Khác yêu cầu: (1) `TokenGrant` có thêm `token_type`, `user: Me` (đỡ một lần gọi `/auth/me` sau đăng nhập/refresh); (2) thêm 401 `REFRESH_SUPERSEDED` (B4); (3) `POST /admin/tenants` không thể trả `USERNAME_TAKEN`/`EMAIL_TAKEN` (tenant mới chưa có user) — FE map cũng không sao; (4) cổng admin-api dev là `PORT=3001` (`.env.example` M0), không phải 4000 — `ADMIN_API_URL=http://localhost:3001`.
- Không thêm thư viện: `jose` (ADR-0001); bỏ `@hono/zod-validator`.

### Trong lúc làm (agent tự quyết theo Luật 2)
- 2026-10-01 · backend-lead · T1: `versionConflictDetailsSchema` đặt ở `packages/contracts/src/version-conflict.ts` (không phải `common.ts` như plan §2) và nhận **cả** tên thực thể `"tenant" | "user"` (test-plan A5/A6/A7 gọi `versionConflictDetailsSchema("tenant")`) **lẫn** một schema zod (plan §2) — nhận tên cần import `tenants`/`users`, đặt trong `common.ts` sẽ thành import vòng. Export qua `index.ts` nên nơi import không đổi.
- 2026-10-01 · backend-lead · T1: schema trường dùng chung đặt tên có hậu tố `Schema` theo CONVENTIONS §3: `TenantKeySchema`, `UsernameSchema`, `EmailSchema`, `DisplayNameSchema`, `TenantNameSchema`, `NewPasswordSchema`, `VersionSchema`, `TempPasswordSchema`; kiểu TS `TenantKey`, `Username`, `Email`. Giữ `IsoDateTime`, `UuidSchema`, `ListQueryBase` đúng tên plan §2.
- 2026-10-01 · backend-lead · T1: export thêm (không đổi contract): `ERROR_CODES`, `ErrorCodeSchema`, `ApiErrorStatus`, `ENTITY_STATUSES`, `TEMP_PASSWORD_RE`, `LIST_OFFSET_MAX = 100000`, `LIST_Q_MAX = 100`, `MAX_CONCURRENT_SUB_MAX = 10000`, `ListCountsSchema`, `CountSchema`, `TenantStatsSchema`, `MaxConcurrentSubSchema`, `LogoutRequestSchema` (`{refresh_token?: ≤ 200}`), `ForcedChangePasswordRequestSchema`, `SelfChangePasswordRequestSchema`, `X_CLIENT_EXTENSION = "extension"`, `ACCESS_TOKEN_EXPIRES_IN = 900`, `CHANGE_TOKEN_EXPIRES_IN = 300` — để BE/FE/QC dùng chung một nguồn.
- 2026-10-01 · backend-lead · T1: `UserSchema`, `TenantSchema`, `TenantDetailSchema` có `refine` khoá bất biến `status` (spec §3: user `locked` ⇔ `!active || locked_by_tenant`; tenant `locked` ⇔ `!active`) — response sai trạng thái bị test bắt.
- 2026-10-01 · backend-lead · T1: ô đăng nhập (`tenant_key`, `username`) chỉ kiểm trim+lower 1–64, **không** kiểm regex định danh, để sai định dạng vẫn ra 401 `INVALID_CREDENTIALS` (M1-R01) thay vì 400. `change_token` giới hạn 1–4096 ký tự (JWT; spec không nêu trần). Trường `id`/`key`/`name` trong response không trim lại ngoài schema định danh dùng chung.
- 2026-10-01 · backend-lead · T1: `EmailSchema` = `string().trim().toLowerCase().max(254).pipe(z.email())` vì kiểm định dạng của `z.email()` chạy trước transform trim/lower (đã thử zod 4.6.5). `ListQueryBase` dùng `z.coerce.number()` cho `limit`/`offset` (query là chuỗi); `q` output là `q?: string` (rỗng sau trim → `undefined`).
- 2026-10-01 · backend-lead · T1: dữ liệu mẫu unit test contract đặt ở `packages/contracts/src/test-fixtures.ts` (không export qua `index.ts`).
- 2026-10-01 · qc · Q2: sửa test khoá M0 `e2e/smoke.spec.ts` (M0-AC18): `/` chưa đăng nhập chuyển `/login` (H1 "Đăng nhập", title "Đăng nhập · Admin", `html[lang=vi]`); **bỏ ca logo "EvoluConsulting"** vì trang `/login` chỉ có chữ "EvoluConsulting · Intelligent automation" ở chân cột trái, không có `img`. Ca "không có lỗi console" bỏ qua đúng một dòng Chrome ghi "Failed to load resource … 401" của `POST /auth/refresh` âm thầm khi khách chưa đăng nhập (hành vi đúng, plan-frontend §3.1). Lý do chung: M1 thêm route guard (thay đổi phạm vi dự kiến, không phải tranh chấp).
- 2026-10-01 · qc · Q2: sửa test khoá M0 `tests/acceptance/ADM-NFR-06/migrate.int.test.ts` (readiness lần 4 Thấp #7): development/test `{main:3,dev:2}` và `[3,2]`, production `{main:3,dev:0}`; danh sách bảng thêm `admin.features|refresh_tokens|tenants|users` (production: đúng 4 bảng admin.*, 0 bảng hub.*). Lý do: M1 thêm 2 migration chính + 1 migration dev (spec §4). Kiểm vai trò `admin_rw`/`hub_ro`/default privileges giữ nguyên.
- 2026-10-01 · frontend-lead · FE0: `shadcn add` (4.21.0) tự thêm `cn` và `next-themes` vào `package.json` và import `cn` từ gói `cn` (sai); đã gỡ cả hai, trỏ import về `@/lib/utils`; `sonner.tsx` bỏ `useTheme`, cố định `theme="light"` (chưa có dark toggle, M0).
- 2026-10-01 · frontend-lead · FE0: cài `radix-ui@1.6.7` (đúng ADR-0001, shadcn cần), `react-hook-form@7.89.0`, `@hookform/resolvers@5.9.1`, `sonner@2.0.8`, `zod@4.6.5` (= contracts), `@ai/contracts` workspace; `npm view` khớp ADR-0004, không chênh lệch.
- 2026-10-01 · frontend-lead · FE0: biến thể `Badge` `ok|off|warn|info|err` dùng token đang có (`success-bg/success`, `muted/muted-strong-foreground`, `warning-bg/warning`, `accent/accent-foreground`, `danger-bg/danger`) vì `--status-*` như plan nêu **không tồn tại** ở M0; tương phản đo ở FE6.
- 2026-10-01 · frontend-lead · FE0: `--subtle-foreground` đã là `#736c89` từ M0 (FE-R1), không cần đổi.
- 2026-10-01 · frontend-lead · FE0: `server.proxy` `/auth`, `/admin` → `ADMIN_API_URL` (mặc định `http://localhost:3001`); đã thử `rsbuild preview` với backend tắt: `/auth/login` và `/admin/tenants` trả 504 do proxy (không phải 404/HTML) → preview có áp proxy. `.env.example` thêm `ADMIN_API_URL`, `PUBLIC_CHAT_APP_URL` (trống = ẩn nút); khai báo type trong `src/env.d.ts`. Chưa đụng `playwright.config.ts` (FE0b).
- 2026-10-01 · frontend-lead · FE0: số đo sau build: `check:bundle` js 95,9 KB / css 12,3 KB gzip (ngân sách 150/25). Chưa có component nào được import nên bundle chưa đổi so với M0; đo chunk route ở FE6.
- 2026-10-01 · frontend-lead · FE1a: `lib/session.ts` là singleton (không factory), refresh qua `createRefresher` (hàm thuần, test bằng `deps` giả); `refresh({allowShared:false})` khi khởi động trang vì cần `me` (token broadcast không kèm `me`). Thêm `lib/next.ts` (`safeNext`, chặn open redirect) và `lib/use-session.ts`, `lib/use-translate.ts` (`t` nới kiểu cho key động của bảng mã lỗi/menu).
- 2026-10-01 · frontend-lead · FE1a: `lib/errors.ts` xuất `ERROR_MESSAGE_KEYS` để FE2 kiểm mọi key tồn tại trong `vi.json`/`en.json`.
- 2026-10-01 · frontend-lead · FE1b: shadcn `Button`/`Input` sinh cho React 19 (`ref` là prop) → bọc `forwardRef` (React 18: Radix `asChild`, Tooltip/Dropdown và react-hook-form `register` cần ref); `dialog.tsx`/`sheet.tsx` thay chữ "Close" cứng bằng `t("common.close")`.
- 2026-10-01 · frontend-lead · FE1b: `app/i18n.ts` bỏ `app.meta.title` (D16): `syncDocument` chỉ đặt `lang`, tiêu đề tab do từng trang đặt qua `useDocumentTitle` ("<H1> · Admin"); thêm chọn ngôn ngữ ban đầu `ai.locale` → ngôn ngữ trình duyệt → `vi` và lưu `ai.locale` khi đổi.
- 2026-10-01 · frontend-lead · FE1b: bảng key theo plan §7. Key mới ngoài plan: `common.clearSearch`, `common.tenantPicker.label`, `nav.breadcrumb`, `tenants.lock.typeConfirm`, `tenants.unlock.submit`, `tempPassword.tenant`, `tempPassword.username`, `users.drawer.editTitle`. Chuỗi `ĐX` nào chưa dùng ở FE1b thì vào `vi.json`/`en.json` ở FE2 (FE1b chỉ gồm key có literal trong mã).
- 2026-10-01 · frontend-lead · FE1b: để route có kiểu và guard chạy, thêm khung tối thiểu `routes/{login,_authed/member,_authed/account.password}.tsx` + `features/auth/pages/*` (chỉ tiêu đề; FE3 thay) cùng `features/{tenants,users}/pages/*Page.tsx` (stub readiness #2; `TenantsPage` đã chặn `tenant_admin` bằng `ForbiddenState`). `member` dùng `BareLayout` (D8) thay vì `AppShell`.
- 2026-10-01 · frontend-lead · FE1b: `routes/__root.tsx` nạp lười `NotFoundPage` (`lazyRouteComponent`) và `routes/login.tsx` dùng `validateSearch` viết tay thay zod: nếu không, root kéo radix/sonner/zod vào JS ban đầu (181,9 KB > 150 KB). Sau sửa: `check:bundle` js 102,3 KB / css 13,2 KB; chunk async lớn nhất 33,7 KB gzip (≤ 50).
- 2026-10-01 · frontend-lead · FE1b: Tenants/Users/Overview dùng chung `TooltipProvider` đặt trong `AppShell`; `StatusBadge` có tooltip bọc `<span tabIndex=0>` (Badge chưa forwardRef) và `biome-ignore` có lý do (a11y §11).
- 2026-10-01 · frontend-lead · FE2: xung đột cây JSON giữa `users.filter.role` ("Role", `admin-missing-screens` §5) và `users.filter.role.all` (plan §7, `i18n-labels.test.ts` đã khoá). Giữ `users.filter.role.all`, đổi nhãn ô lọc thành `users.filter.role.label` (giá trị vẫn "Role", nhãn e2e `combobox "Role"` không đổi). Đã kiểm 248 key không còn xung đột (`ghi 248/248`).
- 2026-10-01 · frontend-lead · FE2: bộ key đầy đủ M1 = plan §7 + `admin-missing-screens` §0.5/§4/§5/§9/§12 phần dùng ở M1 (bỏ Group/Quota/Access/2FA/xung đột modal). Thêm test `apps/admin-web/src/app/i18n-keys.test.ts` (mọi key literal trong mã + `ERROR_MESSAGE_KEYS` có ở vi và en) và `packages/i18n/src/placeholders.test.ts` (cùng tập `{tham số}`, không rỗng).
- 2026-10-01 · backend-lead · T2: drizzle-kit sinh `CREATE SCHEMA "admin";` ở đầu `0001_admin_identity.sql` (snapshot 0000 không có schema) → sửa tay thành `CREATE SCHEMA IF NOT EXISTS "admin";` (schema đã tạo ở 0000). Snapshot không đổi nên `db:generate` lần 2 vẫn "No schema changes".
- 2026-10-01 · backend-lead · T2: `migrations-dev/meta/_journal.json` thêm entry viết tay cho `0001_admin_api_login_dev` (thư mục dev không do drizzle-kit quản lý, migrator chỉ đọc journal + sql); không thêm snapshot.
- 2026-10-01 · backend-lead · T2: tên CHECK theo mẫu `<bảng>_<cột>_check`; thêm unique `features_key_uq` (spec chỉ ghi UNIQUE, cần tên cho `ON CONFLICT`), CHECK `refresh_tokens_user_agent_check` (≤ 512, spec ghi "cắt ≤ 512") và CHECK `version >= 1` cho mọi bảng có `version`.
- 2026-10-01 · backend-lead · T2: `@ai/db` export thêm `NIL_TENANT_ID`, `NIL_SCOPE` (scope tạm khi gọi hàm SECURITY DEFINER, plan §3.4), bảng Drizzle `tenants/users/refreshTokens/features`, `REVOKE_REASONS`.
- 2026-10-01 · backend-lead · T3: `@ai/db` thêm phụ thuộc `@ai/contracts` (workspace) để `SeedEnvSchema` dùng chung `USERNAME_RE`, `PASSWORD_MIN_LEN/MAX_LEN` (một nguồn). `SEED_ADMIN_USERNAME` không trim/lower (sai là lỗi, không tự sửa giá trị env). `describeError` export từ `migrate.ts` để `seed.ts` dùng lại (cùng gợi ý ECONNREFUSED).
- 2026-10-01 · backend-lead · T3: seed chỉ băm mật khẩu khi chưa có user `(platform, username)`; id hàng seed sinh bằng `Bun.randomUUIDv7()`. `verifyPassword` nuốt lỗi hash không phải PHC → `false` (luồng đăng nhập luôn ra 401 đồng nhất).
- 2026-10-01 · backend-lead · T3: CI chèn bước `bun run keys:dev` ngay trước `Install` (script không cần dependency) và bước `bun run db:migrate && bun run db:seed` ngay trước `E2E`; bước "Migrate" cũ trước `test:int` giữ nguyên (lần 2 là no-op). Env job thêm `ADMIN_API_DATABASE_URL`, `TEST_ADMIN_API_DATABASE_URL`, `SEED_ADMIN_*`, `ADMIN_API_URL`; `JWT_*` lấy từ `.env.local` (env của job vẫn thắng giá trị trong file khi dùng `--env-file`, đã thử Bun 1.3.14).
- 2026-10-01 · backend-lead · T4: `apps/admin-api` thêm `drizzle-orm` 0.45.3 và `postgres` 3.4.9 (đúng bản `@ai/db`, ADR-0003) vì linker isolated không cho import gói của workspace khác; `@ai/db` export `hashPassword`, `verifyPassword`, `PASSWORD_HASH_OPTIONS` (plan §10 G3).
- 2026-10-01 · backend-lead · T4: bộ đếm khoá tạm ghi bằng `SELECT … FOR UPDATE` + hàm thuần `clearExpiredLock`/`afterFailedLogin` thay cho biểu thức `CASE` trong SQL (plan §5 bước 5) — cùng tác dụng chống song song, một nguồn luật; nếu hàng đã bị khoá bởi request khác thì không ghi.
- 2026-10-01 · backend-lead · T4: `classifyRefresh` dùng `now()` của DB đọc cùng câu truy vấn token (không dùng giờ máy app) vì `revoked_at`/`expires_at` do DB đặt — tránh lệch đồng hồ host/container làm sai cửa sổ 10 s (plan §10 G7 "giờ thật/now() của DB").
- 2026-10-01 · backend-lead · T4: access token thiếu `sid` vẫn hợp lệ (`sid=null`; Hub bỏ qua `sid`; tự đổi mật khẩu khi đó thu hồi mọi refresh token); `sub`/`tid` không phải uuid → token hỏng (401), tránh lỗi ép `::uuid` thành 500.
- 2026-10-01 · backend-lead · T4: extension gửi body hỏng/thiếu `refresh_token` ở `/auth/refresh` → 401 `INVALID_REFRESH_TOKEN` (không phải 400), ở `/auth/logout` → 204 (idempotent); web bỏ qua body hoàn toàn.
- 2026-10-01 · backend-lead · T4: `change_token` một lần được bảo đảm cả khi song song: ghi mật khẩu dưới `FOR UPDATE` và so lại `pwc` với `password_changed_at` trước khi cập nhật. Thêm file `auth.session.ts` (phát phiên + `toMe`) để `auth.service.ts` ≤ 250 dòng; message lỗi tiếng Anh cố định theo mã ở `lib/errors.ts`.
- 2026-10-01 · backend-lead · T5: `lib/auth-middleware.ts` tự đọc `users ⋈ tenants` (không gọi repo của module auth, CONVENTIONS §2) và export `authenticate(c, deps)` dùng chung cho `requireAuth` và đổi mật khẩu tự đổi. Đổi mật khẩu tự đổi gắn vào `/auth/change-password` qua `authRoutes({ selfChange })` (body parse trước, chế độ có `current_password` mới xác thực Bearer) — body sai dạng khi chưa đăng nhập trả 400 trước 401.
- 2026-10-01 · backend-lead · T5: server khởi động theo thứ tự env → `loadJwtKeys` (ký + verify thử) → `createDb(ADMIN_API_DATABASE_URL)` → `assertSafeDbRole` → `createDummyHash` → `Bun.serve`; lỗi DB/role được nối thêm "(kiểm tra ADMIN_API_DATABASE_URL)", exit 1. `createDummyHash` chỉ export từ `auth.service.ts` (plan §10 G3).
- 2026-10-01 · backend-lead · T7: policy RLS `admin_rw` siết thành `scope = 'platform' OR (scope = 'tenant' AND <cột tenant> = app.tenant_id)` (plan §3.1 chỉ có `OR <cột tenant> = …`): test khoá `db-rls.int.test.ts:146` đòi `app.scope` lạ + `tenant_id` đúng → 0 hàng. Sửa **tại chỗ** `0002_admin_rls.sql` (chưa push/deploy; test khoá M0/M1 đòi đúng `{main:3, dev:2}` nên không thêm migration 0003); DB dev `ai_system` đã áp lại bằng `ALTER POLICY` cùng biểu thức (DB test reset mỗi lần chạy). Chặt hơn, không nới cách ly.
- 2026-10-01 · backend-lead · T7: BR-08 kiểm trong `guardLastAdmin`: `SELECT … FOR UPDATE` hàng `tenants` của target, **đọc lại** target rồi đếm admin active khác (`users_tenant_role_active_idx`; platform: toàn hệ thống). Khoá user đã khoá → trả ngay (không khoá tenant, không thu hồi lại). Mở khoá user đang active nhưng còn khoá tạm → chỉ xoá `failed_logins/locked_until`, không tăng `version` (bộ đếm không tính version, spec §3).
- 2026-10-01 · backend-lead · T7: PATCH user kiểm theo thứ tự 404 → `version` → `checkRoleChange` → `checkRoleAssignment` → `EMAIL_REQUIRED` (role/email sau thay đổi) → không đổi gì thì trả bản hiện tại → BR-08 (khi đổi role) → ghi (23505 → `EMAIL_TAKEN`). Reset mật khẩu kiểm `SELF_ACTION_FORBIDDEN` trước khi tra (id của chính mình luôn thấy được) để băm argon2 ngoài transaction. `POST /admin/users` chỉ nhận query `tenant_id` (strict).
- 2026-10-01 · backend-lead · T7: `server.ts` gọi `setMinLevel("info")` (thêm vào `lib/logger.ts`): tiến trình con của `bun test` thừa hưởng `NODE_ENV=test` nên trước đó không log request nào (test log `server.int.test.ts` cần có log để kiểm không rò secret).
- 2026-10-01 · backend-lead · T6: `PATCH`/khoá/mở khoá tenant đọc hàng bằng `SELECT … FOR UPDATE` rồi so `version` trong app (thay `UPDATE … WHERE version=$v` + đọc lại, plan §5) — cùng kết quả, đồng thời phát hiện "không trường nào đổi" để không tăng `version` (plan §10 G8). Ghi bị lỗi 23505 bọc trong savepoint (`tx.transaction`) để dịch sang `KEY_TAKEN`/`USERNAME_TAKEN`/`EMAIL_TAKEN` mà không hỏng transaction ngoài.
- 2026-10-01 · backend-lead · T6: thu hồi phiên khi khoá tenant đi qua `auth.service.revokeTenantSessions(tx, …)`; đặt/gỡ `locked_by_tenant` qua `users.service.setTenantLockFlags(tx, …)` (module không import repo của module khác). `likeArg` (thoát `\ % _` cho ILIKE) đặt ở `lib/sql.ts` để users dùng lại.
- 2026-10-01 · backend-lead · T6: log lỗi 500 qua `safeErrorFields` (`lib/pg-errors.ts`): chỉ message + SQLSTATE của Postgres, **không** log message của `DrizzleQueryError` vì nó chứa SQL và tham số (hash, email…).
- 2026-10-01 · backend-lead · T5: log request thêm `tenant_id`, `user_id` khi đã xác thực; không log body/header (plan §6.1).
- 2026-10-01 · frontend-lead · FE3: i18next mặc định nội suy `{{x}}` nhưng toàn bộ chuỗi M1 (plan §7, test i18n khoá) dùng `{x}` → `app/i18n.ts` đặt `interpolation.prefix/suffix = "{" "}"` (có test). Bắt được nhờ e2e "Tạm khoá đến HH:MM".
- 2026-10-01 · frontend-lead · FE3: sonner không gắn role cho toast → `notifySuccess` bọc nội dung bằng `<output>` (role `status`), `notifyError` bằng `<span role="alert">` (khớp plan §6 và các e2e `getByRole("status")`).
- 2026-10-01 · frontend-lead · FE3: `features/auth/api.ts` gom `login`, `changePasswordForced` (nạp session bằng `applyGrant`), `changePasswordSelf`, `patchMyLocale`. `LoginPage` đọc search bằng `getRouteApi("/login")` (tránh import vòng route↔page). `LanguageSwitch` dùng `<fieldset><legend>` (role `group` "Ngôn ngữ") thay `div role=group`.
- 2026-10-01 · frontend-lead · FE4: contract list đã có `counts` và query `status` → chip Tenants dùng `?status=` của server và số chip từ `counts` (thay D11 "đếm phía client"); `q` cũng gửi server (debounce 300 ms), `limit=200`.
- 2026-10-01 · frontend-lead · FE4: `app/query-client.ts` không thử lại lỗi 4xx (404/403 là kết quả đúng, tránh trễ 1 s trước "Không tìm thấy"); 5xx/mạng thử lại 1 lần.
- 2026-10-01 · frontend-lead · FE4: `routes/_authed/users.tsx` nhận `validateSearch` đầy đủ (`tenant,q,status,role,login,page,drawer,user`, viết tay) ngay từ FE4 để link "Mở danh sách Users" có kiểu; FE5 dùng tiếp. Thêm 3 key `tenants.menu.{open,lock,unlock}` cho menu `⋯` (nhãn e2e "Mở"/"Khoá"/"Mở khoá").
- 2026-10-01 · frontend-lead · FE4: `useLockFlow` (hooks) gom hộp thoại khoá (mức nặng, gõ lại key) / mở khoá (mức vừa) cho cả danh sách và chi tiết; tenant `platform` không có nút khoá/mở khoá ở cả hai nơi. Thanh lưu dính đáy chỉ hiện khi form có thay đổi; Lưu bị khoá khi mất mạng (tooltip `state.offline.saveTip`).
- 2026-10-01 · frontend-lead · FE5: tạo user của platform gửi `POST /admin/users?tenant_id=<id>` (id lấy từ `GET /admin/tenants` theo `?tenant=<mã>`); tenant_admin không gửi `tenant_id`. `?tenant=` lạ → `NotFoundState`; drawer `edit` với id lạ/khác tenant (mọi lỗi tải) → "Không tìm thấy" trong drawer.
- 2026-10-01 · frontend-lead · FE5: drawer user tắt nút X và click nền (`showCloseButton=false`, `onInteractOutside` chặn) để `button "Đóng"` là duy nhất và để modal phiên hết hạn không làm đóng drawer; đóng bằng Huỷ/Esc/Đóng (hỏi "Bỏ thay đổi?" nếu form bẩn, hỏi "Đóng mà chưa sao chép…" ở bước mật khẩu tạm). Sửa user chỉ gửi `role` khi đổi (tránh kiểm BR-08 thừa); radio `platform_admin` hiện (vô hiệu) chỉ ở tenant `platform`.
- 2026-10-01 · frontend-lead · FE5: key mới `users.reset.done` ("Mật khẩu tạm của {username}", tiêu đề dialog kết quả reset). Chip "Chưa đăng nhập" là nhóm radio riêng một chip (bấm lần nữa để bỏ chọn); `FilterChips` cho chip đầu tab được khi chưa có chip nào chọn.
- 2026-10-01 · frontend-lead · FE5: `ConfirmDialog` thêm `cancelLabel`. Hành động hàng (khoá/reset/đăng xuất mọi thiết bị) lỗi → toast bền và đóng hộp thoại (LAST_ADMIN khi khoá hiện đúng câu "Tenant phải còn…"); 401 không báo thêm toast.
- 2026-10-01 · frontend-lead · FE6: số đo build: JS ban đầu 106,9 KB, CSS 13,5 KB gzip (ngân sách 150 / 25); chunk route lớn nhất 24,1 KB gzip, kế tiếp 12,4 và 10,6 KB (ngân sách 50): không cần tách vendor (ADR-0004), không ghi `TECH-DEBT`. `lib-react` 44,9 KB gzip.
- 2026-10-01 · frontend-lead · FE6: tương phản đo bằng công thức WCAG 2.x trên token trong `globals.css`: badge ok 6,69 · off 7,39 · warn 7,33 · info 8,58 · err 6,94; chữ thân 15,96; `muted-foreground` 5,86–6,30; `subtle-foreground` `#736c89` 4,96 (card) / 4,81 (sidebar); nút primary 6,46; destructive 6,57; độ mạnh mật khẩu thành công 7,63, cảnh báo 8,23 — tất cả ≥ 4,5.
- 2026-10-01 · frontend-lead · FE6: a11y kiểm thủ công trên bản build (Playwright, phiên giả): `<html lang>` theo ngôn ngữ, `document.title` "<H1> · Admin", H1 nhận focus sau điều hướng, landmark `aside`/`nav` (Điều hướng chính, Đường dẫn)/`main`, 0 nút không tên, 0 ảnh thiếu `alt`, skip-link là phần tử Tab đầu tiên, nút icon có `aria-label`. Các phần còn lại được e2e của qc phủ (focus trap hộp thoại, `aria-invalid`, role/nhãn).
- 2026-10-01 · frontend-lead · FE6: `bunx playwright test` toàn bộ: 35 xanh, 1 đỏ là test đã ghi ở §10 (`e2e/auth.spec.ts:158-160`, đua `loginUI` → `goto`) kéo theo 2 test bị bỏ qua do `serial`; `m1-flow` xanh.

## 10. Tranh chấp test
- 2026-10-01 · backend-lead · T5 · `tests/acceptance/M1/auth-login.int.test.ts:206` (test "ADM-FR-01 · M1-R04 · mật khẩu sai của hai user này → 401 …; 403 cũng đặt failed_logins=0"): dòng 203 đăng nhập **sai** `zeta/zed` (→ `failed_logins=1`), rồi dòng 206 đòi `zed.failed_logins = 0` mà **không** có lần `zeta/zed` + mật khẩu đúng (403) nào ở giữa — chỉ `em` + `PW` (dòng 204). test-plan A1 #11 ghi ý định: "`zeta/zed` + `PW` → 403 …; 403 cũng đặt `failed_logins=0`", tức thiếu một lệnh `env.login("zeta", "zed", PW)` trước dòng 206. Spec M1-R03: bộ đếm theo user, chỉ user **không tồn tại** mới không có bộ đếm → `zed` (tồn tại, bị khoá theo tenant) sai mật khẩu phải tăng đếm. Không đổi hành vi vì bỏ đếm cho user bị khoá sẽ cho phép dò mật khẩu không giới hạn rồi nhận biết đúng qua 403 `ACCOUNT_LOCKED` (yếu bảo mật). Đề xuất qc: thêm `expectErr(await env.login("zeta", "zed", PW), "ACCOUNT_LOCKED");` trước dòng 205. Hiện test này đỏ (1/22 của file); mọi test khác của T5 xanh.
- 2026-10-01 · qc · phân xử tranh chấp trên: **test sai, backend đúng**. Đối chiếu test-plan A1 #11 ("`zeta/zed` + `PW` → 403 … 403 cũng đặt 0") và M1-R03 (user tồn tại, kể cả bị khoá, vẫn có bộ đếm; đăng nhập đúng mới về 0): test thiếu lần `zeta/zed` + `PW` (403). Đã thêm `expectErr(await env.login("zeta", "zed", PW), "ACCOUNT_LOCKED")` trước phép kiểm `failed_logins`; luật không đổi. Đã ghi lại `tests/.lock`.
- 2026-10-01 · frontend-lead · FE3 · `e2e/auth.spec.ts:158-160` (test "ADM-FR-06 · M1-R06 · tự đổi mật khẩu /account/password …"): dòng 158 `await loginUI(page, "acme", "lan", PW)` chỉ click nút Đăng nhập rồi dòng 159 `page.goto("/account/password")` chạy ngay, không chờ đăng nhập xong. `goto` huỷ request `POST /auth/login` đang bay nên cookie `ai_rt` không được lưu → guard `_authed` refresh 401 → trang chuyển `/login`, `getByLabel("Mật khẩu hiện tại")` không bao giờ xuất hiện (timeout 30 s tại dòng 164). Đã thử `fetch(..., {keepalive: true})` cho login: vẫn đỏ. Đối chiếu: test cùng file ở dòng 144-153 ("member lan → /member") chờ heading `Tài khoản của bạn dùng Chat App` trước khi `goto`. Đã kiểm tra phần còn lại của kịch bản bằng một spec tạm có thêm dòng chờ heading đó (xoá sau khi chạy): sai mật khẩu hiện tại → `aria-invalid="true"` ở ô; đúng → toast `status` "Đã đổi mật khẩu · các thiết bị khác đã được đăng xuất" — xanh. Đề xuất qc: thêm `await expect(page.getByRole("heading", { name: "Tài khoản của bạn dùng Chat App" })).toBeVisible();` giữa dòng 158 và 159 (hoặc dùng `loginToShell`-tương-đương cho member). Do chế độ `serial`, test này đỏ làm 2 test sau (English, thu) bị bỏ qua khi chạy cả file; chạy riêng bằng `--grep-invert "tự đổi mật khẩu"` thì 13/13 xanh.
- 2026-10-01 · qc · phân xử tranh chấp FE3 (`e2e/auth.spec.ts` "tự đổi mật khẩu"): **test sai (race của test), FE không sai**. `goto` ngay sau click đăng nhập huỷ request `POST /auth/login` đang bay nên chưa có phiên; đây là hành vi trình duyệt chuẩn, FE không có nghĩa vụ chịu điều hướng giữa chừng. Đã thêm bước chờ heading "Tài khoản của bạn dùng Chat App" trước `goto`, giống test member cùng file. Đã ghi lại `tests/.lock`.
