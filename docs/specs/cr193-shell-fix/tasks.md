---
id: cr193-shell-fix
lát: cr193-shell-fix
cr: CR-193
làn: nhanh
migration: không
phụ thuộc: cr193-shell
---
## Plan (ngắn)
e2e cr193-scroll đỏ: trang Đối tác có bố cục `board` ⇒ `main` đứng yên, khung bên trong cuộn ⇒ code cuộn sót khung này.

## Làm
- [x] `Shell.tsx`: khung `board` gắn `data-scroll-restoration-id="main-scroll-board"`; `scroll-policy.ts` thêm vào `scrollToTopSelectors`.
- [x] e2e: viewport 1280×720, cuộn đúng khung board, đo cùng khung.

## Không làm / Chạm
Chạm `Shell.tsx`, `scroll-policy.ts`, `cr193-scroll.cw.ts`.

## Test tối thiểu
unit scroll-policy; tsc web-kit + workspace-web.

## Quyết định trong lúc làm
- Lỗi do code (khung board bị sót), không chỉ do test.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa nốt phạm vi BR-193-7 đã ghi ở cr193-shell cho trang board).

## Việc còn lại
Chạy lại e2e cr193-scroll cuối đợt.
