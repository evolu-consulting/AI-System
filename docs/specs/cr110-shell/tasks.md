---
id: cr110-shell
lát: cr110-shell
cr: CR-110
fr: [COM-FR-27, COM-FR-28, COM-FR-29, COM-FR-30, COM-FR-31, COM-FR-43]
làn: nhanh
migration: không
phụ thuộc: cr110-i18n, cr110-ports
---
## Plan (ngắn)
Lớp vỏ community-web: Topbar brand công ty chủ quản (`GET /brand`), Sidebar cố định ở Shell (Community + nhóm Sổ Hợp Tác xổ/gập),
user-menu từ avatar, hộp thoại Cài đặt (không còn route `settings`), drawer ≤ 900 px. Nhóm Sổ Hợp Tác sinh từ `buildNav` (lib/nav.ts)
chỉ khi `viewer.caps.contracts` + `contractsUrl` ⇒ đối tác/thiếu quyền: không có trong DOM (không CSS ẩn).

## Làm
- [x] `lib/{route,nav,brand,sidebar-state,contracts-link}.ts` (logic thuần) + `nav.test.ts`, `brand.test.ts`
- [x] `ui/{Shell,Sidebar,UserMenu,NotifPop,SettingsDialog}.tsx`, `TopBar.tsx` viết lại, `ctx.tsx` (brand, settingsOpen, parseLocation), `styles/shell.css`
- [x] API: `getBrand()` (client/http/mock); i18n `community.nav.*`, `topbar.{account,menuProfile,menuSettings}`, `settings.close`
- [x] `Profile.tsx`: bỏ thanh bên cũ (đã sang Shell); route hồ sơ giữ nguyên (`#/profile[/orgId][/section]`)
- [x] e2e mới `e2e/community-web/shell.cm.ts` (viết, chưa chạy; qc relock)

## Không làm / Chạm
Không sửa e2e khoá. Không làm: nội dung hộp thoại Cài đặt (cr110-settings), hero/tab hồ sơ (cr110-profile-ui), composer/rail (cr110-feed),
SSO hand-off (cr110-sso).
**Điểm nối cho cr110-sso:** `lib/contracts-link.ts` `openContracts(path, contractsUrl)` hiện `location.assign(contractsUrl + path)`; đổi thân
sang hand-off, nơi gọi (`Sidebar.tsx`, thẻ SHT của Cài đặt) giữ nguyên. Link vẫn có `href` thật (mở tab mới bằng Ctrl/Cmd-click đi thẳng, không qua hand-off).

## Test tối thiểu
Unit: `nav.test.ts` (caps true/false ⇒ nhóm/mục, route hash, xổ/gập), `brand.test.ts` (ánh xạ brand, getBrand http/mock). e2e viết sẵn, không chạy.

## Quyết định trong lúc làm
- Theo README/mockup (thắng brief): Sidebar KHÔNG có link "Cài đặt" và "Tường nhà" (P1-AC04, D5); "Tường nhà"/"Cài đặt chung"/"Đăng xuất"
  nằm ở user-menu (P1-AC10: đúng 3 mục; mock dev không có phiên ⇒ không có Đăng xuất). Ngôn ngữ chuyển sang Cài đặt (COM-FR-39).
- 4 mục nhóm Sổ Hợp Tác theo mockup + brief: Tổng quan `/overview`, Hợp đồng & giao dịch `/contracts`, Đối tác `/partners`, Sản phẩm & Giá `/products`
  (README P1-AC07 liệt kê 4 khoá `?sec=` — đó là các thẻ trong Cài đặt, thuộc cr110-settings).
- Hộp thoại Cài đặt tạm bọc màn Cài đặt cũ (chạy được, cr110-settings thay thân). `#/settings` ⇒ Bảng tin + hộp thoại; đóng ⇒ `replaceState #/feed`.
- Màu nhấn = `brand.accent` qua `data-accent` (token có sẵn); thêm token `rose` trong `shell.css` (cr110-settings có thể chuyển sang globals).
- Tiêu đề tab = tên công ty chủ quản (đối tác không thấy "Sổ Hợp Tác" trong tab).
- Thanh bên cũ của Hồ sơ bị bỏ ⇒ danh sách "Đối tác" ở hồ sơ tạm biến mất tới khi cr110-profile-ui dựng tab Đối tác (rail Bảng tin vẫn có).
- **e2e khoá sẽ cần qc sửa:** `feed.cm.ts` — dòng `getByText("Sổ Hợp Tác").first()` (topbar nay là tên công ty; chủ quản Admin vẫn thấy chữ ở sidebar),
  bước "thông báo, hồ sơ, cài đặt màu chủ đạo" (nút `Cài đặt` ở topbar và nút `Hồ sơ…` avatar đã thành user-menu: Tài khoản → Cài đặt chung / Tường nhà;
  `button.iconbtn[aria-label="Thông báo"]` vẫn đúng). `roles.cs.ts`: không dùng `sht-link`/bánh răng ⇒ chưa thấy chỗ vỡ do lát này.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED community/hien-thi.md
#### Yêu cầu: Lớp vỏ Community — Topbar thương hiệu, Sidebar, user-menu, hộp thoại Cài đặt
Topbar hiện logo + tên công ty chủ quản (từ `GET /brand`, cả với đối tác), ô tìm, chuông, avatar mở user-menu (Tường nhà · Cài đặt chung · Đăng xuất); không navtab, không bánh răng. Sidebar cố định (≤ 900 px là drawer) có nhóm Community (Bảng tin, Bài đăng của tôi) và nhóm Sổ Hợp Tác xổ/gập (trạng thái nhớ trong localStorage). "Cài đặt chung" mở hộp thoại; `#/settings` = Bảng tin + hộp thoại.
- Kịch bản: nhóm Sổ Hợp Tác chỉ có khi `caps.contracts` và có `contractsUrl`, 4 mục link ngoài [test: apps/workspace-web/src/modules/community/domain/nav.test.ts]
- Kịch bản: đối tác và chủ quản thiếu quyền không có nhóm SHT trong DOM (không CSS ẩn) [test: e2e/community-web/shell.cm.ts]
- Kịch bản: chủ quản đủ quyền thấy 4 link SHT đúng href, cùng tab [test: e2e/community-web/shell.cm.ts]
- Kịch bản: brand chủ quản hiện ở topbar, chưa có brand ⇒ chữ cái đầu + indigo [test: apps/workspace-web/src/modules/community/domain/brand.test.ts » toBrandView]
- Kịch bản: `#/settings` là Bảng tin + hộp thoại, hồ sơ giữ `#/profile[/orgId][/section]` [test: apps/workspace-web/src/modules/community/domain/nav.test.ts]
- Kịch bản: trạng thái xổ/gập chịu lỗi localStorage [test: apps/workspace-web/src/modules/community/domain/nav.test.ts]
- Kịch bản: user-menu role=menu, Esc đóng, Tường nhà mở hồ sơ, gập nhóm nhớ qua tải lại [test: e2e/community-web/shell.cm.ts]

## Việc còn lại
- qc: relock e2e mới; sửa 2 chỗ ở `feed.cm.ts` nêu trên.
- cr110-sso đổi `openContracts`; cr110-settings thay thân `SettingsDialog`, bỏ `accent` cá nhân; cr110-profile-ui dựng hồ sơ (section) — `Route.section` đã parse sẵn.
- Cuối đợt: gộp Delta vào `docs/current/community/hien-thi.md`.
