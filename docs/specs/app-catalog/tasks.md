# app-catalog — danh mục app web do Admin quản lý + switcher/top shell dùng chung (Luật 0b, làn nhanh; có phần quyền/auth ⇒ int đủ)

## Quyết định
- Bảng `admin.app_catalog` (migration 0016, journal when 1793491200000): key, name vi/en, icon, url, `audience` (all/admin/platform), `required_feature` (key feature hiệu lực, vd `contracts-read`), `sso`, sort, enabled. Catalog toàn hệ thống như `features`/`commands` (không RLS tenant; ghi chỉ qua `/admin/apps` platform_admin).
- Seed 4 app (chat, contracts, studio, admin) trong migration với `url` rỗng; admin-api điền URL cho hàng còn rỗng từ `APP_URL_{CHAT,CONTRACTS,STUDIO,ADMIN}` lúc khởi động ⇒ deploy không đổi hành vi, sau đó sửa ở Admin → Ứng dụng.
- `GET /me/apps` (+ cùng handler `GET /auth/me/apps` vì mọi web đã proxy `/auth`): lọc theo vai + feature hiệu lực (dùng lại `computeEffectiveAccess`); platform_admin thấy mọi app bật có URL.
- SSO: `POST /auth/sso/code` chỉ cho app mà người gọi mở được (403 nếu không), trả `target_url` từ catalog; web nguồn chỉ dùng `target_url` (không env/query). `redeem` kiểm app còn bật + `sso` + header `Origin` (nếu có) đúng origin URL catalog. `next` vẫn qua `safeNext`.
- Web: `@ai/web-kit/ui/AppSwitcher` + `ui/TopShell` + `app-catalog/apps` (thuần) + `auth/sso.handOffUrl`. Cả 4 web dùng switcher; admin-web/studio-web dùng TopShell. Env build chỉ là dự phòng khi API lỗi (`fallbackApps`).
- contracts-web vẫn dội sang `PUBLIC_SSO_URL` khi CHƯA đăng nhập (chưa có token để gọi API) — giữ env cho nhánh này.
- Sửa test khoá: thêm `admin.app_catalog` vào danh sách bảng (M2/db-schema, ADM-NFR-06/migrate); e2e deployed/x1/studio đổi selector sang `menuitem`; `test:lock:write`.

## Việc còn lại (sau đợt)
- Server: thêm `APP_URL_*` vào env admin-api (đã có trong `deploy/prod-sohoptac2/docker-compose.yml`); sau khi lên, kiểm Admin → Ứng dụng có đủ 4 URL.
- e2e + UAT chạy một lần cuối đợt (deployed 01/04 đổi `link`→`menuitem`, chưa chạy).
