---
id: CR-118-flow-canvas
requirements: UW-FR-14 (tenant chỉ xem sơ đồ), ADM-FR-71 (editor canvas), CR-106/108/113 (canvas duyệt)
design: spec.md §6b
trạng thái: Đang làm (lát `cr118-flow-canvas`, 2026-11-04)
---
# Phụ lục · Sơ đồ flow dùng chung (`@ai/flow-canvas`)

## 1. Vấn đề
Ba nơi vẽ sơ đồ quy trình bằng ba cách: admin-web `ProcessCanvas` (xyflow, sửa được), sohoptac-web `FlowCanvas` (xyflow, chỉ đọc, tenant, CR-106/108/113) và admin-web `SlotFlowView` (CSS + bảng, chỉ đọc, thẻ khe ở `/apps`). Người dùng chốt (2026-11-04): MỘT gói dùng chung.

## 2. Quyết định
- Gói `packages/flow-canvas` (`@ai/flow-canvas`), `@xyflow/react` ghim đúng `12.11.6` (bản hai web đang dùng). Gói KHÔNG import `apps/**`, không `react-i18next`, không token riêng: chữ (nhãn) vào qua props/context, lớp CSS mặc định theo token shadcn (có ở cả hai theme), host đè từng lớp bằng `theme`.
- Hai cửa công khai (apps chỉ import hai cửa này; depcruise `flow-canvas-public-entry`):
  - `@ai/flow-canvas` — nặng (xyflow, React): CHỈ nạp lười (`import()` ở host; tên chunk `canvas` ở admin, `flow-canvas` ở sohoptac ⇒ `canvas-vendor`/`canvas-xyflow` giữ ngân sách 80 KB).
  - `@ai/flow-canvas/pure` — hàm thuần không xyflow runtime (`buildFlowCanvas`, `conditionLabel`, `layoutSteps`, hằng, registry) dùng được ở gói chính.
- Bố cục gộp hai kiểu trong một mô-đun layout thuần: `columns` (cột theo bước + làn If, của editor) và `vertical` (Bắt đầu → bước → Ghi Đã duyệt, của sơ đồ duyệt). Toạ độ node/cạnh giữ nguyên từng điểm so với bản cũ (test snapshot).
- Chế độ: `mode: "view" | "edit"`. `view` = không kéo/nối/chọn; `edit` thêm kéo, và các móc do host cấp (`onNodeDrag`, `onNodeDragStop`, `onNodesChange`, `handlers`). Nội dung nghiệp vụ của node giai đoạn (`stage`, `if`) do host cấp qua `nodeTypes` (admin-web giữ `StageBody`/`stage-view` vì phụ thuộc bản nháp); node khung (`stepHeader`, `join`, `start`, `step`, `finalize`) và cạnh (`back`, `branch`) nằm trong gói.
- Registry loại bước `STEP_KINDS: {[K in FlowStepKind]: …}` (`FlowStepKind` của `@ai/contracts`): thiếu loại ⇒ lỗi typecheck; loại lạ (vd bước DLC) ⇒ `genericStepKind` (không huy hiệu, vẫn vẽ). KHÔNG sửa mã/biểu mẫu DLC.
- Hiển thị giữ nguyên: chữ "(mặc định)" của nhóm chuyển cấp (CR-113), cảnh báo `escalateMissing`, nhánh bỏ qua nét đứt (CR-108), mờ bước bị bỏ qua theo xem trước.

## 3. Ba nơi dùng
| Nơi | Cách dùng |
|---|---|
| sohoptac-web Cài đặt › Quy trình duyệt (tenant, chỉ xem) | `FlowCanvas mode="view"` + layout `vertical`, lười chunk `flow-canvas` |
| admin-web editor quy trình (`ProcessCanvas`) | `FlowCanvas mode="edit"` + layout `columns`; host cấp `stage`/`if` node + `ops` |
| admin-web `/apps/$appKey` › Quy trình (thẻ khe) | cùng `FlowCanvas mode="view"` + `vertical`; bảng bước giữ bên dưới |

## 4. Kiểm
Unit: layout (snapshot vị trí node/cạnh = bản cũ), registry đủ loại + loại lạ, hai chế độ. Hồi quy: e2e admin canvas + baseline sohoptac-web (`contracts-web root`). `check:bundle` hai web xanh; depcruise: apps chỉ import cửa công khai.
