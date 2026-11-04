# Admin · tenant, user, đăng nhập, SSO

Cập nhật: 2026-11-03 · Nguồn: PDF Phần A.

## Tenant / công ty
Mỗi tenant là một công ty khách hàng; mọi user và dữ liệu thuộc đúng một tenant. Công ty vận hành cũng là tenant `platform`.
`admin.tenants`: key (mã, unique, bất biến), name, active, max_concurrent_sub, settings, timezone (IANA, mặc định Asia/Ho_Chi_Minh), process_runs_max, profile, default_app, version.
- ADM-FR-60: CRUD tenant, không xoá ở v1 (chỉ Khoá); tạo kèm tenant_admin đầu.
- ADM-FR-61: khoá tenant ⇒ khoá mọi user + thu hồi refresh token; mở khoá khôi phục trạng thái từng user.
- ADM-FR-72: timezone; tenant_admin chỉ xem.
- ADM-BR-08: tenant luôn còn ít nhất một tenant_admin active. ADM-BR-09: tenant_admin bị giới hạn theo `tenant_id` (ngoài phạm vi ⇒ 404). ADM-NFR-06: seed tạo tenant `platform` + feature `core` + platform_admin đầu.
- Chỉ platform_admin tạo/sửa/khoá; `tenants` là gốc của RLS.

## User và vai hệ thống
`admin.users`: tenant_id, username (unique trong tenant), password_hash (argon2id), display_name, email, role, locale, theme, active, must_change_password, failed_logins, locked_until, locked_by_tenant, kind (internal/external), external_org_id, default_app, version. 2FA ở `user_totp`, `user_backup_codes` (Hub không đọc). Phiên: `refresh_tokens` (xoay vòng, lưu hash). Không có trang tự đăng ký.
Vai hệ thống (ADM-BR-05): platform_admin (toàn hệ thống + Studio) · tenant_admin (chỉ tenant mình, không vào Studio) · member (chỉ `/auth/*` + đổi mật khẩu mình).
- FR-01..03: đăng nhập (mã công ty + username + mật khẩu ⇒ JWT 15 phút, refresh 30 ngày; refresh xoay vòng; logout thu hồi).
- FR-04/05: admin CRUD/khoá user + reset mật khẩu; khoá ⇒ thu hồi token. FR-06: mật khẩu tạm, bắt đổi lần đầu. FR-07: sai 5 lần khoá 15 phút. FR-08: 2FA TOTP (bắt buộc cho admin). FR-63: username duy nhất trong tenant.
- BR-08: không tự khoá/hạ vai mình, luôn còn ít nhất một platform_admin. NFR-01: argon2id, JWT EdDSA, master key env. NFR-04: Admin chết thì Hub vẫn verify JWT.
- tenant_admin chỉ thao tác user trong tenant mình.

## Định danh và SSO
ADR-0018: admin-api là nguồn đăng nhập duy nhất (JWT EdDSA, JWKS); SSO OIDC theo tenant (Google Workspace, Entra) ở GĐ2; MFA bắt buộc cho admin; Hub cấp token ngắn hạn cho tool MCP.
SSO nội bộ (spec sso-switch): `POST /auth/sso/code` mã 32 byte sống 60 giây (SHA-256 trong Redis, dùng một lần); `POST /auth/sso/redeem` đổi mã lấy phiên app đích (cookie riêng `ai_rt_<app>`); URL đích chỉ từ cấu hình build (không open redirect); token gắn tid/sub/sid/app, sai công ty hoặc phiên nguồn đã logout ⇒ 401.
identity-import (N5): chuyển user mgmt-app sang admin-api (CLI, dry-run, lô 500, idempotent); `auth.legacy` verify scrypt rồi rehash argon2id (`LEGACY_HASH_SUNSET`).

## CR-118 · Delta gộp 2026-11-04 (đợt cr118-r1)
Mục dưới đây thắng nội dung cũ cùng chủ đề ở trên (lát: cr118-spec, cr118-auth).

#### Yêu cầu: Phiên riêng theo app (CR-053) — Community dùng chung phiên `contracts` (nguồn: cr118-spec)
Cookie refresh vẫn `ai_rt_<app>` cho từng app web (admin, chat, studio, contracts); app `community` không còn web riêng nên không có cookie `ai_rt_community` ở web mới (`WEB_APPS` giữ `community` để tương thích, không dùng). Người dùng SHT không phải đăng nhập lại; đối tác đăng nhập lại một lần sau khi đổi host. Logic admin-api redeem SSO không đổi (X-App = app của mã).
- Kịch bản: khi người dùng SHT mở `/community` thì dùng phiên `ai_rt_contracts`, không đăng nhập lại [test: thủ công — e2e cs ở lát cr118-e2e]
- Kịch bản: khi redeem mã SSO của app `chat` bằng X-App `contracts` thì bị từ chối như cũ [test: thủ công — giữ int admin-api hiện có, không đổi (lát cr118-auth xác nhận)]

#### Yêu cầu: Phiên riêng theo app (CR-053) — Community dùng chung phiên `contracts` (nguồn: cr118-auth)
Web gộp chỉ có một phiên `X-App: contracts` (cookie `ai_rt_contracts`) cho cả SHT và Community; đổi mật khẩu bắt buộc và bước TOTP
với `X-App: contracts` cấp đúng cookie `ai_rt_contracts`. Đăng xuất xoá đúng phiên đó (phiên app khác của cùng người còn nguyên).
Logic admin-api không đổi.
- Kịch bản: khi đối tác đổi mật khẩu bắt buộc qua web gộp thì nhận cookie `ai_rt_contracts` (không `ai_rt_community`) [test: apps/admin-api/src/modules/auth/auth.unified-web.int.test.ts » đối tác lần đầu qua web gộp]
- Kịch bản: khi đăng xuất web gộp thì refresh `contracts` bị từ chối, phiên `chat` vẫn refresh được [test: apps/admin-api/src/modules/auth/auth.unified-web.int.test.ts » đăng xuất xoá một phiên]
- Kịch bản: khi redeem mã SSO bằng `tenant_key` của công ty khác thì bị từ chối [test: apps/admin-api/src/modules/auth/auth.unified-web.int.test.ts » chéo tenant]
