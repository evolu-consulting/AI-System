---
id: cr119-contracts-prefix
lát: cr119-contracts-prefix
cr: CR-119 (phần 2)
làn: nhanh
migration: không
phụ thuộc: cr119-drop-sohoptac, cr119-app-domain (đã trong nhánh)
---
## Plan (ngắn)
SHT dưới `/contracts` (chuẩn `app.<d>/<app-key>/…`). Spec: `docs/specs/CR-119/spec.md` §5. Cây route `_authed/contracts/{index(Tổng quan),list,c/$id,c/new,partners,products,notifications,feedback,settings/*}`;
tuyến cũ xoá file, thay bằng một bảng `shared/kernel/legacy-routes.ts` (root `beforeLoad` + `safeNext`). `basePath = /${key}` ở manifest; `platform/auth` (homeFor/moduleOf/canOpen/landing) và nav suy từ khoá.
Server: link thông báo/ký số/trợ lý mới; catalog + compose `APP_URL_CONTRACTS`. e2e: đổi URL, cùng khẳng định.

## Làm
- [x] spec §5; kernel `app-path`/`legacy-routes` + test; manifest `basePath`; nav; route file; thay chuỗi route trong features (typed Link ⇒ typecheck bắt sót)
- [x] hub-api: my-history, deadline, ký số (3 chỗ), giao nhắc (SQL), `return_url`; `s2-app-urls`; compose/dev-up; nginx + test va chạm proxy
- [x] e2e: cập nhật URL (contracts-web, workspace-web, deployed, N1, pm-checklist…), relock

## Không làm / Chạm
Không đổi API/DB; `app.<d>/` trang chọn app (CR sau); DNS/cert; không deploy. `/notifications` của inbox.repo (thông báo thử) giữ nguyên (chạy được ở mọi web nhờ legacy redirect).

## Test tối thiểu
unit: legacy-routes, login-machine, nav, manifest, chat.rules, s2-app-urls, deploy-proxy; hub-api: my-history, deadline, esign-sweep, notify; e2e chạy MỘT lần ở evotest (-Step e2e -All -Filter contracts-web,workspace-web-stack,community-web,N1,pm-checklist-pm).

## Quyết định trong lúc làm
- `/contracts/new` → `/contracts/c/new` (mọi `/contracts/<x>` cũ có đoạn đầu không phải tên trang mới ⇒ `/contracts/c/<x>`).
- `/contracts` trần = Tổng quan; bộ lọc danh sách cũ (có query) vẫn vào `/contracts/list`.
- `CONTRACTS_WEB_URL`/`HUB_NOTIFY_BASE_URL` giữ là gốc host (link server luôn dạng `/contracts/...` tuyệt đối nối sau gốc); chỉ catalog + `APP_URL_CONTRACTS` có `/contracts`.
- Tuyến chuyển hướng cũ (`/my-work`, `/cks`…) bỏ file route, gộp vào bảng legacy.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED web/web-hop-nhat.md
#### Yêu cầu: UW-DEP-07..09 SHT dưới tiền tố /contracts, URL cũ còn chạy, basePath theo khoá app
Sổ Hợp Tác ở `app.<d>/contracts/…` (Tổng quan `/contracts`, danh sách `/contracts/list`, chi tiết `/contracts/c/:id`, đối tác `/contracts/partners`, sản phẩm `/contracts/products`, cài đặt `/contracts/settings/*`, thông báo `/contracts/notifications`); Community giữ `/community`. URL cũ ở gốc chuyển hướng client giữ query/hash (cả `?next=`). Home, nav, quyền mở path suy từ `basePath = /${khoá app}` của manifest.
- Kịch bản: URL SHT cũ (`/overview`, `/contracts/<id>`, `/partners?party=`, `/notifications#prefs`, `/transactions/new`) chuyển đúng sang URL mới, URL mới/Community không bị đổi, áp hai lần không đổi thêm [test: apps/workspace-web/src/shared/kernel/legacy-routes.test.ts » legacyTarget · tuyến SHT cũ ở gốc → /contracts/…]
- Kịch bản: đăng nhập với `next` cũ đáp đúng URL mới; home SHT là `/contracts`, Community `/community`; đường lạ không mở được [test: apps/workspace-web/src/platform/auth/domain/login-machine.test.ts » CR-118 · password → change → TOTP → home theo vai]
- Kịch bản: manifest contracts khai `basePath=/contracts` và mọi mục menu nằm dưới đó; Tổng quan chỉ sáng ở gốc, chi tiết thuộc mục Hợp đồng [test: apps/workspace-web/src/modules/contracts/manifest.test.ts » home và mọi mục menu nằm dưới basePath]
- Kịch bản: `/contracts/*` không trùng proxy dev / location nginx API [test: apps/workspace-web/scripts/deploy-proxy.test.ts » kit prod · nginx web 8081 không đụng /contracts/*]
- Kịch bản: duyệt/đăng nhập/danh sách/chi tiết trên URL mới và URL cũ chuyển hướng chạy thật [test: e2e/contracts-web/legacy-routes.cw.ts » URL cũ chuyển hướng sang /contracts/… (giữ query)]

### MODIFIED sht/phap-ly-va-can-xu-ly.md
#### Yêu cầu: Link thông báo / ký số / trợ lý trỏ URL mới
Chuông, email, Cần xử lý (hạn HĐ, ký số, giao nhắc) và `recordLink` của trợ lý dùng `/contracts/c/<id>`, `/contracts/partners?party=…`, `/contracts`; `return_url` ký số nhận `/contracts/c/<id>` (và dạng cũ).
- Kịch bản: link hạn HĐ và `recordLink` dùng đường dẫn mới [test: apps/hub-api/src/modules/packs/contracts/domain/deadline.rules.test.ts » tiêu đề/thân/link]
- Kịch bản: catalog `contracts` = `https://app[-test].<d>/contracts`, đổi cả hàng còn là gốc host [test: tools/scripts/src/s2-app-urls.test.ts » CR-119 p2: hàng contracts còn là gốc app[-test].<d> (CR-119 p1) -> thêm /contracts; idempotent; không đụng hàng khác]

## Việc còn lại
e2e toàn bộ chạy ở evotest (xem báo cáo); relock `test:lock:write`.