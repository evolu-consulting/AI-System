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
