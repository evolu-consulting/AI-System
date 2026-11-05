---
id: CR-119
requirements: UW-DEP-04..06
design: ../../adr/0034-web-hop-nhat.md
trạng thái: Đang làm (chưa push/deploy); 2026-11-05: bỏ host sohoptac, không còn cờ S2_APP_HOST_LIVE
---
# CR-119 · Chuẩn tên miền: host trung tính `app.<d>` + đường dẫn theo app

## 1. Vì sao
Sau CR-118 web gộp phục vụ cả Sổ Hợp Tác (SHT) và Community nhưng vẫn mang tên `sohoptac.<d>` — gây hiểu nhầm với người dùng Community/đối tác. Chuẩn mới:
**một host vỏ trung tính cho web gộp + đường dẫn theo app**: `app.<d>` (test: `app-test.<d>`); SHT ở gốc (`/`, `/overview`…), Community ở `/community`.
Admin (`ai-admin`), Chat (`ai`), Hub/Studio (`ai-hub`) giữ nguyên. Đường dẫn không đổi ⇒ web, SPA, cookie `Path=/auth`, link thông báo không phải sửa logic.

## 2. Hành vi
| Mục | Mô tả |
|---|---|
| UW-DEP-04 host duy nhất | Edge có `app`/`app-test` phục vụ web gộp (nginx `web:8081`). `sohoptac[-test].<d>` **không còn** server_name/301 (quyết định 2026-11-05). |
| UW-DEP-05 community bỏ | `community[-test].<d>` **bỏ hẳn** (không 301, không `server_name`, không cổng 8085/18435, không proxy 30 ngày); Community chỉ ở `app[-test].<d>/community`. Không còn cờ `S2_APP_HOST_LIVE`. DNS + cert của `sohoptac*`/`community*` gỡ sau deploy (người dùng). |
| UW-DEP-06 URL/CORS/catalog | `gen-env.sh`: `S2_PUBLIC_CONTRACTS_URL`/`COMMUNITY_WEB_URL`/`APP_URL_*`/`OPS_PUBLIC_URLS` = `app[-test].<d>` vô điều kiện; `CORS_ORIGINS`/`HUB_CORS_ORIGINS` gồm `app*`, `ai*` + localhost (không còn `sohoptac*`/`community*`); khoá `S2_APP_HOST_LIVE` cũ trong `.env` bị xoá. `s2-app-urls.ts --base-domain <d> --hosts prod\|test` đặt catalog `contracts`=`https://app.<d>`, `community`=`https://app.<d>/community` vô điều kiện (idempotent, thay cả hàng còn `sohoptac*`/`community*`/localhost). Link "mở app" của admin-web/chat-web/studio đọc catalog (`/me/apps`). |

## 2b. Quyết định 2026-11-05: bỏ host sohoptac và community
**2026-11-05: bỏ host sohoptac và community, DNS + cert gỡ sau deploy.** Người dùng chốt: `sohoptac.<d>`/`sohoptac-test.<d>` và `community[-test].<d>` không còn dùng; web gộp chỉ ở `app.<d>`/`app-test.<d>`. Kéo theo: (1) đổi tên app/package `apps/sohoptac-web` → `apps/workspace-web` (`@ai/workspace-web`; job e2e `sohoptac-web-stack` → `workspace-web-stack`); tên hiển thị sản phẩm "Sổ Hợp Tác" giữ nguyên; (2) kit deploy: bỏ `sohoptac*` và `community*` khỏi edge-lib/edge conf/gen-env/enable-domain/cutover/CORS/URL công khai/nginx `web` (cổng 8085), bỏ cờ `S2_APP_HOST_LIVE` và `deploy.ps1 -AppHostLive`; (3) tên thư mục `deploy/prod-sohoptac2`, project Docker `sohoptac2`, volume, `~/workspace/sohoptac2` **giữ nguyên**.

## 3. Chuyển đổi
Runbook: deploy/prod-sohoptac2/README.md mục "Deploy CR-119". Tóm tắt: A tạo DNS pp/pp-test + mở rộng cert; B deploy kit, cutover.sh, s2-app-urls.ts --apply. Rollback = deploy lại ref trước CR-119 + đặt tay 2 hàng catalog (301 max-age=86400).
Phần 2 (đưa SHT về tiền tố `/contracts`, mọi app đối xứng) xem §5; `app.<d>/` thành trang chọn app vẫn là CR riêng.

## 4. Không làm
Không đổi đường dẫn SPA, không đổi cổng/compose, không đổi mã app, không migration; DNS/cert do người dùng làm.

## 5. Phần 2 (2026-11-05): Sổ Hợp Tác dưới tiền tố `/contracts`
**Chuẩn:** mọi app của web gộp ở `app.<d>/<app-key>/…`, `app-key` = khoá catalog (`contracts`, `community`; app mới chỉ khai khoá). `/` = đăng nhập / chuyển về home của app mặc định; `/login`, `/sso`, `/privacy`, `/terms` ngoài mọi app.

| Mục | Mô tả |
|---|---|
| UW-DEP-07 bảng route | `/overview` → `/contracts` (Tổng quan, home) · danh sách `/contracts` → `/contracts/list` · `/contracts/:id` → `/contracts/c/:id` (+ con; `new` → `/contracts/c/new`) · `/partners*` → `/contracts/partners*` · `/products*` → `/contracts/products*` · `/notifications` (trang) → `/contracts/notifications` · `/settings*` → `/contracts/settings*` · `/feedback` → `/contracts/feedback`. Community giữ `/community`. Tuyến đã gộp trước đó (`/my-work`, `/prices`, `/sourcing`, `/cks*`, `/transactions*`, `/settings/scoring`) chuyển thẳng tới đích cuối dưới `/contracts`. |
| UW-DEP-08 URL cũ còn chạy | Một bảng `shared/kernel/legacy-routes.ts` + root `beforeLoad` chuyển hướng phía client (giữ `?query#hash`), cũng áp cho `?next=` (`safeNext`/`landing`) ⇒ bookmark, email duyệt, thông báo đã lưu vẫn mở đúng trang. Mơ hồ duy nhất: `/contracts` TRẦN (không query/hash) trước là danh sách, nay là Tổng quan (đứng yên); có query/hash ⇒ `/contracts/list`. `/contracts/<id>` cũ ⇒ `/contracts/c/<id>`. |
| UW-DEP-09 tổng quát theo khoá | manifest module có `basePath = /${key}`; nav, `homeFor`, `moduleOf/canOpen`, `landing`, `safeNext` suy từ khoá (đường lạ ⇒ khoá lạ ⇒ không mở được, fail-closed). Home SHT = `/contracts`, Community = `/community`. |
| UW-DEP-10 link do server dựng | hub: chuông/email/Cần xử lý (hạn HĐ, ký số, giao nhắc, nhắc theo dõi), `recordLink` của trợ lý ⇒ `/contracts/c/<id>`, `/contracts/partners?party=…`, `/contracts`. `return_url` ký số nhận cả `/contracts/c/<id>` lẫn dạng cũ. Catalog `contracts` = `https://app[-test].<d>/contracts` (`s2-app-urls.ts` đổi cả hàng còn là gốc `app[-test].<d>`); `APP_URL_CONTRACTS`/`PUBLIC_CONTRACTS_WEB_URL` = `<gốc>/contracts`; `CONTRACTS_WEB_URL` (link "Mở SHT" của Community), `HUB_NOTIFY_BASE_URL`, CORS, `OPS_PUBLIC_URLS` vẫn là gốc host (đường dẫn nối sau). |
| UW-DEP-11 proxy/nginx | `/contracts/*` là route SPA, KHÔNG phải API (API hợp đồng = `/pack/contracts/*`): proxy dev rsbuild và nginx `web:8081` không có khoá/location nào khớp `/contracts/*` ⇒ rơi vào `try_files … /index.html`. `/notifications` vẫn vừa API vừa route SPA cũ (GET html ⇒ index.html ⇒ legacy → `/contracts/notifications`). Test chặn va chạm. |

Không đổi: API, cổng, DB, migration, cookie `Path=/auth`, ngân sách bundle. Rollback: deploy lại ref trước + đặt tay catalog `contracts` = gốc host.