---
id: cr118-shell
lát: cr118-shell
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: community-module (merged), move, capabilities (GET /pack/me)
---
## Plan (ngắn)
`git mv` module Community vào `apps/sohoptac-web/src/modules/community`; shell đọc manifest (contracts + community), gắn cây route Community vào router TanStack có sẵn bằng `createCommunityRoutes` (lazy, chunk `community`), nav hai chiều theo quyền (`/pack/me`), i18n gộp một instance, CSS Community scoped, depcruise 1–5 nâng lên error.

## Làm
- Module: bỏ phiên/đăng nhập riêng (Login, session, auth, contracts-link, login.css); host cấp `CommunityHost{router, logout, openContracts, contractsHref}` qua `manifest.configureCommunityHost`; `RouterPort` dựng bằng `createRouterPort(LowRouter)` trên router TanStack; manifest: route khung `/community` (component lười, giữ trạng thái) + 4 route con; `legacyRedirect` (hash cũ `/community#/…` → URL chuẩn).
- i18n: module không tự init, chỉ `addResourceBundle` vào i18next chung (VI tĩnh, EN động); test `app/i18n-merge.test.ts` (hai gốc riêng, không trùng khoá). Thêm `contracts.nav.community`.
- platform/features: dùng FeatureGate đã merge (`useFeature("community")` cho mục nav, `useFeature("contracts")` cho cài đặt SHT); bỏ adapter caps riêng.
- shell: `routes/community.tsx` (guard platform/auth) + `shell/CommunityRoute.tsx`, `shell/community-host.ts`, `shell/ContractsSettingsHost.tsx`; Sidebar contracts có mục Community khi `useFeature("community")`.
- Build: `__COMMUNITY_MOCK__` define (PUBLIC_COMMUNITY_API=mock); `check:bundle` thêm ngân sách chunk `community` (JS ≤ 60 KB gz, CSS ≤ 15 KB gz). Hiện: JS 40 KB gz.
- depcruise: luật web-mod/shell/domain/ui/features-port = error (test file được miễn ở domain-pure); ADR-0023 `ca-*` không áp `apps/sohoptac-web` (web-* thay).
- Route `/community/*` là FILE route (`routes/community.tsx` + con rỗng `index`/`$`), component + module nạp lười để `check:bundle` xanh (161,9 KB); `createCommunityRoutes` (manifest) giữ cho router gộp mã-route, shell không dùng. Hash cũ chuyển ở chunk module (`ui/entry`).
- Xoá `apps/community-web` (vỏ mỏng không còn: module đã chuyển). e2e `community-web` (mock + stack) đổi sang build `@ai/sohoptac-web` và URL `/community/*`; relock.

## §11.1 Community UI (lát này, làn N)
- Ô đăng bản tin: nút Thu gọn (`composer-collapse`) về một dòng gợi ý, bấm lại để mở; nhớ theo người dùng trong localStorage (`community.composer.open:<userId>`, chặn/lỗi ⇒ mặc định hiện hành là thu gọn). Thuần: `application/composer-pref.ts`.
- Một nút "Đính kèm" thay Ảnh + Video: MỖI tệp tải lên `POST /pack/community/files` (raw body + `X-Filename` percent-encode → `CommunityFile{id,name,mime,size}`; server quét MIME/cỡ/loại), bài gửi `media:[{id,kind,label,fileId}]`; thẻ tệp trong bài: tên + dung lượng + "Tải về" (`GET /pack/community/files/:fileId`, kèm Bearer). Lỗi 413/415/503 báo tiếng Việt (`uploadErrorKey`). `MEDIA_LIMITS.file = 10`.
- Dialog Cài đặt: lề sidebar trái đều (token `--cm-*`, `extras.css`). Mục "Sổ Hợp Tác" nằm TRONG dialog Cài đặt Community và chỉ hiện khi `caps.contracts` + `contractsUrl` (server); bấm mở hộp thoại Cài đặt Sổ Hợp Tác dùng chung tại chỗ (`host.openContractsSettings` → bus `openSettings`, `shell/ContractsSettingsHost.tsx` chỉ dựng khi `/pack/me` bật contracts) — không đổi URL ngoài `?settings=`.

## Không làm / Chạm
- Không sửa `platform/auth` (lát cr118-auth). Chuông thông báo + dock trợ lý GỘP chưa làm: Community giữ TopBar/chuông/ChatDock riêng trong layout toàn trang `/community/*` (dock theo module đang mở); gộp một chuông 2 nguồn cần shell chung → lát sau.
- `deploy/*` (Dockerfile build `apps/community-web`, nginx 8085, edge 301) để lát deploy-kit; `scripts/dev-up.ps1` chỉ bỏ cổng 3400.

## Test tối thiểu
unit: router-port, manifest, scope CSS, i18n-merge, check-bundle community; typecheck + build sohoptac-web; e2e community-web (mock) + contracts-web một lần trên evotest.

## Quyết định trong lúc làm
- `/community` nằm dưới gốc (không dưới `_authed`: PackFrame cổng gói contracts, đối tác không có) và tự guard.
- Cây route code gắn bằng `routeTree.addChildren([...children, communityRoute])` ở `app/router.ts` (type Register không biết `/community` ⇒ Link ép `as never`).
- Phiên: dùng phiên contracts hiện có; đối tác đăng nhập qua login contracts (đổi mật khẩu bắt buộc/TOTP thuộc lát auth) ⇒ e2e stack đối tác có thể đỏ tới khi auth merge.

## Việc còn lại
- Gộp chuông + dock; cổng OpenFeature; SSE `config.changed`; deploy-kit (Dockerfile/nginx/edge); quyền `data-accent` trên shell chung nếu cần.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: COM-FR-43 Link sang Sổ Hợp Tác là link trong app, cách ly đối tác bằng route + chunk
Community chạy dưới `/community/*` của web gộp; mục Community trong sidebar Sổ Hợp Tác chỉ hiện khi `/pack/me` bật module `community`; link Sổ Hợp Tác trong Community là điều hướng nội bộ (không SSO, không đổi host). Đối tác (contracts tắt) chỉ thấy Community và trang chủ `/` đưa về `/community` (home theo quyền do platform/auth).
- Kịch bản: khi người dùng là đối tác thì đối tác vào thẳng Community và gõ đường dẫn Sổ Hợp Tác thì về `/community` [test: e2e/sohoptac-web/auth.ss.ts » đối tác lần đầu: buộc đổi mật khẩu rồi vào /community]
- Kịch bản: khi shell dựng route Community thì module chỉ nạp khi vào route (chunk riêng) [test: apps/sohoptac-web/src/modules/community/manifest.test.ts » một route khung /community (component lười) + route con tương đối, gắn vào route cha của host]
- Kịch bản: khi vào `/community#/profile/<o>/<s>` (hash cũ) thì chuyển về `/community/profile/<o>/<s>` [test: apps/sohoptac-web/src/modules/community/domain/legacy-hash.test.ts » kết quả đọc lại được bằng parsePath]

### ADDED web/web-hop-nhat.md
#### Yêu cầu: UW-FR-07..09 Một i18n, CSS không rò, luật depcruise
Hai bộ khoá `community.*` và `contracts.*` dùng chung một instance i18next, không khoá nào trùng; CSS Community nằm dưới `[data-mod="community"]` với biến `--cm-*`.
- Kịch bản: khi gộp hai bộ khoá thì mỗi bộ có gốc riêng và không khoá nào trùng [test: apps/sohoptac-web/src/app/i18n-merge.test.ts » hai bộ khoá có gốc riêng và không khoá nào trùng ở vi và en]
- Kịch bản: khi nạp CSS Community thì mọi selector bắt đầu bằng `[data-mod="community"]` [test: apps/sohoptac-web/src/modules/community/ui/styles/scope.test.ts » mọi selector có tiền tố data-mod community và biến chỉ --cm hoặc --lg]

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: COM-FR-27 Ô đăng bản tin thu gọn/mở và đính kèm gộp
Ô đăng bản tin có nút thu gọn về một dòng gợi ý và mở lại, trạng thái nhớ theo người dùng; nút Ảnh và Video gộp thành "Đính kèm" nhận nhiều tệp tải lên FileBox (server quét MIME, cỡ, loại), tệp hiện thành thẻ có Tải về.
- Kịch bản: khi người dùng thu gọn ô đăng rồi tải lại thì ô vẫn thu gọn [test: e2e/community-web/composer.cm.ts » ô đăng thu gọn và mở lại, trạng thái được nhớ sau khi tải lại]
- Kịch bản: khi chọn PDF bằng nút Đính kèm thì tệp được tải lên, đăng bài kèm thẻ tệp có tên, dung lượng và Tải về [test: e2e/community-web/composer.cm.ts » một nút Đính kèm thay Ảnh và Video: tải PDF lên, đăng bài và thấy thẻ tệp]
- Kịch bản: khi lưu trạng thái ô đăng thì storage bị chặn không gây lỗi [test: apps/sohoptac-web/src/modules/community/application/composer-pref.test.ts » storage bị chặn thì không ném lỗi]
- Kịch bản: khi tải tệp lỗi 413 415 503 thì báo đúng thông điệp tiếng Việt [test: apps/sohoptac-web/src/modules/community/domain/media.test.ts » 413 415 503 có khoá riêng, còn lại là lỗi chung]

#### Yêu cầu: COM-FR-41 Mục Sổ Hợp Tác nằm trong dialog Cài đặt Community
Mục Sổ Hợp Tác hiển thị ngay trong dialog Cài đặt Community, chỉ khi module contracts bật và người dùng có quyền; mở mục không đổi URL ngoài `?settings=`.
- Kịch bản: khi Admin chủ quản mở Cài đặt thì có nhóm Sổ Hợp Tác và chọn từng mục không đổi đường dẫn [test: e2e/community-web/settings.cm.ts » Admin: mục Sổ Hợp Tác nằm trong dialog Cài đặt, không đổi URL ngoài ?settings=]
- Kịch bản: khi người dùng là đối tác thì không có nhóm Sổ Hợp Tác trong DOM [test: e2e/community-web/settings.cm.ts » đối tác: chỉ nhóm Cá nhân, không có Sổ Hợp Tác / Công ty trong DOM]
