---
id: cr120-one-shell
lát: cr120-one-shell
cr: CR-120
làn: nhanh
migration: không
phụ thuộc: CR-119 phần 2 (SHT dưới /contracts, Community /community)
---
## Plan (ngắn)
Lỗi người dùng thấy trên prod: Community vẽ khung RIÊNG (header "Công ty Demo / AI ggroup" + ô tìm toàn cục + sidebar riêng với nhóm "SỔ HỢP TÁC"
dùng `<a class="sidelink">` + onClick + biểu tượng ↗) nên Community và Sổ Hợp Tác khác nhau, đổi qua lại như chuyển trang. CR-118: MỘT shell.
Làm: một AppShell (features/shell: Sidebar/Header/BottomNav/UserMenu) cho mọi module; menu trái SINH TỪ MANIFEST (`shell/nav.ts`,
`shell/modules.ts`), mỗi module khai nhóm (`groupLabelKey`/`order`/`nav`/`accountMenu`) với basePath = `/${key}`; mục là `<Link>` TanStack.
`/community/*` chuyển vào `routes/_authed` (chung khung); cổng gói contracts chỉ bọc `/contracts/*` (`ContractsGate`) ⇒ đối tác chỉ thấy nhóm Community
và KHÔNG gọi `/pack/contracts/me`. Community chỉ còn nội dung trang; ô tìm + chuông (+ persona mock) vào KHE thanh trên chung (`shell/topbar-slots`,
portal). Giao diện sáng/tối nằm TRONG menu tài khoản (người dùng chốt lại): menu tối giản dùng chung admin-web + workspace-web — đầu menu = tên + vai, một hàng "Giao diện" = nhóm 3 nút chỉ biểu tượng (Sun/Moon/Monitor, tooltip + aria-label) và "Ngôn ngữ" VI | EN, mục có biểu tượng (KeyRound/ShieldCheck/Settings), Đăng xuất ở cuối; lưu qua prefs-sync như cũ.
`--cm-*` ánh xạ sang token shell (màu literal → var(--card/--ink/--rule…), tối dùng được). 3 loại bài có token ngữ nghĩa `--type-sell|buy|note`
(xanh lá / xanh dương / hổ phách, AA, có bản tối); cam thương hiệu chỉ cho nút chính.

## Làm
- shared/kernel/module-manifest.ts (NavEntry, AccountEntry, groupLabelKey, order) · modules/{contracts,community}/manifest.ts · shell/{nav,modules,use-shell-packs,topbar-slots,dev-identity}.ts
- features/shell/components/{Sidebar,Header,BottomNav,UserMenu,AccountSection}.tsx · web-kit PrefsPanel (icon-only) · admin-web AccountMenu
- routes/_authed/{contracts,community}.tsx (+ con) · pack-state/pages/{PackFrame,ContractsGate,ShellFeatured}.tsx · useMe `enabled`
- modules/community: bỏ Sidebar/UserMenu/sidebar-state/nav model, TopBar → khe thanh trên, CSS (shell.css/mockup.css/accent.css/feed.css) theo token
- e2e: community-web (shell.cm.ts, feed.cm.ts), N1 shell.n1.ts, workspace-web auth.ss.ts, contracts-web legacy-routes.cw.ts (+ baseline relock)

## Không làm / Chạm
- Không đổi hành vi nghiệp vụ, API, quyền server. Không sửa engine/DLC. Chưa gộp sang trang cấu hình admin-like (bố cục Cài đặt 1 kiểu) — xem "Việc còn lại".

## Test tối thiểu
unit: shell/nav.test.ts (partner/member/owner), shell-lib.test (layout community), manifest tests; e2e (qc, một lần cuối): community-web,
community-web-stack, workspace-web-stack, contracts-web, N1 shell.

## Quyết định trong lúc làm
- Chuông: Community vẽ chuông riêng của nó vào khe `bell` khi ở /community; ở /contracts dùng ConnectedBell (gói contracts). Một vị trí, hai nguồn dữ liệu.
- Mock Community (không phiên): "nhân vật" cấp danh tính + gói cho AppShell qua `reportViewer` (chỉ bản dựng mock).
- Brand chủ quản: đối tác không có /company ⇒ Community báo brand chủ quản vào brandStore (nhận diện = công ty chủ quản như trước).
- Nhóm menu không còn xổ/gập (hai nhóm ngắn, cùng kiểu SHT).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED web/web-hop-nhat.md
#### Yêu cầu: MỘT AppShell dùng chung cho mọi module, menu sinh từ manifest (CR-120 §one-shell)
Mọi module (Sổ Hợp Tác `/contracts/*`, Community `/community/*`) chạy trong cùng một khung: thanh trên (nhận diện công ty chủ quản, khe tìm kiếm của
module, chuông, trợ lý, công tắc sáng/tối, menu tài khoản) và thanh trái. Thanh trái do manifest các module sinh ra (mỗi module bật theo gói đóng góp một
nhóm, basePath = `/${key}`); mọi mục là `<Link>` của router, không có thẻ `<a>` tự bắt onClick, không biểu tượng liên kết ngoài.
- Kịch bản: khi người dùng có cả hai gói thì menu có nhóm Sổ Hợp Tác (4 mục) rồi nhóm Community (2 mục), đối tác chỉ có nhóm Community [test: apps/workspace-web/src/shell/nav.test.ts » buildShellNav]
- Kịch bản: khi bấm Community → Hợp đồng và ngược lại thì không tải lại trang, URL đổi, sidebar/topbar giữ nguyên [test: e2e/workspace-web/auth.ss.ts » MỘT khung (CR-120)]
- Kịch bản: khi điều hướng menu Sổ Hợp Tác bằng menu hoặc Back/Forward thì không có sự kiện load [test: e2e/contracts-web/legacy-routes.cw.ts » CR-120 · điều hướng menu trong app không tải lại trang]
- Kịch bản: khi mở /community thì không còn header/sidebar riêng của Community, ô tìm và chuông nằm trong thanh trên chung [test: e2e/community-web/shell.cm.ts » MỘT khung: không còn header/sidebar riêng của Community]
- Kịch bản: khi đối tác (không gói contracts) vào Community thì DOM không có nhóm/đường dẫn Sổ Hợp Tác và không có lời gọi /pack/contracts/ [test: e2e/workspace-web/auth.ss.ts » đối tác lần đầu: buộc đổi mật khẩu]

#### Yêu cầu: Menu tài khoản tối giản, giao diện sáng/tối chỉ biểu tượng (CR-120)
Menu tài khoản (admin-web và workspace-web dùng chung PrefsPanel): tên + vai gọn; một hàng "Giao diện" gồm 3 nút chỉ biểu tượng Sáng / Tối / Theo máy (tooltip + aria-label)
và nhóm "Ngôn ngữ" VI | EN; mục Đổi mật khẩu / Xác thực hai bước có biểu tượng; Đăng xuất ở cuối, tách riêng. Lưu như cũ (prefs-sync); không có nút sáng/tối riêng ở thanh trên.
- Kịch bản: khi bấm radio "Tối" trong menu thì html[data-theme] = dark, radio là biểu tượng không chữ có tooltip [test: e2e/N1/shell.n1.ts » giao diện: menu 'Tài khoản' có nhóm 'Giao diện' CHỈ biểu tượng]
- Kịch bản: khi ở Community thì giao diện nằm trong cùng menu, thanh trên không có nút sáng/tối [test: e2e/community-web/shell.cm.ts » giao diện nằm TRONG menu tài khoản]
#### Yêu cầu: Màu 3 loại bài Community khác nhau, token ngữ nghĩa (CR-120)
Cần bán / Cần mua / Thông báo có token `--type-sell|buy|note` (+ soft/ink, bản tối, chữ trên nền soft đạt AA) dùng nhất quán ở nhãn bài, viền trái thẻ,
nút soạn nhanh (biểu tượng) và số đếm tab; màu cam thương hiệu chỉ cho nút chính.
- Kịch bản: khi xem Bảng tin thì nhãn bài, biểu tượng nút soạn nhanh và số đếm tab của 3 loại có màu tính toán khác nhau [test: e2e/community-web/shell.cm.ts » 3 loại bài có màu KHÁC nhau]

### MODIFIED community/hien-thi.md
#### Yêu cầu: COM-FR-43 Link sang Sổ Hợp Tác là link trong app, cách ly đối tác bằng route + chunk (nguồn: cr118-spec)
Nhóm Sổ Hợp Tác trong menu trái là link trong app (`<Link>`), do manifest module contracts đóng góp và chỉ có khi gói contracts bật; không còn menu/topbar riêng
của Community.
- Kịch bản: khi chủ quản có quyền thì nhóm Sổ Hợp Tác có đúng 4 link trong app, không biểu tượng ngoài [test: e2e/community-web/shell.cm.ts » chủ quản có quyền (Admin)]
- Kịch bản: khi là đối tác hoặc thành viên không có quyền contracts thì DOM không có nhóm/đường dẫn Sổ Hợp Tác [test: e2e/community-web/shell.cm.ts » cách ly đối tác]

## Việc còn lại
- Bố cục Cài đặt MỘT kiểu (menu trái + nội dung) cho Cài đặt Sổ Hợp Tác / Community / pane cấu hình: chưa làm (cần đợt riêng; không đổi hành vi).
- Baseline win32 của contracts-web cần chụp lại cục bộ (`bun run e2e:contracts:capture`); bản Linux chụp bằng evotest `-Capture cw`.
