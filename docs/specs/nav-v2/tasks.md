# nav-v2 — contracts-web: cấu trúc trang + giao diện theo mockup NITI (người dùng chốt 2026-10-20)

Làn: nhanh (UI, không RLS/tiền/migration; không đổi API). Nhánh `slice/nav-v2`. Thay quy tắc D-02 "giống hệt mgmt-app" cho điều hướng và bố cục.
Nguồn: `docs/platform/ba-v2/so-hop-tac-ba-v2.pdf` §4, `docs/platform/ba-v2/mockup-niti.html` (dữ liệu tham khảo, chỉ đọc bố cục/màu/chữ).

## Quyết định
- Menu 4 mục: Tổng quan `/overview` · Hợp đồng · Đối tác · Sản phẩm & Giá `/products`. Avatar ở chân sidebar mở menu (Cài đặt → `/settings` có sẵn, Giao diện, Đăng xuất). Thanh dưới mobile: cùng 4 mục.
- `/` → `/overview` (đường lạ `*` vẫn → `/contracts`). Đăng nhập xong / vào `/login` khi đã có phiên → `/overview`.
- Tổng quan (chỉ dùng API sẵn có, quyền xem do API tự lọc): «Cần xử lý» = `GET /my-work` (cùng hàng + nút hành động của "Việc của tôi", 6 việc + «Xem thêm n việc»);
  «Hợp đồng» = `GET /contracts/facets` gộp 3 nhóm (chờ xác nhận / đang hiệu lực / đã xử lý-hết hạn) + `GET /contracts?status=expiring&sort=end_date` (3 HĐ);
  «Đối tác cần xem lại» = `GET /partners` lọc `band=watch` (CHÚ Ý). **Chưa làm (ẩn, không placeholder):** kết quả kinh doanh (doanh thu, lãi gộp, hoa hồng, hàng giữ,
  theo nhóm sản phẩm), «Sản phẩm: nên làm gì», «Giao dịch nhiều nhất», "giảm ≥ 3 điểm trong 3 tháng" (cần lịch sử điểm) — chờ API mới.
- `/products?tab=prices|cks|sourcing` gộp So sánh giá (mặc định, `?product=`) · Sản phẩm CKS (`?filter=` `?lot=`) · Mua hàng; trang con giữ nguyên, tiêu đề con không còn là H1
  (`EmbeddedHeads`). `/prices` `/cks` `/sourcing` `/my-work` là chuyển hướng; `/cks/$id` (chi tiết khách) giữ, mục menu "Sản phẩm & Giá" sáng.
- Giao diện: token đã trùng mockup (cùng nguồn index.css mgmt-app); thêm token `--grad-to` (ô nhận diện công ty), thanh trên 52 px không tiêu đề, sidebar ghim 224 px / thu 64 px
  (`nav:pinned`, nút ở thanh trên), khối tên app + tên công ty, tiêu đề H1 luôn ở trang, đầu bảng nền `sunk`, thẻ Tổng quan 7fr/5fr. Giao diện Sáng/Tối/Theo máy vẫn ở menu avatar (không thêm nút thứ hai ở thanh trên).
- i18n vi/en: `contracts.nav.*`, `contracts.productsPage.*`, `contracts.overview.*`, `contracts.shell.nav{Collapse,Expand}`; bỏ `contracts.nav.prices`, `contracts.shell.navExtra`.

## Test (qc, lý do relock: "user decision nav-v2 2026-10-20")
- Đổi: `e2e/N1/shell.n1.ts` (menu mới, `/`→/overview, chuyển hướng tuyến cũ, tab Sản phẩm & Giá, sidebar ghim/thu, menu avatar, thanh dưới), `e2e/N1/login.n1.ts` (đã có phiên → /overview),
  `e2e/contracts-web/mywork.cw.ts` (qua /overview), `sourcing.cw.ts` (tab), `scenes.cw.ts` `cks.cw.ts` `hd78-partners.cw.ts` (bỏ so mgmt-app, so baseline của chính contracts-web; `CW_MODE=capture`),
  `playwright.config.ts`, `DEVIATIONS.md`; thêm `overview.cw.ts`, `dataset-overview.ts`; bỏ `capture-ref.ts`. Cảnh mới: overview-{light,dark,mobile,work-expanded}, shell-sidebar-collapsed, shell-account-menu.
- Baseline chụp lại: `win32` (máy dev, `bun run e2e:contracts:capture`) và `linux` (evotest `-Step e2e -Capture cw`).
- Unit: `shell-lib.test.ts`, `guard.test.ts`, mới `overview.test.ts`, `tabs.test.ts`.
- Lock: chỉ cập nhật đúng các tệp đã đổi (không relock các tệp lệch từ trước: `dataset-contract.ts`, `dataset-list.ts`, nhiều tệp chưa khoá).

## Việc còn lại
- Chờ API mới cho các khối số liệu kinh doanh / gợi ý sản phẩm của Tổng quan (xem trên).
- Review cuối đợt (Luật 0b).
