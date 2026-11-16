---
id: cr180-pages-b
lát: cr180-pages-b
cr: CR-180
làn: nhanh
migration: không
phụ thuộc: cr180-mobile-base
---
## Plan (ngắn)
Áp luật mobile cho Đối tác (danh sách + chi tiết), Sản phẩm & Giá, Thông báo, Cài đặt (Thành viên, khung), Sơ đồ tổ chức. Chỉ đổi bố cục ≤ 640px; desktop giữ.

## Làm
- [x] Đối tác: PageHeader («Thêm công ty» chính, «Tìm công ty» vào «⋯»), chip vai trò trong FilterBar (1 hàng cuộn ngang, chip ≥ 44), dải «Mình giữ hẹn» thu 2 dòng + «Xem thêm», link «Cách tính điểm» tap-target.
- [x] Chi tiết đối tác: PageHeader + MetaList (MST · điện thoại · liên hệ).
- [x] Sản phẩm & Giá: «Thêm sản phẩm» là nút chính PageHeader (chỉ ở danh sách), chip loại trong FilterBar, ô tìm rộng hết.
- [x] Thông báo (web-kit/ui): PageHeader («Đánh dấu tất cả đã đọc» vào «⋯»), ô tích ≥ 44, nút dùng Button kit.
- [x] Cài đặt › Thành viên: danh sách thẻ trên điện thoại (nút «Cấp quản lý» ≥ 44), chừa đáy cho nút trợ lý; khung Cài đặt: mục menu / seg ≥ 44, công tắc vùng bấm mở rộng.
- [x] Sơ đồ tổ chức: điện thoại = danh sách cây (OrgTreeList), tìm ⇒ lọc cây; desktop giữ canvas.

## Không làm / Chạm
- Không đụng contract*/contracts-list/table/overview. `Pager` (features/table) vẫn h-8: thuộc lát 2a/phân trang chung.
- Chạm `packages/web-kit/src/ui/NotificationsPage.tsx`, `NotifyPrefsPanel.tsx` (không phải file kit/).

## Test tối thiểu
bun test apps/workspace-web · tsc · biome · check:ui-kit.

## Quyết định trong lúc làm
- Hook `useIsMobile` (matchMedia ≤ 640px) chỉ dùng khi phải đổi cấu trúc DOM (Thành viên, Sơ đồ) để e2e getByLabel không gặp 2 bản.
- MetaList desktop ẩn nhãn («MST» chỉ còn cho đọc màn hình) — e2e v2i-partners cập nhật theo.
- Thêm key i18n `pv2.phoneLabel`, `pv2.contactLabel`, `vgaps.mine.more|less`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/mobile-trang.md
#### Yêu cầu: Trang danh sách và chi tiết theo khung chung (lát B)
Đối tác, Sản phẩm & Giá, Thông báo, Thành viên dùng PageHeader/FilterBar/MetaList; chip lọc một hàng cuộn ngang, vùng bấm ≥ 44px; nút chính («Thêm công ty», «Thêm sản phẩm») rộng hết dưới tiêu đề.
- Kịch bản: khi mở Đối tác ở điện thoại thì «Tìm công ty» nằm trong «⋯», chip vai trò cuộn ngang [test: thủ công — e2e kiểm mobile ở lát cr180-mobile-audit]
- Kịch bản: khi mở chi tiết đối tác thì MST · điện thoại · liên hệ là MetaList, mục rỗng bị bỏ [test: e2e/contracts-web/v2i-partners.cw.ts » DT-01 · DT-02 · Tổng quan]

#### Yêu cầu: Dải «Mình giữ hẹn» thu gọn trên điện thoại
Điện thoại: tối đa 2 dòng, nút «Xem thêm» / «Thu gọn»; desktop hiện đủ.
- Kịch bản: khi mở Đối tác ở điện thoại thì dải chỉ 2 dòng đến khi bấm «Xem thêm» [test: thủ công — e2e kiểm mobile ở lát cr180-mobile-audit]

#### Yêu cầu: Thành viên dạng danh sách thẻ trên điện thoại
Điện thoại: mỗi người một thẻ (tên, tài khoản, nút «Cấp quản lý» ≥ 44px); desktop giữ bảng.
- Kịch bản: khi đổi cấp quản lý thì nút có nhãn «Cấp quản lý · <tên>» ở cả hai bố cục [test: e2e/contracts-web/org-visibility.cw.ts » cấp quản lý]

#### Yêu cầu: Sơ đồ tổ chức là danh sách cây trên điện thoại
Điện thoại (≤ 640px): phòng ban lồng nhau (thụt lề), mỗi dòng tên phòng · trưởng phòng · số người, vùng bấm ≥ 44px, bấm mở thành viên như bấm thẻ trên sơ đồ; ô tìm lọc cây. Desktop giữ sơ đồ canvas.
- Kịch bản: khi có cây 3 cấp thì danh sách duyệt trước kèm độ sâu [test: apps/workspace-web/src/features/org-chart/components/OrgTreeList.test.tsx » flattenOrg]
- Kịch bản: khi ≤ 640px thì chọn danh sách, ngược lại canvas [test: apps/workspace-web/src/features/org-chart/components/OrgTreeList.test.tsx » orgViewFor]
- Kịch bản: mỗi phòng là một nút ≥ 44px có độ sâu [test: apps/workspace-web/src/features/org-chart/components/OrgTreeList.test.tsx » OrgTreeList]

## Việc còn lại
- `Pager` (features/table) còn nút h-8: cần lát phụ trách bảng/phân trang.
- Chưa chạy e2e (theo luật đợt); 6 màn chưa soát bằng ảnh 390px.
