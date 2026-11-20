---
id: cr193-partners
lát: cr193-partners
cr: CR-193
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Trang Sổ Hợp Tác › Đối tác theo bản mẫu A (BR-193-9..11): một thẻ «Yêu cầu chờ duyệt», một thẻ một dòng «Tìm thấy + Đang kết nối», dòng «giữ hẹn» không khung, bảng dùng cuộn trang.

## Làm
- [x] `lib/pending.ts` (+ test): cắt 3 dòng / «Xem thêm N».
- [x] `PendingRequestsCard` gộp yêu cầu kết nối + yêu cầu vào Bảng tin (`JoinRequestRows` trong embed Community) + lời mời đã gửi.
- [x] `DiscoverableCard` gộp `ConnectedPanel` (mở/đóng) + `InviteSetting`; `MineBanner` một dòng; bỏ cuộn riêng của bảng.
- [x] e2e: cập nhật cr130/cr161/cr169; thêm `e2e/contracts-web/cr193-pending.cw.ts` (viết, không chạy).

## Không làm / Chạm
Không đổi API/DB/quyền, trang chi tiết đối tác. Chạm: features/partners, modules/community/ui/{embed,flows}, i18n contracts+community.

## Test tối thiểu
`bun test apps/workspace-web/src/features/partners/lib/pending.test.ts`; tsc workspace-web; check:modules; depcruise:affected.

## Quyết định trong lúc làm
- Danh sách «Đã kết nối» luôn nằm trong DOM, ẩn bằng `hidden` khi đóng (giữ e2e đọc `connected-list`).
- Bỏ icon mũi tên ở nút «Đang kết nối N công ty» (bảng ICONS chưa có khái niệm; tránh đổi kit).
- Yêu cầu vào Bảng tin: «Cho tham gia» mở hộp chi tiết có bước chọn đối tác (như cũ); «Từ chối» mở hộp lý do cũ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/doi-tac-yeu-cau-cho-duyet.md
#### Yêu cầu: Thẻ «Yêu cầu chờ duyệt» gộp, tối đa 3 dòng
Yêu cầu kết nối và yêu cầu vào Bảng tin nằm chung một thẻ, mỗi yêu cầu một dòng; quá 3 dòng thì «Xem thêm N yêu cầu» mở tại chỗ; không có gì thì ẩn thẻ.
- Kịch bản: khi có 5 yêu cầu chờ thì thấy 3 dòng và «Xem thêm 2 yêu cầu», bấm thì thấy 5 [test: e2e/contracts-web/cr193-pending.cw.ts » 5 yêu cầu chờ ⇒ thấy 3 + «Xem thêm 2 yêu cầu», bấm ⇒ thấy 5, «Thu gọn» ⇒ về 3]
- Kịch bản: khi không có yêu cầu nào thì thẻ ẩn [test: e2e/contracts-web/cr193-pending.cw.ts » không có yêu cầu nào ⇒ ẩn thẻ «Yêu cầu chờ duyệt»]
- Kịch bản: khi 2 yêu cầu kết nối + 3 yêu cầu vào Bảng tin thì vẽ 2 + 1 dòng, ẩn 2 [test: apps/workspace-web/src/features/partners/lib/pending.test.ts » 5 yêu cầu (2 kết nối + 3 vào Bảng tin) ⇒ 3 dòng, «Xem thêm 2»]

#### Yêu cầu: Thẻ một dòng «Tìm thấy + Đang kết nối»
Công tắc tìm thấy và nút «Đang kết nối N công ty» ở một thẻ; bấm nút mở/đóng danh sách và cài đặt mời.
- Kịch bản: khi quản trị bật công tắc thì gửi một PUT listed=true [test: e2e/contracts-web/cr187-discover.cw.ts » quản trị Sổ Hợp Tác: bật công tắc ⇒ một PUT {listed:true}]

## Việc còn lại
Ảnh baseline của trang Đối tác cần chụp lại (được phép đỏ); điều phối chạy e2e cuối đợt.
