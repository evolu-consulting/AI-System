---
id: fix-cr191-feed-mobile
lát: fix-cr191-feed-mobile
cr: CR-191
làn: nhanh
migration: không
phụ thuộc: cr191-feed-ui
---
## Plan (ngắn)
Sửa 3 lỗi soát UI (CR-187/uat-ui-review.md) ở bảng tin điện thoại và nhãn «Ai thấy bài».

## Làm
- [x] Nút nổi «Lọc» nằm trên thanh điều hướng đáy (56px + vùng an toàn); cuối danh sách và hàng «Bình luận» chừa chỗ cho nút Lọc / nút trợ lý (R4).
- [x] Bỏ thanh bo tròn trống dưới ô «Viết bài…» (`.feedbar` chỉ dựng ở máy tính).
- [x] «Chỉ chủ quản» ⇒ «Chỉ nội bộ» ở nhãn «Ai thấy bài» của thẻ bài (vi + en) và dữ liệu mẫu; sửa `roles.cs.ts` theo.

## Không làm / Chạm
- Chạm: `ui/Feed.tsx`, `ui/styles/feed.css`, i18n `community`, e2e `cr191-feed-ui.cm.ts`, `roles.cs.ts`.

## Test tối thiểu
- e2e (viết, chưa chạy): `cr191-feed-ui.cm.ts`, `roles.cs.ts`; luật R4 `mobile-rules.cm.ts` có sẵn.

## Quyết định trong lúc làm
- Ghi chú «Chỉ chủ quản thấy bài này» (partnerNote) và chữ trong Cài đặt thông báo không phải nhãn «Ai thấy bài» ⇒ giữ nguyên.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Bảng tin điện thoại không che thao tác và nhãn Chỉ nội bộ
Trên điện thoại nút nổi «Lọc» nằm trên thanh điều hướng đáy, cuối danh sách chừa chỗ cho nút nổi; không có thanh trống dưới ô đăng bài. Nhãn «Ai thấy bài» của bài chủ quản dành cho đối tác ghi «Chỉ nội bộ».
- Kịch bản: khi xem bảng tin ở điện thoại thì không có thanh trống và nút Lọc nằm trên thanh đáy [test: e2e/community-web/cr191-feed-ui.cm.ts » điện thoại: không còn thanh bo tròn trống dưới ô đăng bài, nút Lọc nằm trên thanh đáy]

## Việc còn lại
- (không)
