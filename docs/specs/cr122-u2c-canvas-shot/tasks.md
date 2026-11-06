---
id: cr122-u2c-canvas-shot
lát: cr122-u2c-canvas-shot
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: cr122-u2b-canvas-nodes, cr122-e4, cr122-n2-bridge-ai
---
## Plan (ngắn)
Node "Bắt đầu khi" thành node thật ở cột đầu canvas (thay thẻ phía trên), cạnh vàng trên canvas, khối sửa nguồn cho node Ghi giá trị (E4), bridge theo hợp đồng N2 import từ contracts, và chụp màn hình thật bằng stack UAT riêng.

## Làm
- `canvas/TriggerNode.tsx` + `ProcessCanvas` (node `trigger` ở x = −1 cột, cạnh tới mọi bước đầu); thẻ sự kiện/điều kiện chỉ mở khi bấm node. `columns-fit.ts` neo theo mép trái thật của node ngoài cùng (cột đầu âm).
- Cạnh vàng: `FlowCtx.warnEdges` ← `edgeProblems`; nét vàng + nhãn "Thiếu dữ liệu"; hai stage cùng một node bảng không tính là cạnh.
- `StageSet`: nguồn Đầu vào · Hằng · Bước trước (field) · Dữ kiện + "Kiểu ghi" (`as`); `set-form` bỏ `keep`; `step-refs` đánh lại `step` của nguồn field khi chèn/kéo/xoá bước.
- Flow có trigger dùng form giai đoạn chung (không `LibraryCanvasContext` / form bước theo khe).
- `palette-api` dùng `BridgeSuggestRequest/Response` từ contracts. `tools/hub-dev/src/uat-stack.ts` (stack UAT 35xx, hướng dẫn 3 dòng đầu file).
- Sửa 1 dòng hub: `/process-palette` thiếu trong `PROCESS_PROTECTED_PREFIXES` ⇒ không JWT ⇒ 401 AUTH_EXPIRED (phát hiện khi chụp).

## Không làm / Chạm
- Node Kết thúc vẫn là node giai đoạn thường (không cột riêng); chưa chụp màn lượt "Cần xử lý" (`facts_changed`).
- Còn đường cũ cho R1: `use-company-flows.ts`, `lib/flow-rows.ts`, `JobRow` (tab Ứng dụng/Tính năng đọc "việc"), `api-routing.ts`, `routing-current.ts`, chữ "khe" ở `tenants.flows.*`/`tenants.slots.*`.

## Test tối thiểu
`bun test apps/admin-web/src/features/processes apps/admin-web/src/features/tenants` xanh (mới `set-form.test.ts`). Ảnh: `docs/specs/CR-122/shots/u2c-*.png`.

## Quyết định trong lúc làm
- Ảnh lưu ở checkout chính theo yêu cầu điều phối; DB UAT `ai_system_uat122_test`, Redis db 12 (xoá khi 429 do đăng nhập lặp).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED platform/node-bat-dau-khi-canvas.md
#### Yêu cầu: Bắt đầu khi là node thật trên canvas, Ghi giá trị chọn nguồn (FLOW2-FR-02, FLOW2-FR-26)
Canvas vẽ node "Bắt đầu khi" ở cột đầu; node Ghi giá trị chọn nguồn từ bước trước hoặc dữ kiện kèm kiểu ghi, đích `step` đúng sau khi chèn bước.
- Kịch bản: khi def có nguồn field/dữ kiện và `as` thì lưu lại đủ [test: apps/admin-web/src/features/processes/lib/set-form.test.ts » def → draft → def giữ nguyên từng nguồn và `as`]
- Kịch bản: khi chèn bước giữa thì `step` của nguồn field dời theo [test: apps/admin-web/src/features/processes/lib/set-form.test.ts » chèn bước giữa ⇒ `step` của nguồn field dời theo]

## Việc còn lại
Xem "Không làm".
