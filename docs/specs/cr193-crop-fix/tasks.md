---
id: cr193-crop-fix
lát: cr193-crop-fix
cr: CR-193
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
UAT bản test: hộp cắt ảnh đại diện/bìa (CR-192) mở ra TRỐNG. Tìm gốc, test đỏ, sửa.

## Làm
- [x] Gốc: canvas nằm trong Portal của Radix Dialog (gắn SAU lần render đầu); hiệu ứng vẽ chỉ chạy theo render của `ImageCropDialog` ⇒ lần đầu `cv.current` null ⇒ không vẽ; chỉ khi kéo/phóng mới render lại. e2e C1 đi qua thanh phóng nên không bắt được.
- [x] `ImageCropDialog.tsx`: giữ canvas trong state (callback ref) ⇒ gắn xong thì render lại và vẽ.
- [x] e2e mới `cr193-crop-paint.cm.ts` (đại diện + bìa, bản build production, mock): có điểm ảnh đã vẽ ngay khi mở. Đỏ trước sửa, xanh sau.

## Không làm / Chạm
Không đổi phần khác của Community. Chạm: `apps/workspace-web/src/shared/image-crop/ImageCropDialog.tsx`, `e2e/community-web/cr193-crop-paint.cm.ts`, `tests/.lock`.

## Test tối thiểu
`bunx playwright test --config e2e/community-web/playwright.config.ts cr193-crop-paint` → 2 xanh.

## Quyết định trong lúc làm
- Không dựng unit DOM (repo không có happy-dom/jsdom); dùng e2e mock `.cm.ts` (build production, đúng môi trường lỗi).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa lỗi để đúng BR-192-1..4 — hộp cắt vẽ ảnh ngay khi mở).

## Việc còn lại
Xác nhận lại trên bản test sau deploy.
