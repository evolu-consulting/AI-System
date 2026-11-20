---
id: cr195-dialog
lát: cr195-dialog
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa khung hộp thoại chung (web-kit + bản workspace) rồi bỏ thẻ lồng trong hộp «Viết bài».

## Làm
- [x] `dialog.tsx` (web-kit/kit, workspace-web/ui): nền `bg-card`, lề 24/16px, đầu cách trên 20px, nút × canh hàng tiêu đề.
- [x] Composer: `.composedlg` bỏ thẻ bọc + thẻ «Ai thấy bài»; điện thoại ô viết giãn, thanh dưới dính đáy, safe-area (`styles/mobile.css`).
- [x] RULES.md: mục «Hộp thoại — CR-195».
- [x] e2e `cr195-composer-dialog.cm.ts` (viết, chưa chạy).

## Không làm / Chạm
Không chạm PostCard/AttachGallery/PostMedia/files hub-api. Bản dialog admin/chat/studio chưa đổi (ghi báo cáo).

## Test tối thiểu
unit `apps/workspace-web/src/components/ui/dialog.test.tsx`; e2e `e2e/community-web/cr195-composer-dialog.cm.ts`.

## Quyết định trong lúc làm
- Bản chép dialog của workspace-web đổi cùng web-kit (Composer dùng bản workspace); admin/chat/studio để lát sau.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED web/giao-dien-chung.md
#### Yêu cầu: Hộp thoại nền trắng, lề đều, không thẻ lồng
Hộp thoại nền `--card`; lề ngang 24px (điện thoại 16px), đầu cách trên 20px, đầu–nội dung 16px; nội dung không bọc thẻ nền xám + viền.
- Kịch bản: khi mở hộp Viết bài thì nền hộp là màu card và không có thẻ lồng [test: e2e/community-web/cr195-composer-dialog.cm.ts » hộp Viết bài 1280px: nền trắng, không có thẻ lồng, nút Đăng bài trong khung nhìn]
- Kịch bản: khung hộp dùng token card và lề 24/16px [test: apps/workspace-web/src/components/ui/dialog.test.tsx » nền hộp là token card, không còn background]

### MODIFIED community/hien-thi.md
#### Yêu cầu: Hộp Viết bài trên điện thoại
Toàn màn hình, ô viết giãn, «Ai thấy bài» một hàng, thanh dưới dính đáy.
- Kịch bản: khi mở ở 390px thì nút Đăng bài nằm trong khung nhìn, sát đáy [test: e2e/community-web/cr195-composer-dialog.cm.ts » hộp Viết bài 390px: nền trắng, không có thẻ lồng, nút Đăng bài trong khung nhìn]
