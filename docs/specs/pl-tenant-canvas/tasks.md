---
id: pl-tenant-canvas
lát: pl-tenant-canvas
cr: CR-106
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Cài đặt › Quy trình duyệt (contracts-web) hiện quy trình đang dùng dạng danh sách chữ. Thêm **canvas chỉ đọc** giống canvas
quy trình của ai-admin (`@xyflow/react` 12.11.6, `readOnly`): Bắt đầu → từng bước (tên, phòng ban, huy hiệu Có điều kiện /
Ký số / Dify, tóm tắt điều kiện) → node hệ thống khoá "Ghi Đã duyệt". Dữ liệu = payload `GET /pack/contracts/approval-flow` đã
parse bởi `current-flow.ts`; không đổi backend/API. Platform admin sửa/gán ở admin-web như CR-105, không đụng.

## Làm
- `lib/flow-canvas.ts`: hàm thuần `buildFlowCanvas(steps, labels, run?)` (cột dọc, cách đều, không dagre) + `conditionLabel`.
- `components/FlowCanvas.tsx` (ReactFlow chỉ đọc, `data-testid="flow-canvas"`, cao 420px), `FlowCanvasNode.tsx` (3 loại node),
  `FlowCanvasLazy.tsx` (`React.lazy`, báo đang tải / lỗi + Thử lại).
- `FlowCurrentPane.tsx`: công tắc "Sơ đồ | Danh sách" (mặc định Sơ đồ; Danh sách = `Diagram` cũ, giữ `flow-diagram`); trạng thái
  "Xem trước đường đi" nâng lên `FlowLoaded` để canvas làm mờ bước bị bỏ qua.
- i18n vi + en cạnh `contracts.flow.current.*` (`v2l.*.json`); thêm `@xyflow/react` 12.11.6 vào contracts-web.
- `rsbuild.config.ts` gom xyflow vào chunk async `canvas-xyflow`; `scripts/check-bundle.ts` cho chunk `canvas-*` ngân sách 80 KB
  (giống admin-web, ADR-0013 #2).

## Không làm / Chạm
- Không đổi quyền (ai thấy mục Cài đặt này vẫn như cũ), không đổi backend/contract, không di chuyển/tách code canvas của admin-web.
- Không kéo thả/nối/xoá node; chỉ pan + zoom.

## Test tối thiểu
- Unit `flow-canvas.test.ts` (thứ tự node, node cuối khoá, nhãn điều kiện, dim theo xem trước) + `check-bundle.test.ts` (ngân sách `canvas-*`).
- e2e `e2e/contracts-web/approval-current.cw.ts` sửa (VIẾT, CHƯA CHẠY; chạy một lần cuối đợt).

## Quyết định trong lúc làm
- Điều kiện hiện ngay trên node (dòng cuối), không đặt nhãn trên cạnh: cạnh chỉ nối tuần tự, điều kiện thuộc về bước.
- Bước bị bỏ qua theo xem trước ⇒ node mờ + viền đứt + cạnh vào bước đó mờ (`data-run="false"` để e2e kiểm).
- Canvas nạp bằng `React.lazy`; xyflow ở chunk async `canvas-xyflow` 56.9 KB gzip (vượt 50 KB chung ⇒ ngân sách riêng 80 KB như admin-web).
  Chunk khởi tạo +0.4 KB gzip (171.0 → 171.4 KB). `check:bundle js > 150 KB` ĐÃ ĐỎ từ trước lát (171.0 KB khi chưa có CR-106), không sửa ở đây.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Cài đặt › Quy trình duyệt chỉ hiện quy trình đang dùng
Sơ đồ quy trình đang dùng là canvas chỉ đọc (Bắt đầu → các bước → "Ghi Đã duyệt" khoá hệ thống; mỗi bước hiện tên, phòng ban, huy hiệu Có điều kiện / Ký số / Dify và tóm tắt điều kiện), có công tắc "Sơ đồ | Danh sách" (mặc định Sơ đồ). Dữ liệu vẫn từ `GET /approval-flow`, không sửa được ở đây; "Xem trước đường đi" làm mờ bước bị bỏ qua trên canvas.
- Kịch bản: khi lập `buildFlowCanvas` cho quy trình 3 bước thì node là Bắt đầu, 3 bước theo thứ tự, "Ghi Đã duyệt" cuối cùng và bị khoá, nối tuần tự [test: thủ công — file test đã chuyển/gỡ khi hợp nhất web (CR-118) hoặc gỡ máy cũ (CR-121)]
- Kịch bản: khi bước có điều kiện giá trị / loại HĐ thì node hiện huy hiệu "Có điều kiện" và câu điều kiện nối bằng và/hoặc [test: thủ công — file test đã chuyển/gỡ khi hợp nhất web (CR-118) hoặc gỡ máy cũ (CR-121)]
- Kịch bản: khi "Xem trước đường đi" bỏ qua một bước thì node của bước đó mờ đi [test: thủ công — file test đã chuyển/gỡ khi hợp nhất web (CR-118) hoặc gỡ máy cũ (CR-121)]
- Kịch bản: khi owner mở Cài đặt › Quy trình duyệt thì thấy canvas `flow-canvas` mặc định, bấm "Danh sách" thì thấy `flow-diagram` [test: e2e/contracts-web/approval-current.cw.ts » Cài đặt hiện quy trình đang dùng, không có form sửa]
