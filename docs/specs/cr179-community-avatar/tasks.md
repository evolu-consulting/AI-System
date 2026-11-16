---
id: cr179-community-avatar
lát: cr179-community-avatar
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Lát 3 CR-179 (ý 4, 5): Bảng tin gọn lại + MỘT avatar người dùng cho header, sidebar, menu điện thoại.

## Làm
- [x] Ô đăng bài: bỏ đệm trên khối dính ⇒ mép trên = thẻ «Bộ lọc» (`feed.css` `.stickytop`).
- [x] «Nhắc tên»: ô tìm có khoảng cách dưới (`mb-3` = 12px); nút mở có viền như nút cùng hàng (`ghost icononly`).
- [x] `/community/me`: logo công ty = kit `Avatar kind="company"` bo tròn, cùng hàng chữ «Công ty».
- [x] «Yêu cầu tham gia» / «Báo cáo vi phạm» rỗng: `EmptyState full` canh giữa (`.flowempty`).
- [x] `UserAvatar` (web-kit) dùng ở `UserChip` (header) + `UserMenu` (sidebar, điện thoại); ảnh qua `useMyAvatar`.

## Không làm / Chạm
Không sửa file kit có sẵn, Attach*, messages-web, Sidebar (chỉ UserMenu chân sidebar).

## Test tối thiểu
`packages/web-kit/src/ui/UserAvatar.test.tsx`; e2e thêm vào `e2e/community-web/cr147-feed.cm.ts` (chưa chạy).

## Quyết định trong lúc làm
- Màu avatar = `bg-accent text-primary` (màu chính nhạt); header đổi 28 ⇒ 32px theo thang.
- Ô đăng bài thẳng hàng bằng `top:-18px` + bóng nền 10px thay cho `padding-top:38px`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/bang-tin-giao-dien.md
#### Yêu cầu: Bảng tin thẳng hàng và gọn
Ô đăng bài cùng mép trên thẻ «Bộ lọc». Ô tìm «Nhắc tên» cách phần dưới ≥ 12px; nút mở nhắc tên có viền như nút cùng hàng. Hồ sơ cá nhân: logo công ty tròn đứng cùng hàng chữ «Công ty». Màn «Yêu cầu tham gia» / «Báo cáo vi phạm» rỗng hiện trạng thái trống canh giữa vùng nội dung.
- Kịch bản: mép trên ô đăng bài = mép trên thẻ «Bộ lọc» [test: e2e/community-web/cr147-feed.cm.ts » CR-179: mép trên ô đăng bài = mép trên thẻ «Bộ lọc» (lệch ≤ 1px)]
- Kịch bản: `/community/me` logo công ty tròn cùng hàng chữ «Công ty» [test: e2e/community-web/cr147-feed.cm.ts » CR-179: /community/me — logo công ty tròn, cùng hàng với chữ «Công ty»]
- Kịch bản: báo cáo rỗng ⇒ trạng thái trống canh giữa [test: e2e/community-web/cr147-feed.cm.ts » CR-179: «Báo cáo vi phạm» không có dữ liệu ⇒ trạng thái trống canh giữa vùng nội dung]

#### Yêu cầu: Một avatar người dùng ở header và sidebar
Header, chân sidebar và menu điện thoại dùng cùng component, cùng chữ cái đầu, cùng ảnh, cùng màu nền (màu chính nhạt), cỡ 24/32/40.
- Kịch bản: mọi cỡ cùng lớp màu; header và menu đều dùng UserAvatar [test: packages/web-kit/src/ui/UserAvatar.test.tsx » UserAvatar]
- Kịch bản: avatar header và sidebar cùng màu nền [test: e2e/community-web/cr147-feed.cm.ts » CR-179: avatar header và sidebar cùng màu nền]

## Việc còn lại
e2e CR-179 chưa chạy (cuối đợt, evotest).
