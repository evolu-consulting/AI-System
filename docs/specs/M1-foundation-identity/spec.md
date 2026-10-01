---
id: M1-foundation-identity
title: Nền tảng & danh tính (DB admin + RLS + seed, Auth, Tenants, Users, App shell)
milestone: M1
status: draft            # draft → ready → approved → in-progress → done
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
- **Luật:** BR-05 (3 role), BR-08 (không tự khoá/hạ role; luôn còn ≥ 1 `platform_admin` active, mỗi tenant active còn ≥ 1 `tenant_admin`), BR-09 (cách ly tenant, 404), NFR-01 (bảo mật mật khẩu/token/khoá).
- **Web (`apps/admin-web`):** app shell (sidebar, topbar, breadcrumb, menu avatar, route guard theo role), i18n VI/EN đầy đủ cho các màn M1, màn Đăng nhập, Đổi mật khẩu (bắt buộc và tự đổi), Tenants (danh sách, tạo, chi tiết tab Thông tin + Users), Users (danh sách + drawer), bộ trạng thái chung ([UI §9](../../design/admin/ui-admin.md), [missing-screens §12](../_design/admin-missing-screens.md)), refresh âm thầm + modal đăng nhập lại.

**Không làm (mốc khác):**
- **2FA/TOTP (FR-08), Import/Export (FR-54): M4** (người dùng chốt 2026-10-01). Không có cột `totp_secret`, không có route `/auth/totp/*`, ẩn mục 2FA ở menu avatar.
- **Group CRUD (FR-62): M3** theo ROADMAP (xem Mơ hồ A1). M1 không có bảng-API group; cột "Group" của Users và bộ lọc theo group ẩn/trống.
- Màn "Cài đặt đăng nhập" `/auth-settings`: loại khỏi M1–M4, ẩn menu (readiness #14). Chính sách mật khẩu cố định trong code.
- Chống ghi đè UI (modal 409, FR-55 = M3), NOTIFY `config_changed` (FR-53 = M3), audit ghi/đọc (FR-51/52 = M4), Quota/Chi phí (M4), tab Feature/Agent/Quota của Tenant (hiện "Chưa khả dụng"), Tổng quan đầy đủ (M4; M1 chỉ trang chủ tạm), "Hiện còn N lần thử" (bỏ), IP/VPN allowlist (ADM-NFR-05, ngoài v1), rate-limit theo IP.
- Hub verify JWT: chỉ cung cấp public key qua env; không có code Hub.

## 2. Nghiệp vụ

Luật nghiệp vụ gốc: [BA §5.1–5.2, §6](../../design/admin/ba-admin.md). Bảng dưới là phần **cụ thể hoá**; dòng gắn `[RD#n]` lấy từ [readiness](../../readiness/2026-10-01-admin-m1-m4.md) (đã chấp nhận), `[ĐX]` = đề xuất mới của docs-architect chờ xác nhận (xem §9).

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| M1-R01 | Tra tenant theo `key` đã `trim().toLowerCase()`. Mọi thất bại xác thực (tenant không có, user không có, sai mật khẩu, user `active=false`, tenant khoá) trả **cùng** 401 `INVALID_CREDENTIALS` + cùng message; user không tồn tại vẫn chạy một lần verify argon2 giả (chống đo thời gian) | FR-01, UI 7.1, RD#24, ĐX |
| M1-R02 | JWT: header `alg=EdDSA`, `kid`; claim `sub`(=user_id), `tid`(=tenant_id), `role`, `iat`, `exp`=`iat`+900, `iss="admin"`, `aud="ai-system"`. Refresh token: chuỗi ngẫu nhiên ≥ 32 byte, DB chỉ lưu hash, hạn 30 ngày | FR-01, NFR-01, RD#5 |
| M1-R03 | Khoá tạm: bộ đếm `failed_logins` theo user. Lần sai thứ 5 → `locked_until = now+15 phút`. Trong lúc khoá, mọi lần đăng nhập (kể cả đúng mật khẩu) → 423 `TEMP_LOCKED {until}` (ISO UTC; UI hiển thị "Tạm khoá đến HH:MM" theo giờ trình duyệt). Đăng nhập đúng hoặc hết hạn khoá → đếm về 0. Không có bộ đếm cho user không tồn tại | FR-07, AC-A01, RD#24, ĐX |
| M1-R04 | Khoá bởi admin (`active=false`) hoặc tenant khoá: trả 403 `ACCOUNT_LOCKED` **chỉ khi mật khẩu đúng**; sai mật khẩu vẫn là M1-R01 (không lộ user tồn tại khi chưa có mật khẩu) | RD#24, ĐX |
| M1-R05 | `must_change_password=true` và mật khẩu đúng → 200 `{status:"password_change_required", change_token}` (hạn 5 phút, dùng một lần, chỉ gọi được `/auth/change-password`), **không** cấp access/refresh token. Đổi xong → cấp token như đăng nhập thường | FR-06, RD#23 |
| M1-R06 | Đổi mật khẩu: mật khẩu mới ≥ 10 ký tự, khác mật khẩu cũ. Chế độ tự đổi cần `current_password`; chế độ bắt buộc dùng `change_token` (mật khẩu tạm đã được xác thực khi đăng nhập). Thành công → `must_change_password=false`, thu hồi mọi refresh token **khác** của user | UI 9, RD#23, ĐX |
| M1-R07 | Refresh: đổi token hợp lệ → access token mới + refresh mới (bản cũ `revoked_at`, gắn cùng `family_id`). Dùng lại token đã thu hồi (reuse) → thu hồi **cả chuỗi** `family_id`, 401 `INVALID_REFRESH_TOKEN`. User/tenant bị khoá → 401. Web: cookie `httpOnly; SameSite=Strict; Path=/auth`; extension: trong body (cách phân biệt: Mơ hồ A6) | FR-02, RD#22 |
| M1-R08 | Đăng xuất: thu hồi refresh token hiện tại (cookie/body); idempotent (token lạ/đã thu hồi vẫn 204) | FR-03 |
| M1-R09 | Khoá user (`POST /admin/users/:id/lock`) → `active=false` + thu hồi mọi refresh token (FR-05). Access token đã cấp còn hiệu lực tối đa 15 phút — **không** có danh sách thu hồi access token. `logout-all` = thu hồi mọi refresh token, giữ `active` | FR-05, AC-A02 |
| M1-R10 | Khoá tenant (cấm với `platform`, 409 `PLATFORM_TENANT_LOCKED`): `tenants.active=false`; mọi user đang `active=true` → `locked_by_tenant=true`; thu hồi mọi refresh token của tenant. Mở khoá: chỉ gỡ `locked_by_tenant`; user bị khoá riêng (`active=false` trước đó) vẫn khoá | FR-61, RD#21 |
| M1-R11 | BR-08: không tự khoá/tự hạ role (403 `SELF_ACTION_FORBIDDEN`); khoá/hạ role/khoá tenant làm hết `platform_admin` active (toàn hệ thống) hoặc `tenant_admin` active (tenant active) → 409 `LAST_ADMIN`. `tenant_admin` khác được hạ role nếu tenant còn ≥ 1 | BR-08, RD#49 |
| M1-R12 | Role gán được: `tenant_admin` chỉ gán `member`/`tenant_admin` trong tenant mình; `platform_admin` chỉ tồn tại trong tenant `platform`; `platform_admin` tạo user ở tenant nào cũng phải chỉ định tenant (M1-R14). `member`: mọi `/admin/*` → 403 `FORBIDDEN`. `tenant_admin` gọi endpoint chỉ-platform (Tenants) → 403 `FORBIDDEN` | BR-05, UI 7.9 |
| M1-R13 | Cách ly: `tenant_admin` truy cập user/tenant của tenant khác → 404 `NOT_FOUND` (cùng body với id không tồn tại), cả GET/PATCH/POST. Tầng repository luôn lọc `tenant_id` **và** RLS bật (`app.tenant_id` đặt theo transaction) — cả hai (xem Mơ hồ B2) | BR-09, NFR-07, RD#17 |
| M1-R14 | `platform_admin` chọn tenant bằng `?tenant_id=`; thiếu → list trả mọi tenant, thao tác ghi trả 400 `TENANT_REQUIRED` (URL web dùng `?tenant=<key>`) | RD#38 |
| M1-R15 | Định danh: mã công ty `^[a-z0-9-]{2,32}$` unique, **bất biến** sau khi tạo; username `^[a-z0-9._-]{2,32}$` unique trong tenant (FR-63), bất biến; trùng → 409 `KEY_TAKEN` / `USERNAME_TAKEN`. Không có Xoá tenant, không có Xoá user (chỉ Khoá) | FR-63, RD#25, ĐX |
| M1-R16 | `email` bắt buộc với `tenant_admin`, tuỳ chọn với `member`, unique trong tenant (không phân biệt hoa thường) | RD#9 |
| M1-R17 | Mật khẩu tạm: 16 ký tự `[A-Za-z0-9]` sinh bằng CSPRNG, trả **một lần** trong response tạo user/tenant/reset (`temp_password`); không lưu ở dạng đọc được, không log; user được tạo luôn `must_change_password=true`. Reset mật khẩu thu hồi mọi refresh token của user | UI 7.9, RD#53, ĐX |
| M1-R18 | Tạo tenant một transaction: tenant + `tenant_admin` đầu tiên (lỗi một nửa → không tạo gì). `max_concurrent_sub` null/số nguyên ≥ 1 | FR-60 |
| M1-R19 | Danh sách: `{items,total}`, `?q&limit=50&offset`, `limit` tối đa 200. Lỗi `{error:{code,message,details?}}` (M0 `ErrorResponseSchema`); `PATCH` nhận `version`, lệch → 409 `VERSION_CONFLICT` (UI xử lý ở M3, Mơ hồ A3) | RD#3, RD#4 |
| M1-R20 | Seed: chạy bởi `bun run db:seed` và sau `db:migrate`; idempotent (chạy lần 2 không đổi gì, không đổi mật khẩu). Tạo `platform` (name "Nền tảng", `max_concurrent_sub` null), feature `core` (`{vi:"Cơ bản",en:"Core"}`, `status=on`), `platform_admin` (`SEED_ADMIN_USERNAME`, hash argon2id của `SEED_ADMIN_PASSWORD`, `must_change_password=false`, `locale=vi`). Thiếu env → exit 1 nêu tên biến, không in giá trị. Cấm chạy seed với `APP_ENV=production` nếu `SEED_ADMIN_PASSWORD` rỗng | NFR-06, ĐX |
| M1-R21 | Tenant `platform` và feature `core` seed thì `core` **tự hiệu lực** với mọi user active, không cần entitlement/grant (logic ở Hub/M3; M1 chỉ seed hàng) | RD#7 |
| M1-R22 | Chuỗi giao diện song ngữ: `packages/i18n/locales/vi.json` + `en.json` khớp key (`bun run i18n:check`); `users.locale` đổi qua `PATCH /auth/me`; mặc định `vi` | UI 15, M0 T-I18N-1 |

## 3. Contract (backend-lead)
<!-- backend-lead -->
File dự kiến: `packages/contracts/src/{auth,tenants,users,common}.ts`. Phải liệt kê: endpoint BA §8 nhóm Auth/Tenant/User + `GET/PATCH /auth/me`, `POST /admin/tenants/:id/{lock,unlock}`, `POST /admin/users/:id/{lock,unlock,logout-all,reset-password}`; mã lỗi ở M1-R01…R19; schema list `{items,total}`; response `temp_password`; cách phân biệt cookie/body (Mơ hồ A6). Chưa điền.

| Method | Path | Role | Request | Response | Lỗi (HTTP · code) |
|---|---|---|---|---|---|
| | | | | | |

Sự kiện / NOTIFY: không có ở M1 (FR-53 = M3).

## 4. Dữ liệu (backend-lead)
<!-- backend-lead -->
Phải trả lời: bảng nào tạo ở M1 (Mơ hồ B1), cột bổ sung từ readiness (`users.email`, `last_login_at`, `locked_by_tenant`; `refresh_tokens.family_id`), chính sách RLS và vai trò `admin_rw` vs `hub_ro` vs owner (Mơ hồ B2), index tìm kiếm `?q`, thứ tự migration (`0001_…`), seed.

| Bảng | Cột | Kiểu | Null | Default | Ràng buộc / index | RLS |
|---|---|---|---|---|---|---|
| | | | | | | |

Migration: … · Seed: M1-R20.

## 5. UI (frontend-lead)
<!-- frontend-lead -->
Artboard có trong `docs/design/canvas/`: Login, ChangePassword, TenantCreate, Users, Sidebar, States, Main (shell). Màn không có artboard theo mẫu trong [admin-missing-screens](../_design/admin-missing-screens.md): Tenants danh sách §4.1, Tenant chi tiết §4.3 (chỉ tab Thông tin + Users; Feature/Agent/Quota hiện "Chưa khả dụng"), Users §5, Đổi mật khẩu tự đổi §9.2, Trạng thái chung §12. Câu chữ VI/EN nguyên văn nằm ở các mục đó; frontend-lead chép vào `locales/*.json`, ghi nhãn e2e vào bảng dưới. Menu M1: Tổng quan (tạm), Tenants (platform_admin), Users. Cắt phần 2FA, group, config badge (Mơ hồ C1–C3).

| Màn / thành phần | Trạng thái (tải · rỗng · lỗi · không quyền) | Câu chữ VI | Câu chữ EN | Role + nhãn cho e2e |
|---|---|---|---|---|
| | | | | |

Validate: …

## 6. Hiệu năng
<!-- backend-lead -->
Mặc định theo `CONVENTIONS.md` §6 và ADM-NFR-03 (CRUD < 300 ms). Riêng M1 cần chốt: chi phí argon2id (tham số `Bun.password`, mục tiêu đăng nhập p95 < 500 ms), index `users(tenant_id, username)`, `refresh_tokens(token_hash)`. Bundle web: `check:bundle` giữ ngân sách M0 (JS ≤ 150 KB gzip ban đầu, route-split các màn).

## 7. Phụ thuộc & giả lập

| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Postgres 16 | compose `postgres`; DB `ai_system_test` cho `test:int` (role `admin_rw` phải dùng được, Mơ hồ B2) |
| SMTP (Mailpit) | Chưa dùng ở M1 (email quota ở M4) |
| Redis | Chưa dùng ở M1 (không rate-limit IP) |
| Hub | Không cần; M1 chỉ xuất public key |

Env mới: không (đã có từ M0: `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KID`, `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`, `SECRET_MASTER_KEY`, `DATABASE_URL`). `apps/admin-api/src/config/env.ts` mở rộng validate các biến này. Thư viện mới: `jose` 6.2.12 (đã Accepted trong ADR-0001, chưa cài); không cần ADR mới nếu không thêm thư viện khác.

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

Lệnh xong: `bun run typecheck && bun test && bun run test:int && bun run i18n:check && bun run --filter @ai/admin-web check:bundle && bunx playwright test && bun run test:lock:verify && bun run trace --check`

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- Mọi mặc định trong [readiness 2026-10-01](../../readiness/2026-10-01-admin-m1-m4.md) được chấp nhận; áp dụng ở M1: #4 (định dạng lỗi), #5 (JWT EdDSA, claim), #14 (không có "Cài đặt đăng nhập"), #17 (RLS + repository + role), #21 (`locked_by_tenant`, cấm khoá `platform`), #22 (refresh reuse, cookie), #23 (`password_change_required`, đổi mật khẩu), #24 (mã lỗi, không "Còn N lần thử"), #25 (username), #38 (`?tenant_id=`), #39/#40 (env, thư viện), #47, #49, #53.
- **Bỏ** "Còn N lần thử" (câu hỏi 1). **2FA và Import/Export không thuộc M1, để M4** (câu hỏi 2). **EdDSA** (câu hỏi 3).
### Đề xuất chờ Gate (docs-architect; không trả lời → áp dụng như ghi, đánh dấu `[ĐX]` ở §2)
Các mặc định mới (`[ĐX]` ở M1-R01, 03, 04, 06, 15, 17, 20) và nguồn mặc định `admin-missing-screens.md` §15 (không có Xoá tenant; mã công ty/username bất biến; reset mật khẩu đăng xuất mọi thiết bị; mật khẩu tạm 16 ký tự nhóm 4 khi hiển thị). `admin-missing-screens.md` **chưa** được người dùng duyệt riêng — danh sách mơ hồ đầy đủ ở báo cáo bàn giao của docs-architect (A1–C3), tóm tắt:
- A1 FR-62 (Group) nằm trong dải "FR-60–63" của M1 nhưng ROADMAP M3 cũng liệt kê → M1 **không** làm Group.
- A2 `features` cần cho seed `core` dù FR-30 thuộc M2 → bảng tạo ở M1, API M2.
- A3 `PATCH` + `version` → 409 có sẵn từ M1, modal UI ở M3.
- A4 Ghi audit từ M1: không (FR-51 = M4) → lịch sử M1 không có trong Nhật ký; ghi TECH-DEBT nếu chọn khác.
- A5 Seed `must_change_password=false` (xem M1-R20).
- A6 Phân biệt web/extension khi trả refresh token: header `X-Client: extension` → body, ngược lại cookie.
- B1 Phạm vi bảng M1; B2 RLS vs role kết nối (owner/superuser bỏ qua RLS) — backend-lead chốt trong §4.
- C1–C3 Menu/trang chủ/config badge ở shell M1.
### Trong lúc làm (agent tự quyết theo Luật 2)
- <ngày> · <agent> · chọn … vì …

## 10. Tranh chấp test
- (không)
