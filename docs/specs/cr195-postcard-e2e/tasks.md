---
id: cr195-postcard-e2e
lát: cr195-postcard-e2e
cr: CR-195
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa e2e đỏ sau khi gộp thẻ bài điện thoại (staging 0d0233606).

## Làm
- [x] Ca 1 (UI + test): dòng meta ép đúng một hàng (nowrap, công ty/phạm vi cắt «…», nhãn không co); test đếm số hàng chữ thay vì đo chiều cao.
- [x] Ca 2 (TEST sai): không có loại «Ghi chú»; «Thông báo» là mặc định và ở 390px nút bị khung form che ⇒ bỏ bước chọn loại.
- [ ] Ca 3 (test khoá, đề xuất): `e2e/community-web/cr191-feed-ui.cm.ts` «điện thoại: icon thẻ bài 44px…» tìm `.iconact` — ở ≤640px giờ là nút «⋯» (`post-more`). Đề xuất: đổi sang kiểm `post-more` ≥ 44×44 và không còn `.iconact`.
- [ ] Ca 4 (baseline khoá, đề xuất): chụp lại `e2e/community-web/baseline/linux/bang-tin-mobile.png` — lệch do thẻ gọn + «⋯» (đúng ý CR-195), cần người xem ảnh diff rồi chụp lại.

## Không làm / Chạm
Không sửa test/baseline khoá; không sửa `cr195-composer-dialog.cm.ts`.

## Test tối thiểu
e2e `community-web` (một lần).

## Quyết định trong lúc làm
Ca 1 là UI thật: meta có thể rớt xuống 4 hàng khi phạm vi dài.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ ép dòng meta không xuống hàng, đã nằm trong Delta cr195-postcard-mobile).
