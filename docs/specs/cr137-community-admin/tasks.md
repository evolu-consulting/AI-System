# cr137-community-admin — Yêu cầu tham gia + Báo cáo vi phạm dạng bảng + khung chi tiết (CR-137)

Làn nhanh. Không đổi API/hub/quyền (`joinReview` giữ nguyên); dùng lại `JoinApprove`, `ReasonDialog`, `decideJoin/decideReport`.

## Quyết định
- Workspace chưa có khuôn danh sách+chi tiết dùng chung ⇒ tạo `ui/flows/AdminList.tsx` (bảng `.ptable` có sẵn + ngăn chi tiết) dùng cho cả hai màn; logic thuần ở `domain/admin-list.ts` (lọc, sắp xếp chờ-xử-lý lên đầu rồi mới nhất, đếm, ngày ngắn).
- Màn rộng (≥ 900px): chi tiết là ngăn bên phải, tự mở dòng đầu; điện thoại: chi tiết thay danh sách + nút «Quay lại danh sách» (CSS thuần). Khi mở chi tiết ẩn cột «Tóm tắt»/«Loại» để bảng không bị cắt.
- Rỗng ⇒ `EmptyState` web-kit; lỗi/đang tải giữ `ListState`. Nút dùng `.primary sm`/`.ghost` hiện có.

## Việc
- [x] domain + unit · AdminList · JoinRequests · Reports · i18n VI/EN · CSS · tsc/biome/check:bundle (145.1 KB js)
- [ ] e2e CÓ THỂ VỠ (khoá, qc sửa): `e2e/community-web/flows.cs.ts:137-141` (`report-hide` nay nằm ở khung chi tiết, không trong dòng `report-item`; cần bấm dòng rồi tìm `report-hide` ở cấp trang) · `e2e/community-web/cr130-journey.cs.ts:201-236` (`join-approve`, `join-approve-summary` trong `join-item` ⇒ nay ở `join-detail`; bấm dòng theo tên công ty trước).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hang-cho-duyet-bai.md
#### Yêu cầu: Yêu cầu tham gia và Báo cáo vi phạm là bảng, bấm dòng xem chi tiết
Người duyệt thấy bảng (công ty/bài, ngày, trạng thái, tóm tắt) có lọc trạng thái; bấm dòng mở khung chi tiết đủ thông tin kèm nút xử lý hiện có (Duyệt/Từ chối/gắn đối tác; Ẩn bài/Cảnh báo/Bỏ qua). Chưa có mục nào ⇒ màn trống nói rõ vì sao. Quyền không đổi.
- Kịch bản: khi lọc «Chờ duyệt» thì chỉ còn dòng chờ, và chờ xử lý luôn lên đầu, mới nhất trước [test: apps/workspace-web/src/modules/community/domain/admin-list.test.ts » chờ xử lý lên đầu]
- Kịch bản: khi lọc theo trạng thái thì chỉ còn đúng dòng đó [test: apps/workspace-web/src/modules/community/domain/admin-list.test.ts » lọc theo trạng thái]
- Kịch bản: khi bấm dòng yêu cầu thì khung chi tiết có nút Duyệt, Từ chối [test: e2e/community-web/cr130-journey.cs.ts » CR130-J2 · duyệt đơn tham gia]
