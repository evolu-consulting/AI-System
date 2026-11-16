# Trang danh sách/chi tiết trên điện thoại (CR-180 · nguồn: cr180-pages-b, fix-e2e-1116b)

Khung chung và 4 luật: [mobile.md](mobile.md).

#### Yêu cầu: Đối tác, Sản phẩm & Giá, Thông báo, Thành viên theo khung chung
Dùng PageHeader/FilterBar/MetaList; chip lọc một hàng cuộn ngang, vùng bấm ≥ 44px; nút chính («Thêm công ty», «Thêm sản phẩm») rộng hết dưới tiêu đề; «Tìm công ty» nằm trong «⋯».
- Kịch bản: khi mở chi tiết đối tác thì MST · điện thoại · liên hệ là MetaList, mục rỗng bị bỏ [test: e2e/contracts-web/v2i-partners.cw.ts » DT-01 · DT-02 · Tổng quan]
- Kịch bản: khi mở Đối tác ở 390px thì 4 luật đạt [test: e2e/contracts-web/mobile-rules.cw.ts » Đối tác]

#### Yêu cầu: Dải «Mình giữ hẹn» thu gọn trên điện thoại
Điện thoại: tối đa 2 dòng, nút «Xem thêm» / «Thu gọn»; desktop hiện đủ.
- Kịch bản: khi mở Đối tác ở điện thoại thì dải chỉ 2 dòng đến khi bấm «Xem thêm» [test: thủ công — chưa có ca e2e riêng; mobile-rules chỉ kiểm 4 luật]

#### Yêu cầu: Thành viên dạng thẻ trên điện thoại
Điện thoại: mỗi người một thẻ (tên, tài khoản, nút «Cấp quản lý» ≥ 44px); desktop giữ bảng. Nút có nhãn «Cấp quản lý · <tên>» ở cả hai bố cục.
- Kịch bản: khi đổi cấp quản lý thì nút có nhãn «Cấp quản lý · <tên>» [test: e2e/contracts-web/org-visibility.cw.ts » cấp quản lý]

#### Yêu cầu: Sơ đồ tổ chức giữ dạng sơ đồ trên điện thoại
Người dùng chốt 2026-11-16: điện thoại hiện SƠ ĐỒ như máy tính (phóng to/thu nhỏ/kéo được), KHÔNG đổi sang danh sách cây. Chữ/ô trong sơ đồ theo mức thu phóng nên được miễn luật cỡ chữ/vùng bấm (ngoại lệ `zoomCanvas` trong `e2e/_kit/mobile-rules.ts`); phần ngoài sơ đồ vẫn theo luật mobile.
- Kịch bản: khi mở Sơ đồ tổ chức ở 390px thì không tràn ngang và phần ngoài sơ đồ đạt luật [test: e2e/contracts-web/mobile-rules.cw.ts » Sơ đồ tổ chức]

Nợ: `Pager` (features/table) còn nút cao 32px (h-8), cần lát phụ trách bảng/phân trang.
