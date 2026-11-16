# Hồ sơ cá nhân Bảng tin `/community/me` (CR-179 · nguồn: cr179-profile-header, cr179-community-avatar)

#### Yêu cầu: Đầu trang hồ sơ cá nhân
Tên người dùng luôn hiện, không bị ảnh bìa đè; kèm chip vai trò, dòng «chức vụ · phòng ban» (thiếu phần nào bỏ phần đó, không «·» thừa), công ty (logo tròn cùng hàng tên công ty, bấm mở trang công ty) và email có nút sao chép.
- Kịch bản: thiếu phòng ban hoặc chức vụ ⇒ dòng phụ không có «·» thừa [test: apps/workspace-web/src/modules/community/domain/me-profile.test.ts » CR-179 dòng phụ chức vụ · phòng ban: thiếu phần nào bỏ phần đó]
- Kịch bản: mở /community/me ⇒ tên hiện, không bị phần tử khác đè, có chip vai [test: e2e/community-web/cr147-feed.cm.ts » CR-179: /community/me — tên hiện, không bị phần tử khác đè, có chip vai trò]
- Kịch bản: logo công ty tròn cùng hàng tên công ty [test: e2e/community-web/cr147-feed.cm.ts » CR-179: /community/me — logo công ty tròn, cùng hàng với tên công ty]

Chưa làm: dải số liệu (bài đăng, đã lưu trữ, đối tác — cần nâng dữ liệu ra khỏi FeedList); nút «Sửa hồ sơ».
