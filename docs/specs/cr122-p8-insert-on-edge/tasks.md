# cr122-p8-insert-on-edge — nút "+" trên cạnh: chèn bước vào giữa

Trạng thái gộp: chưa gộp

Làn: nhanh (UI + hàm thuần; không RLS/quyền/migration).

## Plan ngắn
- `lib/insert-on-edge.ts` (thuần): `insertOnEdge(stages, fresh, {from,to,side?})` = `insertStepAfter` + `remapStepRefs` (step-refs.ts) rồi chỉnh đích riêng cạnh:
  cạnh Đúng/Sai ⇒ `ifx.yes|no` trỏ bước mới, bước mới có `nextStep` = đích cũ; nguồn có `next_step` tường minh tới đích ⇒ trỏ bước mới.
- `use-draft.insertOnEdge` (không remap lần hai) → `use-stage-ops.insertNodes` (node module nhiều giai đoạn nối tiếp nhau).
- `NodeMenuContent` tách từ `NodePalette` (menu Cơ bản/module/Nâng cao dùng chung); `EdgeInsertMenu` = nút "+" (testid `flow-edge-insert-<from>-<to>`).
- `@ai/flow-canvas`: cạnh kiểu `forward` + `InsertSlot` (hiện khi rê chuột lên cạnh/nút, luôn hiện khi `hover: none`), `renderEdgeInsert` ở host; `BranchEdge` có "+" cho cạnh Đúng/Sai.
- Chỉ hiện khi sơ đồ sửa được và có bảng node (flow ctx); sơ đồ chỉ đọc/thư viện không đổi.

## Quyết định trong lúc làm
- Cạnh Đúng/Sai: bước mới chèn ngay trước bước đích (sau bước Nếu nếu liền kề); bước đứng sát trước đích (nếu không phải Nếu) sẽ đi tuần tự vào bước mới — chấp nhận, ghi chú.
- Cạnh từ node "Bắt đầu khi" và cạnh cầu nối/cạnh quay lại không có "+".

## Delta (so với docs/current)

Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-web.md
#### Yêu cầu: Chèn bước vào giữa hai bước bằng nút "+" trên cạnh
Mỗi cạnh tiến giữa hai node và mỗi cạnh Đúng/Sai của node Nếu có nút "+" ở giữa (hiện khi rê chuột lên cạnh, luôn hiện trên màn cảm ứng) mở menu "Thêm bước" giống nút "+ Thêm bước"; chọn một node thì node đó được chèn vào giữa hai node, bước sau dời xuống và mọi đích (goto, next_step, từ chối/trả lại, nhánh, nguồn field) được đánh lại số.
- Kịch bản: khi chèn một node vào cạnh giữa hai bước tuần tự thì bước sau dời xuống một và các đích trỏ tới các bước sau vẫn trỏ đúng bước cũ [test: apps/admin-web/src/features/processes/lib/insert-on-edge.test.ts » chèn giữa hai bước tuần tự ⇒ bước sau dời xuống, đích cũ đánh lại]
- Kịch bản: khi chèn vào cạnh Đúng của node Nếu thì node mới nằm trên nhánh Đúng, đi tiếp tới đích cũ của nhánh Đúng và nhánh Sai giữ nguyên đích [test: apps/admin-web/src/features/processes/lib/insert-on-edge.test.ts » chèn trên nhánh Đúng của Nếu ⇒ bước mới nằm trên nhánh Đúng, nhánh Sai giữ đích]
- Kịch bản: khi bước nguồn có next_step tường minh tới đích của cạnh thì sau khi chèn next_step trỏ node mới và node mới đi tiếp tới đích [test: apps/admin-web/src/features/processes/lib/insert-on-edge.test.ts » nguồn có next_step tường minh tới đích ⇒ next_step trỏ bước mới, bước mới đi tiếp tới đích]

## Việc còn lại
- e2e hành trình (chèn Thông báo giữa Ký số và Kết thúc) viết/chạy ở đợt e2e cuối CR-122; chưa chụp màn hình.
