# Web hợp nhất `workspace-web` (UW-FR)

Cập nhật: 2026-11-04 · Nguồn: CR-118 (cr118-spec). Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: UW-FR-01..03 Một web, một phiên, module lazy theo manifest (nguồn: cr118-spec)
Web nghiệp vụ `apps/workspace-web` có một shell/router/phiên; mỗi module khai `manifest.ts` (nav, requires, settings, i18n, slots); module tắt = không DOM, không route con, không tải chunk; đối tác cách ly ở mức route + chunk.
- Kịch bản: khi công ty tắt Community thì nhóm Community biến khỏi sidebar và `/community` về home kèm toast [test: thủ công — e2e toggle feature ở lát cr118-e2e]

#### Yêu cầu: UW-FR-04..06 GET /pack/me, FeatureGate OpenFeature, cập nhật tức thời (nguồn: cr118-spec)
`GET /pack/me` trả `{packs, addons, brand, home, versions}` từ ConfigCache (0 SQL nóng, ETag `"<config>.<hub_config>"`, 304); web đọc qua provider OpenFeature mỏng; event SSE `config.changed` trên `/me/stream` kích refetch; dự phòng focus/403/60 s; server fail-closed.
- Kịch bản: khi đổi cấu hình app ở ai-admin thì web nhận `config.changed` và refetch `/pack/me` (304 nếu không đổi) [test: thủ công — int `/pack/me` + e2e ở lát cr118-feature-gate]
- Kịch bản: khi gọi `/pack/me` của công ty khác thì không thấy dữ liệu (chặn chéo tenant) [test: thủ công — int ở lát cr118-feature-gate]

#### Yêu cầu: UW-FR-07..09 Đổi hướng cũ, một i18n/CSS, luật depcruise (nguồn: cr118-spec)
`community.<d>` 301 + ánh xạ hash cũ; một instance i18next (khoá `shell.*`, `contracts.*`, `community.*`, ngôn ngữ chung `ai.locale`); CSS Community scope `[data-mod=community]` với `--cm-*`; 6 luật depcruise mức error.
- Kịch bản: khi module `modules/X` import `modules/Y` thì `depcruise` báo lỗi [test: thủ công — chạy `bun run depcruise` ở lát cr118-move]

#### Yêu cầu: UW-FR-10..15 Flow runtime, node form, trang cấu hình app, năng lực (đợt 2, kế hoạch) (nguồn: cr118-spec)
Thẻ duyệt HĐ chạy qua `FlowRuntime` + registry renderer; node engine `form` (subset field, validator từ snapshot, quyết + payload cùng transaction); `/apps/$appKey` 5 tab dùng chung `AppCard` với `/tenants/$id`; tenant xem chỉ đọc ở Cài đặt › "Ứng dụng & quy trình"; read-model `TenantCapabilityView` (không migration).
- Kịch bản: khi gửi hành động form hai lần thì chỉ một lần có hiệu lực (idempotent) [test: thủ công — int ở lát cr118-node-form]


## Delta gộp 2026-11-09 (đợt cr125-wave)
Mục dưới thắng nội dung cũ cùng chủ đề ở trên (lát: cr119-contracts-prefix, cr120-one-shell, cr120-settings-layout, cr120-slot-contract).

#### Yêu cầu: UW-DEP-07..09 SHT dưới tiền tố /contracts, URL cũ còn chạy, basePath theo khoá app (nguồn: cr119-contracts-prefix)
Sổ Hợp Tác ở `app.<d>/contracts/…` (Tổng quan `/contracts`, danh sách `/contracts/list`, chi tiết `/contracts/c/:id`, đối tác `/contracts/partners`, sản phẩm `/contracts/products`, cài đặt `/contracts/settings/*`, thông báo `/contracts/notifications`); Community giữ `/community`. URL cũ ở gốc chuyển hướng client giữ query/hash (cả `?next=`). Home, nav, quyền mở path suy từ `basePath = /${khoá app}` của manifest.
- Kịch bản: URL SHT cũ (`/overview`, `/contracts/<id>`, `/partners?party=`, `/notifications#prefs`, `/transactions/new`) chuyển đúng sang URL mới, URL mới/Community không bị đổi, áp hai lần không đổi thêm [test: apps/workspace-web/src/shared/kernel/legacy-routes.test.ts » legacyTarget · tuyến SHT cũ ở gốc → /contracts/…]
- Kịch bản: đăng nhập với `next` cũ đáp đúng URL mới; home SHT là `/contracts`, Community `/community`; đường lạ không mở được [test: apps/workspace-web/src/platform/auth/domain/login-machine.test.ts » CR-118 · password → change → TOTP → home theo vai]
- Kịch bản: manifest contracts khai `basePath=/contracts` và mọi mục menu nằm dưới đó; Tổng quan chỉ sáng ở gốc, chi tiết thuộc mục Hợp đồng [test: apps/workspace-web/src/modules/contracts/manifest.test.ts » home và mọi mục menu nằm dưới basePath]
- Kịch bản: `/contracts/*` không trùng proxy dev / location nginx API [test: apps/workspace-web/scripts/deploy-proxy.test.ts » kit prod · nginx web 8081 không đụng /contracts/*]
- Kịch bản: duyệt/đăng nhập/danh sách/chi tiết trên URL mới và URL cũ chuyển hướng chạy thật [test: e2e/contracts-web/legacy-routes.cw.ts » URL cũ chuyển hướng sang /contracts/… (giữ query)]

#### Yêu cầu: MỘT AppShell dùng chung cho mọi module, menu sinh từ manifest (CR-120 §one-shell) (nguồn: cr120-one-shell)
Mọi module (Sổ Hợp Tác `/contracts/*`, Community `/community/*`) chạy trong cùng một khung: thanh trên (nhận diện công ty chủ quản, khe tìm kiếm của
module, chuông, trợ lý, công tắc sáng/tối, menu tài khoản) và thanh trái. Thanh trái do manifest các module sinh ra (mỗi module bật theo gói đóng góp một
nhóm, basePath = `/${key}`); mọi mục là `<Link>` của router, không có thẻ `<a>` tự bắt onClick, không biểu tượng liên kết ngoài.
- Kịch bản: khi người dùng có cả hai gói thì menu có nhóm Sổ Hợp Tác (4 mục) rồi nhóm Community (2 mục), đối tác chỉ có nhóm Community [test: apps/workspace-web/src/shell/nav.test.ts » buildShellNav]
- Kịch bản: khi bấm Community → Hợp đồng và ngược lại thì không tải lại trang, URL đổi, sidebar/topbar giữ nguyên [test: e2e/workspace-web/auth.ss.ts » MỘT khung (CR-120)]
- Kịch bản: khi điều hướng menu Sổ Hợp Tác bằng menu hoặc Back/Forward thì không có sự kiện load [test: e2e/contracts-web/legacy-routes.cw.ts » CR-120 · điều hướng menu trong app không tải lại trang]
- Kịch bản: khi mở /community thì không còn header/sidebar riêng của Community, ô tìm và chuông nằm trong thanh trên chung [test: e2e/community-web/shell.cm.ts » MỘT khung: không còn header/sidebar riêng của Community]
- Kịch bản: khi đối tác (không gói contracts) vào Community thì DOM không có nhóm/đường dẫn Sổ Hợp Tác và không có lời gọi /pack/contracts/ [test: e2e/workspace-web/auth.ss.ts » đối tác lần đầu: buộc đổi mật khẩu]

#### Yêu cầu: Menu tài khoản tối giản, giao diện sáng/tối chỉ biểu tượng (CR-120) (nguồn: cr120-one-shell)
Menu tài khoản (admin-web và workspace-web dùng chung PrefsPanel): tên + vai gọn; một hàng "Giao diện" gồm 3 nút chỉ biểu tượng Sáng / Tối / Theo máy (tooltip + aria-label)
và nhóm "Ngôn ngữ" VI | EN; mục Đổi mật khẩu / Xác thực hai bước có biểu tượng; Đăng xuất ở cuối, tách riêng. Lưu như cũ (prefs-sync); không có nút sáng/tối riêng ở thanh trên.
- Kịch bản: khi bấm radio "Tối" trong menu thì html[data-theme] = dark, radio là biểu tượng không chữ có tooltip [test: e2e/N1/shell.n1.ts » giao diện: menu 'Tài khoản' có nhóm 'Giao diện' CHỈ biểu tượng]
- Kịch bản: khi ở Community thì giao diện nằm trong cùng menu, thanh trên không có nút sáng/tối [test: e2e/community-web/shell.cm.ts » giao diện nằm TRONG menu tài khoản]
#### Yêu cầu: Màu 3 loại bài Community khác nhau, token ngữ nghĩa (CR-120) (nguồn: cr120-one-shell)
Cần bán / Cần mua / Thông báo có token `--type-sell|buy|note` (+ soft/ink, bản tối, chữ trên nền soft đạt AA) dùng nhất quán ở nhãn bài, viền trái thẻ,
nút soạn nhanh (biểu tượng) và số đếm tab; màu cam thương hiệu chỉ cho nút chính.
- Kịch bản: khi xem Bảng tin thì nhãn bài, biểu tượng nút soạn nhanh và số đếm tab của 3 loại có màu tính toán khác nhau [test: e2e/community-web/shell.cm.ts » 3 loại bài có màu KHÁC nhau]

#### Yêu cầu: MỘT bố cục Cài đặt cho mọi module (CR-120 §settings-layout) (nguồn: cr120-settings-layout)
Cài đặt Sổ Hợp Tác và Cài đặt chung của Community dùng cùng một khung: menu trái (tab ngang trên mobile), mỗi mục có tiêu đề và mô tả một dòng,
mỗi hàng có nhãn/mô tả bên trái và ô điều khiển bên phải; màu theo token của shell. Nhãn theo ngôn ngữ nghiệp vụ.
- Kịch bản: khi đối tác mở Cài đặt chung thì chỉ có nhóm Cá nhân trong menu trái [test: e2e/community-web/settings.cm.ts » đối tác: chỉ nhóm Cá nhân, không có Sổ Hợp Tác / Công ty trong DOM]
- Kịch bản: khi Admin chọn từng mục Sổ Hợp Tác thì mục hiện trong cùng hộp thoại, URL không đổi [test: e2e/community-web/settings.cm.ts » Admin: mục Sổ Hợp Tác nằm trong dialog Cài đặt, không đổi URL ngoài ?settings=]
- Kịch bản: khi chọn English ở mục Ngôn ngữ thì ngôn ngữ đổi và được lưu [test: e2e/community-web/settings.cm.ts » ngôn ngữ: chọn English đổi nhãn và lưu ai.locale]
- Kịch bản: khi mở Cài đặt Sổ Hợp Tác và chọn Quy trình duyệt thì chỉ xem, không có nút Lưu [test: e2e/contracts-web/approval-current.cw.ts » Cài đặt hiện quy trình đang dùng, không có form sửa]

#### Yêu cầu: Cài đặt › Ứng dụng & quy trình hiện mọi khe khai báo (nguồn: cr120-slot-contract)
Mục Ứng dụng & quy trình liệt kê mọi khe của app theo manifest kèm tên và mục đích; khe công ty chưa có quy trình hiện cảnh báo thay vì bị ẩn.
- Kịch bản: khi công ty bật Community mà chưa có khe nào thì vẫn thấy 3 khe với cảnh báo thiếu [test: thủ công — test đã đổi tên/gộp sau lát, xem lịch sử git]
- Kịch bản: khe năng lực ngoài manifest vẫn hiện sau khe manifest [test: thủ công — test đã đổi tên/gộp sau lát, xem lịch sử git]
