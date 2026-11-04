---
id: cr118-flow-canvas
lát: cr118-flow-canvas
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: cr118-move
---
## Plan (ngắn)
Ba cách vẽ sơ đồ quy trình (admin `ProcessCanvas`, sohoptac `FlowCanvas`, admin `SlotFlowView`) ⇒ MỘT gói `packages/flow-canvas` (`@ai/flow-canvas`). Spec: `docs/specs/CR-118/spec-flow-canvas.md` (§6b của `spec.md`).
- Gói: bố cục thuần (`columns` của editor + `vertical` của sơ đồ duyệt), node khung + cạnh, registry loại bước đủ `FlowStepKind` (loại lạ/DLC vẽ chung), `mode: "view" | "edit"`; chữ qua props, lớp CSS theo token shadcn + `theme` đè.
- Hai cửa công khai: `@ai/flow-canvas` (nặng, chỉ nạp lười) và `@ai/flow-canvas/pure` (thuần). depcruise: apps chỉ import hai cửa này.
- Host chuyển sang gói: admin `ProcessCanvas` (edit), sohoptac `FlowCanvas` (view), admin `SlotFlowView` (view); xoá bản trùng.

## Làm
1. Spec + Delta (xong trước code).
2. Gói + unit (snapshot bố cục = bản cũ, registry).
3. Chuyển 3 host, giữ chữ/hình/`data-testid`; `@source` Tailwind cho gói; depcruise; relock.

## Không làm / Chạm
- Không sửa mã/biểu mẫu DLC; không đổi hành vi, chữ, hình; không đụng `platform/flow`, `features/contract-approval` (lát flow-web), `shell/`, `routes/community*`, `modules/community`, `platform/features` (lát shell).
- Node giai đoạn (`stage`, `if`) của editor giữ ở admin-web (phụ thuộc bản nháp) — host cấp qua `nodeTypes`.

## Test tối thiểu
- unit: `bun test packages/flow-canvas`; sohoptac/admin unit của file đụng tới.
- e2e MỘT lần trên evotest: `-Filter "contracts-web root"` -All (đỏ có sẵn: cr052 showcase, m4-2fa D11).

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Sơ đồ quy trình duyệt đang dùng của tenant dùng gói sơ đồ chung (CR-106/108/113, UW-FR-14)
Sơ đồ chỉ đọc trong Cài đặt › Quy trình duyệt do gói chung `@ai/flow-canvas` vẽ (chế độ chỉ xem), nạp lười; hình, chữ, nhánh bỏ qua, "(mặc định)" của nhóm chuyển cấp và cảnh báo cấu hình giữ nguyên như trước.
- Kịch bản: khi có ba bước và bước hai có điều kiện thì sơ đồ xếp dọc Bắt đầu → bước → Ghi Đã duyệt, kèm nhánh bỏ qua nét đứt [test: packages/flow-canvas/src/layout/vertical.test.ts » nhánh bỏ qua (CR-108): bước có điều kiện (không phải bước đầu) ⇒ cạnh nét đứt từ node liền trước sang node liền sau]
- Kịch bản: khi nhóm chuyển cấp là mặc định thì dòng chuyển cấp có chữ "(mặc định)", khi nhóm đã bị xoá thì hiện cảnh báo thay dòng chuyển cấp [test: packages/flow-canvas/src/layout/vertical.test.ts » chiều cao node theo số dòng thông tin (chuyển cấp / cảnh báo thiếu nhóm)]
- Kịch bản: khi mở Cài đặt › Quy trình duyệt thì sơ đồ vẫn hiện đủ Bắt đầu, bước và Ghi Đã duyệt, bước bị bỏ qua theo xem trước thì mờ [test: e2e/contracts-web/approval-current.cw.ts » Cài đặt hiện quy trình đang dùng, không có form sửa]
- Kịch bản: khi loại bước là loại lạ (DLC) hay `form` thì sơ đồ vẫn vẽ chung, không huy hiệu riêng, không lỗi [test: packages/flow-canvas/src/registry.test.ts » loại lạ (DLC) ⇒ vẽ chung, không huy hiệu]

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Canvas editor quy trình dùng gói sơ đồ chung (ADM-FR-71)
Canvas của trình soạn quy trình do `@ai/flow-canvas` vẽ ở chế độ sửa: bố cục cột theo bước, làn Đúng/Sai của node If, cạnh quay lại/rẽ nhánh, kéo thả chốt cột. Bố cục và hành vi giữ nguyên toạ độ từng điểm; node giai đoạn do admin-web cấp.
- Kịch bản: khi có các giai đoạn song song và nhánh If thì toạ độ node và cạnh bằng đúng bản trước khi gộp gói [test: packages/flow-canvas/src/layout/columns.test.ts » snapshot bố cục cột: toạ độ node và cạnh giữ nguyên (song song, quay lại, If)]
- Kịch bản: khi thả node thì cột gần nhất được chọn và độ dịch để node không nằm dưới ngăn chi tiết đúng như trước [test: packages/flow-canvas/src/layout/columns.test.ts » stepFromDropX: cột gần nhất, vượt cuối ⇒ bước mới, revealDx]
- Kịch bản: khi bật chế độ chỉ xem thì node không kéo được, chế độ sửa thì kéo được và gọi móc của host [test: packages/flow-canvas/src/mode.test.ts » mode view khoá kéo/nối/chọn, edit chỉ mở kéo]
- Kịch bản: khi mở canvas ở trình soạn thì các nút giai đoạn và panel chi tiết vẫn hiện như trước [test: e2e/P-b2/admin/canvas.pb2.ts » ADM-FR-71 · E-PB2-01 · mở pb2-canvas ⇒ application 'Canvas quy trình', 4 nút 'Giai đoạn n: …', panel 'Chi tiết giai đoạn' chọn sẵn Giai đoạn 1]

### MODIFIED admin/ung-dung-quyen.md
#### Yêu cầu: Tab Quy trình của app dùng cùng gói sơ đồ chung (ADM-FR-84)
Thẻ khe ở `/apps/<key>` › Quy trình hiện sơ đồ chỉ xem do cùng `@ai/flow-canvas` vẽ (Bắt đầu → bước → Ghi Đã duyệt, khoá), nạp lười; bảng bước giữ bên dưới.
- Kịch bản: khi khe có bước duyệt và bước ký thì sơ đồ xếp dọc kèm huy hiệu loại bước và điều kiện [test: packages/flow-canvas/src/layout/vertical.test.ts » dòng bước đã gắn nhãn điều kiện (host tự ghép chữ) vẫn dựng đúng nhánh bỏ qua]
- Kịch bản: khi bước có hạn và nhắc thì node hiện một dòng thông tin thời hạn [test: packages/flow-canvas/src/layout/vertical.test.ts » chiều cao node theo số dòng thông tin (chuyển cấp / cảnh báo thiếu nhóm)]

## Việc còn lại
