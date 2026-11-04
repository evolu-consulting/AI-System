---
id: cr118-auth
lát: cr118-auth
cr: CR-118
làn: đầy đủ (auth/phiên)
migration: không
phụ thuộc: cr118-move (base 389744a5)
---
## Plan (ngắn)
Một phiên `X-App: contracts` (`ai_rt_contracts`) cho web gộp; login gộp ở `platform/auth` (port + adapter, UI chỉ qua
application hook): mật khẩu → đổi mật khẩu bắt buộc → TOTP → home theo quyền (đối tác → `/community`, có SHT → `/overview`).
Guard: `/community*` cần phiên nhưng KHÔNG dội sang AI System; path SHT giữ dội như nay; đối tác vào path SHT ⇒ `/community`
(ẩn = không render, server `external-deny` là nguồn thật). `/sso` giữ cho admin/chat hand-off. Server: không đổi
(admin-api đã có `/auth/change-password` (change_token) + `/auth/totp/verify` cho mọi `X-App` — đã kiểm `auth.routes.ts`).

## Làm
- `apps/sohoptac-web/src/platform/auth/`: `domain/login-machine.ts` (thuần: bước kế, home, quyền mở path, có dội SSO),
  `domain/login-errors.ts` (lỗi → khoá i18n), `port.ts` (`AuthPort`, `AppsSource`), `adapters/admin-api.ts`,
  `session.ts` (phiên duy nhất, dời từ `features/auth/lib/session.ts` — file cũ re-export), `application/use-login-flow.ts`,
  `ui/{ChangePasswordForm,TotpForm}.tsx`, `index.ts` (cổng duy nhất).
- `features/auth`: LoginPage dùng `useLoginFlow` (3 bước); guard dùng `canOpen`/`homeFor`/`bouncesToSso`.
- `routes/community.tsx`: khung tạm có guard phiên (TODO lát cr118-community-module thay component), `routes/index.tsx` home theo quyền.
- i18n `contracts.login.*` thêm khoá bước đổi mật khẩu / TOTP.

## Không làm / Chạm
Không endpoint mới, không migration, không sửa community-web (lát community-module dời module + dùng login này: TODO trong
`platform/auth/index.ts`). Không đụng `platform/features` (lát feature-gate): nguồn quyền app qua `setAppsSource()`; chưa nối thì
suy từ `me.kind` (đối tác ⇒ chỉ community).

## Test tối thiểu
- unit `apps/sohoptac-web/src/platform/auth/domain/login-machine.test.ts`, `login-errors.test.ts`.
- int `apps/admin-api/src/modules/auth/auth.unified-web.int.test.ts` (X-App contracts: đối tác đổi mật khẩu, TOTP, đăng xuất, chéo tenant).
- e2e `e2e/sohoptac-web/auth.ss.ts` (stack thật, cấu hình `e2e/sohoptac-web/playwright.stack.config.ts`, chạy evotest một lần).

## Quyết định trong lúc làm
- Nguồn "app mở được" = port `AppsSource` (lát feature-gate nối `/pack/me.apps`); mặc định suy từ `me.kind` để không phụ thuộc lát song song.
- Đối tác gõ path SHT ⇒ redirect `/community` ở `beforeLoad` (trước khi tải chunk route) thay vì trang 403.
- `/community` tạm là khung tối thiểu (tên + Đăng xuất) để guard/e2e chạy được; lát community-module thay component.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Đăng nhập Community nằm trong web gộp
Login gộp của `sohoptac-web` (`platform/auth`) có ba bước: mật khẩu → đổi mật khẩu bắt buộc (lần đầu) → mã TOTP (khi đã bật 2FA), rồi
vào home theo quyền: đối tác → `/community`, người có Sổ Hợp Tác → `/overview` (hoặc `next` nội bộ nếu được mở). Path `/community*`
không tự dội sang AI System; path SHT giữ dội như nay. Đối tác gõ path SHT ⇒ về `/community`, không render trang SHT.
- Kịch bản: khi đối tác lần đầu đăng nhập thì buộc đổi mật khẩu rồi vào `/community` [test: e2e/sohoptac-web/auth.ss.ts » đối tác lần đầu: buộc đổi mật khẩu rồi vào /community, gõ /overview về /community]
- Kịch bản: khi trả lời đăng nhập là `totp_required` thì hiện bước nhập mã, mã đúng thì vào home theo quyền [test: apps/sohoptac-web/src/platform/auth/domain/login-machine.test.ts » password → change → TOTP → home theo vai]
- Kịch bản: khi người dùng đã bật 2FA đăng nhập web gộp thì phải nhập mã TOTP mới có phiên `contracts` [test: e2e/sohoptac-web/auth.ss.ts » TOTP: đăng nhập phải qua bước mã]
- Kịch bản: khi chưa có phiên mà mở `/community` thì vào `/login` của web gộp, không dội sang AI System [test: apps/sohoptac-web/src/platform/auth/domain/login-machine.test.ts » bouncesToSso]
- Kịch bản: khi thành viên SHT đăng nhập thì vào `/overview` [test: e2e/sohoptac-web/auth.ss.ts » thành viên SHT: đăng nhập vào /overview, đăng xuất xoá phiên]

### MODIFIED admin/tenant-user.md
#### Yêu cầu: Phiên riêng theo app (CR-053) — Community dùng chung phiên `contracts`
Web gộp chỉ có một phiên `X-App: contracts` (cookie `ai_rt_contracts`) cho cả SHT và Community; đổi mật khẩu bắt buộc và bước TOTP
với `X-App: contracts` cấp đúng cookie `ai_rt_contracts`. Đăng xuất xoá đúng phiên đó (phiên app khác của cùng người còn nguyên).
Logic admin-api không đổi.
- Kịch bản: khi đối tác đổi mật khẩu bắt buộc qua web gộp thì nhận cookie `ai_rt_contracts` (không `ai_rt_community`) [test: apps/admin-api/src/modules/auth/auth.unified-web.int.test.ts » đối tác lần đầu qua web gộp]
- Kịch bản: khi đăng xuất web gộp thì refresh `contracts` bị từ chối, phiên `chat` vẫn refresh được [test: apps/admin-api/src/modules/auth/auth.unified-web.int.test.ts » đăng xuất xoá một phiên]
- Kịch bản: khi redeem mã SSO bằng `tenant_key` của công ty khác thì bị từ chối [test: apps/admin-api/src/modules/auth/auth.unified-web.int.test.ts » chéo tenant]

## Việc còn lại
- Lát feature-gate: gọi `setAppsSource()` (platform/auth) bằng `apps` của `/pack/me`.
- Lát community-module: thay component `routes/community.tsx`; dùng `useLoginFlow`/`ChangePasswordForm`/`TotpForm` thay `community-web/src/ui/Login.tsx`.
