---
id: cr118-community-module
lát: cr118-community-module
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: move (git mv contracts-web → sohoptac-web, song song), react19
---
## Plan (ngắn)
Dời `apps/community-web/src` TẠI CHỖ sang hình module đích để lát `shell` chỉ cần `git mv` một thư mục:
`src/modules/community/{domain,application,adapters,ui,i18n,manifest.ts}` + vỏ mỏng tạm `src/app` (App, hash-router, globals.css).

## Làm
- domain (thuần): `lib/*` trừ login/contracts-link/sidebar-state; thêm `route.ts` (Route, `routeToPath`, `parsePath`, `/community/*`) và `legacy-hash.ts` (`mapLegacyHash`).
- application: ctx (AppProvider nhận `RouterPort`), use-dock, useFeed, login, contracts-link, sidebar-state, `ports.ts` (CommunityApi + RouterPort), `runtime.ts` (mặt tiền cho ui: phiên/chế độ API, ui không import adapters).
- adapters: http/mock/seed/session/auth/dock (đứng sau cổng `CommunityApi`).
- ui: toàn bộ component/trang; `entry.tsx` = điểm vào tải lười cho manifest.
- `manifest.ts`: dữ liệu route dưới `/community/*` + `createCommunityRoutes(host)` tương thích TanStack (host truyền `createRoute`, `lazy`, route cha; không khởi tạo router) + `validateCommunitySearch` (`?settings=1`).
- CSS: mọi quy tắc nằm dưới `[data-mod="community"]` (postcss một lần, nội dung mockup.css giữ nguyên, `body` về `app/globals.css`); biến đổi tên `--cm-*` (accent, buy, note, good, line, shadow, surface-2, ink-3, feed-bg) — hết đụng `--accent` của contracts; `data-accent` đặt trên wrapper `[data-mod]` (không còn trên `<html>`).
- Dọn: bỏ `resetDock`, `IconBook` (không dùng); `api/client.ts` thành `application/ports.ts`.

## Không làm / Chạm
- Không đụng `apps/contracts-web`, deploy-kit, luật depcruise 1–6 (lát `move`), router thật/FeatureGate (lát `shell`).
- Vỏ mỏng tạm GIỮ URL hash (`#/feed`…) để e2e community-web khóa không đổi: `hash-router.ts` đọc hash qua `mapLegacyHash → parsePath` và hiện thực `RouterPort`. Lát `shell` thay bằng router `/community/*`.
- e2e: chỉ sửa đường dẫn import `seed` trong `e2e/community-web/shell.cm.ts` + relock.

## Test tối thiểu
- unit: `domain/legacy-hash.test.ts`, `domain/route.test.ts`, `manifest.test.ts`; test cũ giữ nguyên (cập nhật import, `nav.test` bỏ phần hash).
- `bun run typecheck`, `bun run build`, `check:bundle` của community-web; e2e community-web một lần trên evotest.

## Quyết định trong lúc làm
- Feed = `/community` (theo spec CR-118 §2; `/community/feed` đọc được như bí danh qua `parsePath`).
- `i18n` để thư mục `modules/community/i18n/` (còn 3 test), không gộp thành `i18n.ts`.
- CSS dùng tiền tố chọn lọc (không CSS nesting) để không phụ thuộc hạ cấp nesting của bộ build.

## Việc còn lại
- Lát shell: `git mv apps/community-web/src/modules/community → apps/sohoptac-web/src/modules/community`, gắn `createCommunityRoutes`, bỏ `app/` + hash-router, thêm `data-mod` wrapper ở shell nếu cần, đổi e2e sang URL `/community/*`.
- Luật depcruise 1–6 áp lên module (lát move); `ui/styles` ngân sách CSS ≤ 15 KB gz (hiện cả app ~9.7 KB gz).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-04 (đợt cr118-r1)

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: COM-FR-31 Routing feed/profile theo đường dẫn `/community/*` (thay hash)
Module Community khai báo route dưới `/community/*` dạng dữ liệu (manifest) và ánh xạ hash cũ bằng hàm thuần `mapLegacyHash`: `#/feed`→`/community`, `#/profile/<o>/<s>`→`/community/profile/<o>/<s>`, `#/settings`→`/community?settings=1`. Module chỉ nói chuyện với host qua cổng `RouterPort`; không đọc `location`.
- Kịch bản: khi hash cũ `#/profile/<org>/<section>` thì `mapLegacyHash` trả `/community/profile/<org>/<section>` và `parsePath` đọc lại đúng route [test: apps/community-web/src/modules/community/domain/legacy-hash.test.ts » kết quả đọc lại được bằng parsePath]
- Kịch bản: khi `#/settings` thì ra `/community?settings=1` (Bảng tin + hộp thoại Cài đặt) [test: apps/community-web/src/modules/community/domain/legacy-hash.test.ts » #/feed và #/settings ánh xạ về /community và ?settings=1]
- Kịch bản: khi dựng cây route cho router của host thì mỗi route con Community được tạo đúng một lần dưới route cha, trang tải lười [test: apps/community-web/src/modules/community/manifest.test.ts » gọi createRoute một lần mỗi route với route cha của host, một component lười dùng chung]
