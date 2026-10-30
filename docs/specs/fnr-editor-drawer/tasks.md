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

## qc sửa e2e khoá
- e2e/P-b2/admin/canvas.pb2.ts · E-PB2-01: thêm assertion ngăn đóng lúc tải + bấm node "Phân tích" trước khi kiểm panel Giai đoạn 1, lý do: người dùng chốt ngăn đóng mặc định 2026-10-29.
- e2e/P-b2/admin/canvas.pb2.ts · E-PB2-08: thêm `Escape` đóng ngăn trước khi bấm node "Tổng hợp" (ngăn mở đè lên node đó), lý do: ngăn đè canvas nên node dưới ngăn không bấm được; assertion giữ nguyên.

## Quyết định trong lúc làm
- Ngăn ĐÓNG mặc định (người dùng chốt 2026-10-29, kiểu n8n): tải xong chưa chọn gì, canvas fit toàn khung; bấm node / Thêm giai đoạn / Thêm bước / lỗi khi Lưu mở ngăn ở giai đoạn đó (`openReq` trong `use-draft`; nạp bản nháp không mở).
- Khi ngăn đang mở lúc fit/Sắp xếp/đổi cỡ: fit vào phần canvas bên trái ngăn.
- Fit tự tính viewport (`getViewportForBounds`) thay vì padding có đơn vị của fitView (cho kết quả sai ở xyflow 12.11).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-30 (đợt CR-103)

### ADDED engine/flow-engine.md
#### Yêu cầu: Editor canvas toàn khung, chi tiết dạng ngăn kéo
Ở view Canvas của editor quy trình, canvas chiếm toàn bề rộng thẻ Giai đoạn; chi tiết giai đoạn là ngăn bên phải đè lên canvas (không modal, canvas vẫn thao tác được), có nút đóng (X) và đóng bằng Esc.
- Kịch bản: khi tải trang thì ngăn chi tiết đóng và canvas vừa toàn khung
- Kịch bản: khi chọn một node thì ngăn chi tiết trượt ra bên phải đè lên canvas
- Kịch bản: khi đóng ngăn (X hoặc Esc) thì bỏ chọn node và canvas giữ nguyên khung nhìn