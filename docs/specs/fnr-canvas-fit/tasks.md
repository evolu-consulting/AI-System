---
id: fnr-canvas-fit
lát: fnr-canvas-fit
cr: CR-103
làn: nhanh
migration: không
phụ thuộc: fnr-canvas
---
## Plan (ngắn)
Canvas editor tự vừa khung: fitView khi tải lần đầu, sau "Sắp xếp", khi khung đổi cỡ (mở/đóng panel, resize); zoom tối thiểu 0.3; giữ pan/zoom tay ở các lúc khác.

## Làm
- [x] `ProcessCanvas`: FIT minZoom 0.3, refit theo cỡ khung (`useStore` width/height), neo mép trái chỉ khi flow rộng hơn cả mức zoom nhỏ nhất.

## Quyết định trong lúc làm
- Min zoom 0.3 (không 0.4): ở 1280 px flow 5 bước chỉ vừa khung khi zoom ~0.3.
- Flow quá rộng ngay cả ở 0.3 ⇒ neo trái x=16 (E-PB2-12 cần node 1 bấm được).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: canvas editor tự vừa khung)
