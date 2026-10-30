---
id: fnr-canvas
lát: fnr-canvas
cr: CR-103
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Canvas quy trình kéo thả kiểu n8n + nút "Sắp xếp" + nhánh Đúng/Sai dễ đọc.
- Contract: `stage.ui?: { y }` (tuỳ chọn, strict, chỉ-UI; engine/luật def bỏ qua; snapshot cũ không có vẫn đọc được) ở `hub-admin/process-ui.ts`.
- FE: `StageDraft.uiY` ↔ `ui.y`; kéo thả: x chốt cột gần nhất (đổi bước theo luật cũ, cột đầy ⇒ trượt về + báo lỗi), y tự do và lưu cùng "Lưu".
- `layoutSteps`: làn theo nhánh If, y đã lưu thắng toạ độ tự động; "Sắp xếp" xoá mọi `ui.y`.
- Cạnh If: Đúng = nét liền xanh, Sai = nét đứt xám, nhãn viên thuốc, smoothstep; cả hai ra mũi phải node If.
- Showcase dùng cùng bố cục (chỉ đọc); sửa chữ "canSwap sẽ có ở bước R3".

## Làm
- [x] contract `ui` + test; [x] draft/convert/ops; [x] layout làn + test; [x] BranchEdge/IfNode/toolbar; [x] i18n vi/en
- [x] int round-trip `tests/acceptance/fnr-canvas/ui-roundtrip.int.test.ts`; [x] e2e `e2e/fnr-showcase/canvas.fnr.ts`

## Không làm / Chạm
Không đổi engine, không migration (stages là JSONB). Không thêm thư viện layout.

## Test tối thiểu
Unit layout/contract/convert; một int round-trip `ui`; e2e fnr-showcase (kéo dọc + Lưu + tải lại; Sắp xếp).

## Quyết định trong lúc làm
- Làn: Đúng nhỏ hơn Sai ⇒ bước chỉ-Đúng lên làn TRÊN; Đúng lớn hơn Sai (Đúng nhảy qua) ⇒ bước chỉ-Sai xuống làn DƯỚI để nhánh đi thẳng không bị cạnh chéo qua node.
- Chỉ lưu `y` (x suy từ bước); kẹp -5000…20000; làm tròn khi gửi.
- Kéo không đổi vị trí (< 1 px) ⇒ không ghi `ui`; cột đầy ⇒ không ghi `ui`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-30 (đợt CR-103)

### ADDED engine/flow-engine.md
#### Yêu cầu: Canvas kéo thả và Sắp xếp
Canvas quy trình cho kéo node tự do theo chiều dọc (vị trí lưu cùng "Lưu" trong trường chỉ-UI `ui.y` của giai đoạn, engine bỏ qua); thả sang cột bước khác thì đổi bước theo luật cũ (cột đầy 3 thì trượt về). Nút "Sắp xếp" xoá vị trí đã lưu và xếp theo làn: giai đoạn chỉ chạy qua nhánh Đúng của node If nằm làn trên, nhánh Sai đi thẳng làn chính, hai nhánh nhập lại ở bước chung. Cạnh Đúng nét liền, cạnh Sai nét đứt, đều có nhãn chữ.
- Kịch bản: khi kéo node theo chiều dọc rồi Lưu thì tải lại vẫn giữ vị trí
- Kịch bản: khi kéo node sang cột bước khác thì bước của node đổi
- Kịch bản: khi bấm Sắp xếp thì node nhánh Đúng nằm làn trên, nhánh Sai đi thẳng
