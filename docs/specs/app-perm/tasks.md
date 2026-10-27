# app-perm — công ty chỉ dùng Sổ Hợp Tác (demo khách)

Làn: **đầy đủ** (quyền + migration dữ liệu khách). Nhánh `slice/app-perm`. Migration `0024_chat_app_feature` (journal `when` 1794223200000).

## Mục tiêu
Một công ty có thể bị giới hạn để switcher CHỈ có "Sổ Hợp Tác" (không Chat AI, không "Trang chủ AI System"; Quản trị giữ luật cũ
`audience=admin`), đăng nhập ở AI System hạ cánh thẳng Sổ Hợp Tác. Công ty hiện có thấy y như hôm nay.

## Plan (đã làm)
- [x] Feature `chat-app` ("Chat AI"), `app_catalog.chat.required_feature = 'chat-app'` (migration + seed `DEFAULT_APPS`).
- [x] Luật: `chat-app` là feature **theo công ty** (`TENANT_APP_FEATURES` trong `app-catalog.rules.ts`): đủ khi tenant có
      entitlement còn hiệu lực (feature không `off`), KHÔNG cần grant nhóm/user. Feature chưa tồn tại ⇒ coi như mở.
- [x] Migration 0024: tạo feature (chỉ khi DB đã có tenant), entitlement cho MỌI tenant đang có, trigger `tenants_chat_app`
      (tenant mới tự có) + `features_chat_app` (feature tạo sau ⇒ cấp mọi tenant, tránh cắt Chat của tất cả).
- [x] `GET /me/portal` thêm `chat: boolean`; `default_app.effective` khi không dùng được Chat AI và chưa đặt ⇒ app đầu tiên mở được.
- [x] Switcher (`web-kit` `showsHome`): ẩn "Trang chủ AI System" khi chỉ một app hoặc không có Chat AI.
- [x] chat-web: `/` (kể cả `?home=1`) và mọi route `_authed` (`/c/*`, `/chat`…) ⇒ người không dùng được Chat AI được chuyển
      phiên sang app mặc định / app đầu tiên (Sổ Hợp Tác), không báo lỗi.
- [x] Test: unit `app-catalog.chat-gate.test.ts`, `web-kit/app-catalog/app-perm.test.ts`; int `app-perm.int.test.ts`
      (chạy lại file migration trên DB có tenant; thu hồi acme không ảnh hưởng globex; tenant mới có entitlement).
- [x] e2e (viết, chưa chạy): `e2e/deployed/14-app-perm-demo.deployed.ts` (env `DEMO_SHT_TENANT`, `DEMO_SHT_USER`, `DEMO_PW`).

## Quyết định trong lúc làm
- Không cấp theo group/user: user không thuộc nhóm nào (phổ biến) sẽ mất Chat ⇒ chọn entitlement công ty — đảm bảo không ai mất Chat.
- Feature chỉ tạo khi đã có tenant: DB test/template trống giữ nguyên ⇒ test cũ không đổi; `seed.ts` không đổi (test đếm 1 feature).
- `chat` trên portal tính theo quyền, bỏ qua URL/bật catalog (dev/test URL rỗng vẫn chat như cũ).
- Không cần đặt `default_app` cho demo: không có Chat AI ⇒ hạ cánh app đầu tiên mở được (Sổ Hợp Tác xếp trước Quản trị).

## Dựng công ty demo (platform_admin, Quản trị)
1. **Tenants › Tạo công ty** (vd mã `demo-sht`) — công ty mới tự có Chat AI (trigger).
2. **Tenants › <công ty> › Gói**: bật gói **Sổ Hợp Tác** (cấp `contracts-read`… + nhóm `contracts-owner/editor/viewer`).
3. **Features › Chat AI (`chat-app`) › tab Công ty** › **Thu hồi** công ty `demo-sht`.
4. **Users** (trong công ty demo): tạo tài khoản member, thêm vào nhóm `contracts-editor` (hoặc owner/viewer) để có Sổ Hợp Tác.
   Tenant admin của công ty demo vẫn thấy thêm Quản trị (luật cũ, không đổi).
5. (Tuỳ chọn) app mặc định: không cần — đăng nhập ai.* tự vào Sổ Hợp Tác. Muốn đặt rõ: TRƯỚC bước 3, tenant admin vào
   trang chủ AI System › "App mặc định cho công ty" chọn Sổ Hợp Tác (`PUT /me/tenant-default-app`); hoặc SQL
   `update admin.tenants set default_app = 'contracts' where key = 'demo-sht'`. Admin-web chưa có ô sửa `default_app` cho tenant.
6. Bật lại Chat AI: Features › `chat-app` › Cấp lại cho công ty.

## Còn lại / rủi ro
- ~~Chặn chỉ ở UI/điều hướng~~ — đã chặn ở hub-api: lát `chat-api-gate` (403 `CHAT_APP_DISABLED`, xem `docs/specs/chat-api-gate/tasks.md`).
- chat-web `_authed` gọi thêm `GET /auth/me/portal` một lần mỗi tab (đã cache theo user).
- Không có app nào mở được (vd member chưa vào nhóm Sổ Hợp Tác) ⇒ vẫn hiện trang chủ (trống).
- e2e chưa chạy (chạy cuối đợt).
