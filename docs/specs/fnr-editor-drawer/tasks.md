---
id: fnr-editor-drawer
lát: fnr-editor-drawer
cr: CR-103
làn: nhanh
migration: không
phụ thuộc: fnr-canvas-fit
---
## Plan (ngắn)
Editor quy trình, view Canvas: canvas toàn khung (cao min(70vh, 640px)); chi tiết giai đoạn là ngăn phải đè lên canvas (không modal, không làm mờ trang, không bẫy focus), rộng 460px (< 768px: toàn khung), nút X + Esc đóng ⇒ bỏ chọn. View "Danh sách" giữ nguyên cột bên.

## Làm
- [x] `StagePanel` biến thể `drawer` (vẫn `complementary` "Chi tiết giai đoạn"), `use-workbench` giữ `open`/`close`
- [x] `ProcessCanvas`: `inset` (fit chừa ngăn lúc fit; chọn node dưới ngăn ⇒ pan vào; mở/đóng ngăn KHÔNG fit lại); `revealDx` (unit)
- [x] i18n `process.admin.canvas.drawer.close`

## Quyết định trong lúc làm
- Mặc định MỞ ngăn khi tải (chọn sẵn giai đoạn 1): e2e khoá (E-PB2-01, P-d, P-c2) mong panel luôn có sẵn. Hệ quả: lúc tải flow vừa phần trái ngăn (zoom nhỏ hơn); đóng ngăn rồi "Sắp xếp" thì fit toàn khung.
- Fit tự tính viewport (`getViewportForBounds`) thay vì padding có đơn vị của fitView (cho kết quả sai ở xyflow 12.11).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/flow-engine.md
#### Yêu cầu: Editor canvas toàn khung, chi tiết dạng ngăn kéo
Ở view Canvas của editor quy trình, canvas chiếm toàn bề rộng thẻ Giai đoạn; chi tiết giai đoạn là ngăn bên phải đè lên canvas (không modal, canvas vẫn thao tác được), có nút đóng (X) và đóng bằng Esc.
- Kịch bản: khi chọn một node thì ngăn chi tiết trượt ra bên phải đè lên canvas
- Kịch bản: khi đóng ngăn (X hoặc Esc) thì bỏ chọn node và canvas giữ nguyên khung nhìn