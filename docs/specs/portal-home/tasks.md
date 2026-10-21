# portal-home — trang chủ AI System sau đăng nhập (Luật 0b; làn: nhanh, phần quyền/DB nhỏ có int)

## Quyết định
- Trang chủ nằm trên origin chat-web: `/` = portal, Chat AI = `/chat` (redirect `/c/new`; mọi `/c/*` giữ nguyên). Login + SSO không đổi; mặc định sau login = `/` (trừ `next` rõ ràng hoặc app mặc định).
- Thẻ app từ `GET /me/apps`; mở bằng SSO handoff (`handOffUrl`), Chat AI cùng origin mở thẳng. `entryUrl/entryNext`: chat → `<url>/chat`, `next=/chat`.
- Con số (fail-soft, mỗi nguồn một query, không retry): Sổ Hợp Tác = `GET /pack/contracts/my-work/todo` (Cần xử lý + mục `contract_expiring` ≤ 30 ngày; đúng quyền người gọi, chat-web đã proxy `/pack`); Chat AI = 3 hội thoại gần nhất; Quản trị = người dùng mới 7 ngày từ `GET /auth/me/portal` (khối `admin` chỉ tenant_admin/platform_admin). "Feedback chờ xử lý" CHƯA có (bảng feedback thuộc lát feedback-original) — thêm vào `adminNumbers` khi có.
- "Hỏi AI": `/c/new?q=` điền sẵn ô nhập (không tự gửi).
- App mặc định: cột `admin.users.default_app` + `admin.tenants.default_app` (migration 0018, when 1793664000000; RLS/GRANT sẵn có). `PUT /auth/me/default-app` (chỉ dòng của chính mình, app phải mở được), `PUT /auth/me/tenant-default-app` (tenant_admin/platform_admin, tenant của chính mình), `GET /auth/me/portal` → `{default_app:{user,tenant,effective}, admin}`. effective = user ?? tenant, chỉ khi app còn mở được. `/` gọi portal; effective = chat → `/c/new`; app khác → SSO handoff; lỗi → trang chủ; `?home=1` luôn trang chủ.
- Switcher dùng chung: mục đầu "Trang chủ AI System" (key ảo `portal`, link `<chat>/?home=1`, qua SSO khi ở app khác) cho cả 4 web; `handOff(app, next)` nhận `next`.
- i18n: `portal.*` trong `chat/{vi,en}.json`; mobile: lưới 1 cột < sm.

## Test
unit: `web-kit/app-catalog/portal.test.ts` (landing, số thẻ, recent, entryUrl), `admin-api/.../portal.rules.test.ts`; int: `portal.int.test.ts` (tự đặt, công ty chỉ tenant admin, cô lập tenant). e2e deployed 01/04 + `e2e/chat/_support.ts login` đã sửa, CHƯA chạy.

## Việc còn lại
- Server: deploy admin-api (migration 0018 tự chạy) + chat-web (không đổi nginx: `/auth` và `/pack` đã proxy). Không cần cấu hình thêm.
- e2e/UAT cuối đợt: chạy 01/04 deployed; các e2e local khác dùng `login()` của `e2e/chat/_support.ts` (đã vào `/c/new` sau trang chủ).