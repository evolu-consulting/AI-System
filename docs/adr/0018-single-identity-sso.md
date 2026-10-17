# ADR-0018 · Một nguồn định danh cho mọi gói, SSO theo tenant

Trạng thái: **Proposed** · Ngày: 2026-10-17

## Bối cảnh
mgmt-app tự đăng nhập (session cookie, scrypt, Google sign-in) và tự quản tổ chức (owner/editor/viewer, chuỗi quản lý). AI-System có admin-api phát JWT EdDSA, tenant, group, TOTP. Hai nơi quản người dùng sẽ lệch nhau.

## Quyết định
1. admin-api là nguồn đăng nhập duy nhất (JWT EdDSA, JWKS). mgmt-app bỏ bảng người dùng và session riêng, kiểm JWT bằng JWKS đã cache.
2. Tổ chức của mgmt-app → tenant; owner/editor/viewer → group; chuỗi quản lý giữ trong gói như dữ liệu nghiệp vụ.
3. SSO OIDC theo tenant (Google Workspace, Microsoft Entra) ở GĐ2. MFA bắt buộc cho admin.
4. Hub cấp token ngắn hạn theo người dùng và tenant cho tool MCP của gói (thay phiên 15 phút của `assistant/mcp_server.py`).

## Hệ quả
- Được: một nơi tắt quyền; khách lớn dùng tài khoản công ty.
- Mất: chuyển người dùng mgmt-app sang admin-api; giữ đăng nhập cũ song song một thời gian.
- Tiêu chí chấp nhận: đăng nhập một lần dùng mọi gói; tắt tài khoản ở IdP thì mất quyền trong 5 phút.
