---
id: fix-cr191-partners-ui
lát: fix-cr191-partners-ui
cr: CR-191
làn: nhanh
migration: không
phụ thuộc: cr191-partner-connect
---
## Plan (ngắn)
Trang Đối tác sau CR-191: (1) nút của «Công ty đã kết nối» bị khối khác đè; (2) trên điện thoại hàng đối tác đầu bị nút trợ lý đè lúc mở trang.

## Làm
- [x] `ConnectedPanel`, khối «Yêu cầu kết nối»/«Lời mời đã gửi», thẻ cài đặt, `DiscoverableCard`: thêm `shrink-0` — trong cột flex của trang (`md:flex-col md:min-h-0`) khối `overflow-hidden` bị co lại và che nút của khối bên dưới.
- [x] Khối «Yêu cầu kết nối»/«Lời mời đã gửi» rỗng ẩn hẳn (không còn dòng «Chưa có…»): không chiếm chỗ, không đẩy danh sách đối tác xuống.
- [x] Điện thoại: dòng đối tác chừa cột phải (`max-sm:pe-16`) cho nút trợ lý nổi ⇒ luật R4 đạt dù dòng rơi vào đúng độ cao của nút. Thẻ cài đặt và công tắc «cho tìm thấy» không vẽ khi phản hồi sai dạng.
- [x] Seed e2e hai công ty (`e2e/_kit/two-companies.seed.ts`): bật «cho tìm thấy» qua `PUT /pack/contracts/connect/listing` (`setCompanyListed`) thay API admin chỉ `tenant_admin` (stack cr161 chết 403 từ khi đổi nghĩa «quản trị»).

## Không làm / Chạm
Không đổi hành vi, quyền, API, i18n (khoá `requestsEmpty`/`sentEmpty` không còn dùng, để nguyên); không thêm ngoại lệ test.

## Test tối thiểu
e2e (evotest): job `cr161` xanh (cả `ket-noi-cong-ty.spec.ts`), `e2e/contracts-web/mobile-rules.cw.ts` Đối tác + Chi tiết đối tác xanh (R4=0).

## Quyết định trong lúc làm
- R4 là luật vị trí: ẩn khối rỗng chưa đủ (hàng «VPP Hồng Hà» vẫn rơi đúng độ cao nút trợ lý) nên chừa cột phải cho nút ở dòng đối tác thay vì dựa vào độ cao các khối phía trên.
- Đỏ khác trong `contracts-web` không thuộc lát: `scenes.cw.ts` (ảnh nền khung/đăng nhập), `hd78-partners.cw.ts` (ảnh nền), `cr189-avatar-list.cw.ts` — chưa xác định nguồn.
- Ẩn khối rỗng thay vì thu gọn: spec BR-191-10 nói «Yêu cầu kết nối · Lời mời đã gửi» là nơi xử lý khi CÓ việc; không có việc thì không cần chỗ. Nút khoá cho vai khác vẫn hiện khi có yêu cầu.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa bố cục/lớp CSS và ẩn khối rỗng của trang Đối tác).

## Việc còn lại
