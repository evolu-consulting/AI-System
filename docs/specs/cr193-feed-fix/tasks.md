---
id: cr193-feed-fix
lát: cr193-feed-fix
cr: CR-193
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa 2 ca e2e đỏ: (1) nút Lọc nổi xê dịch khi bật lọc; (2) ca «ô đăng không dính» cuộn sai vùng.

## Làm
- [x] Nguyên nhân 1: nút neo phải, huy hiệu số làm nút rộng thêm 28px ⇒ x lùi trái. Sửa CODE: huy hiệu `position:absolute` ở góc nút.
- [x] Nguyên nhân 2: `mouse.wheel` ở (0,0) nằm trên thanh bên; vùng cuộn là `main-scroll`. Sửa TEST cuộn đúng vùng (ô đăng không sticky là đúng).

## Không làm / Chạm
`styles/feed.css`, `e2e/community-web/cr191-feed-ui.cm.ts`.

## Test tối thiểu
e2e viết, chưa chạy (điều phối).

## Quyết định trong lúc làm
Huy hiệu góc nút thay vì giữ chỗ trống: không đổi kích thước nút ở mọi trạng thái.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa vị trí huy hiệu số trên nút Lọc và bộ chọn e2e; e2e/community-web/cr191-feed-ui.cm.ts).

## Việc còn lại
Không.
