# e2e kiểm mobile 390px tự động (CR-180 · nguồn: cr180-mobile-audit, cr180-fix-rest)

Code: `e2e/_kit/mobile-rules.ts` (đo; bảng ngoại lệ có tên), `e2e/contracts-web/mobile-rules.cw.ts`, `e2e/community-web/mobile-rules.cm.ts`, ảnh mẫu `scenes*`. Luật: [mobile.md](mobile.md).

#### Yêu cầu: Các màn chính đạt 4 luật mobile ở 390 px
Mỗi màn chính của Sổ Hợp Tác và Cộng đồng, ở 390×844: không tràn ngang; mọi nút/link/ô nhập bấm được có cạnh ≥ 44 px; chữ ≥ 12 px (badge số ≥ 11 px); nút trợ lý nổi không che phần tử bấm được lúc trang vừa mở. Ngoại lệ chỉ ở bảng có tên trong `e2e/_kit/mobile-rules.ts`.
- Kịch bản: Tổng quan [test: e2e/contracts-web/mobile-rules.cw.ts » Tổng quan]
- Kịch bản: Danh sách HĐ [test: e2e/contracts-web/mobile-rules.cw.ts » Danh sách HĐ]
- Kịch bản: Chi tiết HĐ [test: e2e/contracts-web/mobile-rules.cw.ts » Chi tiết HĐ]
- Kịch bản: Tạo HĐ [test: e2e/contracts-web/mobile-rules.cw.ts » Tạo HĐ]
- Kịch bản: Việc của tôi [test: e2e/contracts-web/mobile-rules.cw.ts » Việc của tôi]
- Kịch bản: Đối tác [test: e2e/contracts-web/mobile-rules.cw.ts » Đối tác]
- Kịch bản: Chi tiết đối tác [test: e2e/contracts-web/mobile-rules.cw.ts » Chi tiết đối tác]
- Kịch bản: Sản phẩm [test: e2e/contracts-web/mobile-rules.cw.ts » Sản phẩm]
- Kịch bản: Sơ đồ tổ chức (ngoại lệ `zoomCanvas` trong sơ đồ) [test: e2e/contracts-web/mobile-rules.cw.ts » Sơ đồ tổ chức]
- Kịch bản: Tin nhắn [test: e2e/contracts-web/mobile-rules.cw.ts » Tin nhắn]
- Kịch bản: Khung chat [test: e2e/contracts-web/mobile-rules.cw.ts » Khung chat]
- Kịch bản: Cài đặt thành viên [test: e2e/contracts-web/mobile-rules.cw.ts » Cài đặt thành viên]
- Kịch bản: Thông báo [test: e2e/contracts-web/mobile-rules.cw.ts » Thông báo]
- Kịch bản: Bảng tin [test: e2e/community-web/mobile-rules.cm.ts » Bảng tin]
- Kịch bản: Hồ sơ [test: e2e/community-web/mobile-rules.cm.ts » Hồ sơ]
- Kịch bản: Yêu cầu tham gia [test: e2e/community-web/mobile-rules.cm.ts » Yêu cầu tham gia]
- Kịch bản: Báo cáo vi phạm [test: e2e/community-web/mobile-rules.cm.ts » Báo cáo vi phạm]

#### Yêu cầu: Ảnh mẫu điện thoại cho Bảng tin và Tin nhắn
- Kịch bản: Bảng tin ở 390 px khớp ảnh mẫu [test: e2e/community-web/scenes-mobile.cm.ts » bang-tin-mobile]
- Kịch bản: Tin nhắn ở 390 px khớp ảnh mẫu [test: e2e/contracts-web/scenes.cw.ts » messages-mobile]

Ghi chú: bộ ảnh mẫu «dark» thực ra chụp giao diện sáng (chưa điều tra, xem STATE).
