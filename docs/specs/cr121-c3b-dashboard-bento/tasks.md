---
id: cr121-c3b-dashboard-bento
lát: cr121-c3b-dashboard-bento
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c3a-overview-api
---
## Plan (ngắn)
Trang Tổng quan `/` của platform_admin thay hẳn bản cũ bằng bố cục bento theo mẫu đã duyệt (`Tpl-Dashboard`): 1 ô lớn "Lượt chạy 24 giờ" (kèm 24 cột giờ xong/lỗi)
+ 5 ô số liệu nhỏ (tỷ lệ lỗi, thời gian xử lý, lỗi công cụ AI, hạn mức AI tháng, công ty hoạt động 7 ngày) + "Cần xử lý ngay" + "Sức khoẻ hệ thống", lấp kín lưới.
Dữ liệu từ `GET /ops/overview` của Hub (`useOpsOverview`, làm mới 60 s). tenant_admin vẫn vào `/` nhưng chỉ thấy bản công ty của mình (`TenantOverview`, không đổi).

## Làm
- `features/overview/lib/ops-overview.ts` (+ unit): định dạng số theo ngôn ngữ, so với hôm qua, đường xu hướng 7 ngày, 24 cột giờ, tách "Cần xử lý ngay" (có việc / đã ổn), mức sức khoẻ, ánh xạ link.
- `components/ops/*`: `BentoTile` (tiêu đề + "cách tính" + link; trạng thái đang tải/lỗi kèm lý do + Thử lại), `KpiTiles`, `AttentionHealthTiles`, `charts` (SVG/CSS, không thêm thư viện), `OpsBento`.
- Lưới 12 cột (xl) → 6 cột (md) → 1 cột (nhỏ). Màu theo token shell (`bg-card`, `text-warning`, `bg-success`…). i18n `overview.ops.*` vi + en.
- Gỡ bản cũ (D6): `PlatformOverview`, `HubCards`, `NearQuotaCard` và khoá i18n chỉ chúng dùng; ô "Số run 24 giờ / Commands / Workflows / Tenant" (đã có ở trang khác) không còn ở Tổng quan.
- e2e: `e2e/cr121-overview-bento.spec.ts` (mới, chưa chạy) + sửa `e2e/m4-overview.spec.ts` (bỏ ca ô cũ).

## Không làm / Chạm
- Không sửa API, contract, migration. Không đụng `/admin/overview`, `TenantOverview`, trang khác, đường dẫn DLC.
- Perf: không thêm thư viện; biểu đồ bằng SVG/CSS; 1 truy vấn cho cả trang.

## Test tối thiểu
- unit `apps/admin-web/src/features/overview/lib/ops-overview.test.ts`; e2e viết, chạy ở cuối đợt.

## Quyết định trong lúc làm
- **Link đích**: chỉ đặt link tới trang đã có (`/tenants`, `/workflows`, `/system`, `/usage`). `/runs` chưa có ⇒ ô "lượt chạy lỗi hoặc kẹt" hiện số, không link, câu phụ nói rõ.
  Bộ lọc `?filter=…` truyền theo link nhưng trang đích hiện chưa đọc (xem Việc còn lại).
- Hub chưa cấu hình (`PUBLIC_HUB_URL` trống) ⇒ mọi ô báo lý do + cách khắc phục thay vì trống.
- Chuỗi không đủ 2 điểm có số ⇒ không vẽ đường, ghi "chưa đủ dữ liệu"; tỷ lệ/p95 `null` ⇒ "—" + lý do (không hiện 0).
- Ô cũ (Số run 24 giờ, Commands, Workflows, Tenant đang hoạt động, Tenant sắp vượt quota, Agent Forge "Sẽ có khi Agent Hub sẵn sàng") gỡ hẳn, không có doc current để REMOVED (D6). ở bản platform (thuộc nhật ký, đã có trang Nhật ký).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/tong-quan-bento.md
#### Yêu cầu: Tổng quan platform dạng bento, mỗi ô có số hoặc lý do
platform_admin mở `/` thấy ô lớn lượt chạy 24 giờ, 5 ô số liệu, "Cần xử lý ngay" và "Sức khoẻ hệ thống" từ `GET /ops/overview`; ô đang tải/lỗi/chưa có dữ liệu nói rõ lý do và bước tiếp theo; màn nhỏ co về một cột.
- Kịch bản: khi platform_admin mở Tổng quan thì thấy đủ 8 ô và không còn các ô cũ [test: e2e/cr121-overview-bento.spec.ts » CR-121 · platform_admin thấy đủ các ô bento, mỗi ô có nội dung (số hoặc lý do), không còn các ô cũ]
- Kịch bản: khi màn hình nhỏ thì các ô xếp một cột và không tràn ngang [test: e2e/cr121-overview-bento.spec.ts » CR-121 · màn nhỏ co về một cột không tràn ngang, ô Sức khoẻ dẫn tới trang Hệ thống]
- Kịch bản: khi tỷ lệ/xu hướng chưa có số thì hiện "—" hoặc "chưa đủ dữ liệu" thay vì 0 [test: apps/admin-web/src/features/overview/lib/ops-overview.test.ts » sparkPoints: ít hơn 2 điểm có số thì rỗng, bỏ qua null, chuỗi phẳng ở giữa]
- Kịch bản: khi một mục "Cần xử lý ngay" có link tới trang chưa tồn tại thì chỉ hiện số [test: apps/admin-web/src/features/overview/lib/ops-overview.test.ts » resolveLink: chỉ link tới trang đã có, trang chưa có thì null]

#### Yêu cầu: tenant_admin không thấy ô vận hành toàn nền tảng
tenant_admin ở `/` chỉ thấy bản công ty; các ô vận hành toàn nền tảng không hiện.
- Kịch bản: khi tenant_admin mở `/` thì không có ô "Lượt chạy 24 giờ", "Cần xử lý ngay", "Sức khoẻ hệ thống" [test: e2e/cr121-overview-bento.spec.ts » CR-121 · tenant_admin ở '/' chỉ thấy bản công ty, không có ô vận hành toàn nền tảng]

## Việc còn lại
- Trang đích + bộ lọc cho link "Cần xử lý ngay": `/runs?filter=attention&hours=N` (chưa có trang ⇒ hiện số không link); `/tenants?filter=unrouted|near_quota|half_configured` và `/workflows?filter=failing` (trang có, chưa đọc `filter`).
- Trang "Hệ thống" (`/system`) chưa có chi tiết cho từng ô sức khoẻ.
- e2e chưa chạy (chạy một lần cuối đợt); e2e dùng fixture không có Hub thật nên chỉ kiểm "ô có nội dung"; ca có số liệu thật cần dữ liệu hub (lượt chạy/dify) — thêm khi có helper seed hub.
