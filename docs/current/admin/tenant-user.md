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


## Delta gộp 2026-11-09 (đợt cr125-wave)
Mục dưới thắng nội dung cũ cùng chủ đề ở trên (lát: auth-refresh-reload, cr121-c3c-tenants-list, cr121-q1-app-filter-contract-label, tool-tenant-purge).

#### Yêu cầu: Refresh token xoay vòng có ân hạn 30 s (không đăng xuất khi tải lại trang) (nguồn: auth-refresh-reload)
Dùng lại refresh token vừa xoay trong ≤ 30 s (phản hồi mang cookie mới bị mất khi tải lại trang, hoặc hai tab refresh song song) được cấp một token thay thế (200); chuỗi luôn chỉ có MỘT token sống: lá kế nhiệm chưa dùng bị thu hồi và thay bằng lá mới. Nếu lá kế nhiệm đã được dùng, hoặc quá 30 s, hoặc token bị thu hồi vì lý do khác ⇒ 401 và thu hồi cả chuỗi (phát hiện đánh cắp). Chuỗi đã đăng xuất/khoá thì không được cấp lại. Đăng xuất thu hồi cả chuỗi.
- Kịch bản: khi dùng lại token đã xoay trong 30 s thì 200 và chỉ còn một token sống [test: apps/admin-api/src/modules/auth/auth.service.int.test.ts » ADM-FR-02 · xoay: dùng lại token cũ ≤ 30 s → 200 và chỉ còn MỘT lá sống, lá chưa dùng bị thay, sau đó lá mới vẫn xoay được]
- Kịch bản: khi dùng lại token đã xoay quá 30 s thì 401 và thu hồi cả chuỗi [test: tests/acceptance/M1/auth-refresh.int.test.ts » ADM-FR-02 · M1-AC04 · reuse (> 30 s) → 401 INVALID_REFRESH_TOKEN, thu hồi cả chuỗi, token mới cũng chết, cookie bị xoá]
- Kịch bản: khi kẻ trộm phát lại token cũ trong 30 s thì lá của chủ bị thu hồi và chủ trình lá bị thay làm thu hồi cả chuỗi [test: tests/acceptance/M1/auth-refresh.int.test.ts » ADM-FR-02 · M1-R07 · kẻ trộm phát lại token cũ ≤ 30 s → lá của chủ bị thu hồi, chỉ một lá sống, chủ trình lá bị thay → thu hồi cả chuỗi]
- Kịch bản: khi chủ đã dùng lá kế nhiệm rồi bản sao token cũ phát lại thì thu hồi cả chuỗi [test: tests/acceptance/M1/auth-refresh.int.test.ts » ADM-FR-02 · M1-R07 · chủ đã dùng lá kế nhiệm rồi bản sao token cũ phát lại ≤ 30 s → 401, thu hồi cả chuỗi, lá của chủ cũng chết]
- Kịch bản: khi nhiều refresh song song cùng cookie thì tất cả thành công và chỉ còn đúng một token sống [test: tests/acceptance/M1/auth-refresh.int.test.ts » ADM-FR-02 · M1-R07 · 5 refresh song song cùng cookie → cả 5×200 và cuối cùng đúng MỘT lá sống, không ai bị thu hồi chuỗi]
- Kịch bản: khi đã đăng xuất thì token cũ trong ân hạn không được cấp lại [test: tests/acceptance/M1/auth-refresh.int.test.ts » ADM-FR-02 · M1-R07 · đã đăng xuất thì token cũ trong ân hạn KHÔNG được cấp lại (không sống lại phiên)]
- Kịch bản: khi reuse ở tenant A thì chuỗi tenant B không bị đụng và token B chỉ cấp phiên B [test: apps/admin-api/src/modules/auth/auth.service.int.test.ts » ADM-FR-02 · cô lập tenant: reuse ở tenant A không đụng chuỗi tenant B, token B trong ân hạn chỉ cấp phiên B, B bị khoá → 401]
- Kịch bản: khi tải lại trang lúc phản hồi refresh bị huỷ thì lần tải sau vẫn đăng nhập [test: e2e/journey-approval/refresh-reload.ja.ts » 1 · phản hồi refresh bị huỷ lúc tải lại ⇒ lần tải sau vẫn đăng nhập (token cũ được cấp lại trong ân hạn)]

#### Yêu cầu: Danh sách Công ty theo khuôn danh sách chung (nguồn: cr121-c3c-tenants-list)
Trang `/tenants` có tiêu đề + số đếm, nút "Thêm công ty", phễu lọc chỉ icon (Trạng thái) với chip có nút xoá và dòng "n / tổng"; bấm hàng mở ngăn tóm tắt (mã, số người dùng, ứng dụng đang bật, trạng thái) có liên kết "Mở trang chi tiết" tới tab Hồ sơ.
- Kịch bản: khi chọn Đã khoá trong phễu thì hiện chip "Trạng thái: Đã khoá" và "n / tổng" giảm; bỏ chip thì đủ lại [test: e2e/cr121-tenants-list.spec.ts » CR-121 · /tenants phễu lọc Đã khoá cho chip và n / tổng, bỏ chip thì đủ lại]
- Kịch bản: khi bấm hàng acme thì mở ngăn tóm tắt và "Mở trang chi tiết" dẫn tới tab Hồ sơ [test: e2e/cr121-tenants-list.spec.ts » CR-121 · /tenants bấm hàng acme mở ngăn tóm tắt và Mở trang chi tiết tới tab Hồ sơ]

#### Yêu cầu: Lọc danh sách Công ty theo Ứng dụng (nguồn: cr121-q1-app-filter-contract-label)
Phễu lọc của `/tenants` có nhóm "Ứng dụng" (Chat AI, Cộng đồng, Sổ Hợp Tác, Tri thức); mỗi hàng hiện các ứng dụng đang bật bằng nhãn nghiệp vụ. API `GET /admin/tenants?app=` lọc bằng entitlement còn hiệu lực và trả `apps` trong cùng câu SQL.
- Kịch bản: khi lọc Sổ Hợp Tác thì chỉ còn công ty đang bật ứng dụng đó, bỏ chip thì đủ lại [test: e2e/cr121-tenants-list.spec.ts » CR-121 · /tenants lọc Ứng dụng Sổ Hợp Tác chỉ còn công ty đang bật, cột Ứng dụng hiện nhãn nghiệp vụ]
- Kịch bản: khi gọi API với `app=contracts` thì bỏ qua entitlement đã thu hồi và feature ẩn, `apps` mỗi hàng đã khử trùng [test: apps/admin-api/src/modules/tenants/tenants.list-app.int.test.ts]

#### Yêu cầu: Xoá sạch tenant bằng công cụ vận hành (nguồn: tool-tenant-purge)
Người vận hành xoá toàn bộ dữ liệu của một tenant (mọi bảng có tenant_id ở mọi schema, bảng allowlist, hàng tenant, file FileBox)
bằng `tenant-purge.ts`; mặc định chạy thử, `--apply` cần `--confirm` đúng tên; tenant platform và bảng lạ chưa khai bị từ chối;
một transaction, cache bỏ tenant qua bump + NOTIFY, audit platform ghi người/lúc/tenant/số hàng.
- Kịch bản: khi chạy không có --apply thì in số hàng theo bảng và không xoá gì [test: tools/scripts/src/tenant-purge.int.test.ts » chạy thử: in số hàng theo bảng, không xoá gì (DB + FileBox)]
- Kịch bản: khi chọn tenant platform hoặc --confirm sai thì từ chối [test: tools/scripts/src/tenant-purge.int.test.ts » từ chối tenant platform và --confirm sai]
- Kịch bản: khi có bảng lạ tham chiếu dữ liệu tenant chưa khai thì kế hoạch FAIL [test: tools/scripts/src/tenant-purge.int.test.ts » bảng lạ tham chiếu dữ liệu tenant (FK hoặc cột *tenant*) ⇒ kế hoạch FAIL]
- Kịch bản: khi --apply thì tenant còn 0 hàng ở mọi bảng tenant_id, tenant khác y nguyên, có audit platform, file FileBox bị xoá [test: tools/scripts/src/tenant-purge.int.test.ts » --apply: A còn 0 hàng ở mọi bảng tenant_id, B y nguyên, audit platform + config_version tăng, FileBox của A bị xoá]
- Kịch bản: khi chạy lại sau khi tenant đã mất thì chỉ dọn FileBox, không lỗi [test: tools/scripts/src/tenant-purge.int.test.ts » chạy lại khi tenant đã mất ⇒ chỉ dọn FileBox (idempotent), không lỗi]
- Kịch bản: khi tên trùng nhiều tenant thì từ chối [test: tools/scripts/src/tenant-purge.rules.test.ts » tên trùng hoặc tenant platform (key/platform_admin) ⇒ từ chối]
