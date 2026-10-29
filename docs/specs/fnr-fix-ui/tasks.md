---
id: fnr-fix-ui
lát: fnr-fix-ui
cr: CR-103
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Chỉnh giao diện trang showcase / canvas theo ảnh chụp thật.

## Làm
- [x] Canvas: node If chỉ còn đúng hai cạnh có nhãn Đúng/Sai tới giai đoạn đầu của bước đích (không cạnh tiến thường, không cạnh tới tiêu đề bước ⇒ hết mũi tên treo/đường vòng); tên node If xuống dòng đủ chữ (title khi hover); handle Đúng bên phải, Sai bên dưới.
- [x] `ProcessCanvas` thêm `compact` (cao 280 px, fit sát khung, không thanh zoom) cho trang showcase; mặc định các nơi khác giữ 520 px.
- [x] `RunActions`: ẩn "Huỷ lượt chạy" khi run đã `done/cancelled/failed/expired` (cả trang chạy thường).
- [x] Unit: `canvas-layout.test.ts` thêm ca node If.

## Không làm / Chạm
Không đụng đánh giá If / facts (agent khác), không đổi `showcase.fnr.ts`.

## Test tối thiểu
Unit canvas-layout; xem ảnh chụp Playwright tạm (không commit).

## Quyết định trong lúc làm
- Sửa ở `layoutSteps` (thuần) thay vì ở edge component: cạnh If tới stage, nên `BranchEdge` giữ nguyên cho luật `after.branch` cũ (vẫn tới tiêu đề).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉnh giao diện showcase/canvas)