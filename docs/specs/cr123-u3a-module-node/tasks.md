---
id: cr123-u3a-module-node
lát: cr123-u3a-module-node
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: p25 (canvas), u3b (hiển thị) dùng helper của lát này
---
## Plan (ngắn)
FLOW3-FR-14: node module nhiều stage (Ký số = gửi + chờ) là MỘT cụm stage liên tiếp. Luật thuần ở contracts (`process-module-nodes.ts`);
Hub chặn lưu cụm sai; editor chèn / sửa / xoá / sao chép cả cụm.

## Làm
- [x] contracts `hub-admin/process-module-nodes.ts`: `moduleClusters`, `clusterOf`, `moduleClusterIssues`, `clusterIssueMessage`; lỗi 422 `FLOW_NODE_SPLIT`.
- [x] hub: `clusterCheck` ở tạo/sửa def công ty + xuất bản Thư viện (O(stage), 0 SQL).
- [x] menu "+": bỏ mục "Chờ ký xong"; "Ký số" chèn cả cụm, chờ 168 giờ, nhánh từ chối/huỷ/hết hạn → Kết thúc · Từ chối nếu có.
- [x] panel: bấm stage nào của cụm cũng mở MỘT panel (`StageCluster`), tên đổi cả cụm; ẩn panel chờ sự kiện chung.
- [x] ops: `ops.remove(uid)`, `ops.duplicate(uid)`, `d.removeStage` / `d.duplicateStage` đi cả cụm; `expandToClusters` cho p25.

## Không làm / Chạm
Không vẽ canvas (u3b), không kéo-thả / phím (p25), không `components/canvas/**`, không migration.

## Test tối thiểu
unit: cụm (contracts + `lib/module-cluster`), menu; int: lưu cụm tách ⇒ 422.

## Quyết định trong lúc làm
- Cụm khớp theo `executor.kind` từng stage của manifest (không theo `step`); thứ tự mảng quyết định.
- Lỗi: một mã `FLOW_NODE_SPLIT` cho tách / thiếu / đảo / stage lạ chen; `details.nodes[{node,label,rule,path}]`.
- `FlowCtx.patchStages` (nhiều stage một lần đổi) thay chuỗi `patchStage` — tránh lần sau ghi đè lần trước do đóng gói `stages` cũ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Node module là MỘT ô (cụm stage)
Node của app có nhiều stage (Ký số = gửi + chờ ký xong) là một cụm stage liên tiếp, đủ và đúng thứ tự như manifest. Lưu mà cụm bị tách, thiếu, đảo thứ tự hoặc có stage lạ chen giữa bị từ chối 422 `FLOW_NODE_SPLIT` với câu "Bước Ký số bị tách rời — xoá rồi thêm lại bước Ký số".
- Kịch bản: khi stage lạ chen giữa gửi và chờ thì phát hiện split kèm tên bước [test: packages/contracts/src/hub-admin/process-module-nodes.test.ts » stage lạ chen giữa ⇒ split, chỉ rõ bước + câu nghiệp vụ]
- Kịch bản: khi lưu def có cụm Ký số bị tách thì Hub trả 422 FLOW_NODE_SPLIT và không lưu [test: apps/hub-api/src/modules/processes/defs/defs-node-config.int.test.ts » stage lạ chen giữa gửi và chờ ⇒ 422 + message có tên bước + cách sửa, không lưu]

#### Yêu cầu: Menu "+" chỉ một mục Ký số
Menu "+" của công ty không có mục "Chờ ký xong"; "Ký số" chèn cả hai stage (chờ 168 giờ).
- Kịch bản: khi mở menu "+" của công ty thì không có mục Chờ ký xong [test: apps/admin-web/src/features/processes/lib/node-menu.test.ts » công ty: Duyệt · Nếu · Ký số · Thông báo · Kết thúc, không có Nâng cao và không có 'Chờ ký xong' riêng]
- Kịch bản: khi thêm Ký số thì được hai stage cùng node, tool rồi chờ sự kiện [test: apps/admin-web/src/features/processes/lib/module-cluster.test.ts » nodeToPatches cho 2 stage cùng node, tool rồi wait_event, chờ 168 giờ]

#### Yêu cầu: Xoá và sao chép đi cả cụm
Xoá hoặc sao chép bất kỳ stage nào của cụm tác động lên cả cụm; nhánh chờ ký mặc định về Kết thúc · Từ chối nếu flow có.
- Kịch bản: khi xoá một stage của Ký số thì cả hai stage mất [test: apps/admin-web/src/features/processes/lib/module-cluster.test.ts » xoá một stage của cụm ⇒ mất cả hai, bước nén lại]
- Kịch bản: khi sao chép Ký số thì được thêm cả hai stage, vẫn hai cụm hợp lệ [test: apps/admin-web/src/features/processes/lib/module-cluster.test.ts » sao chép ⇒ cả hai stage, nối tiếp ngay sau cụm gốc, mã/uid mới, vẫn là hai cụm hợp lệ]
- Kịch bản: khi flow có Kết thúc · Từ chối thì nhánh từ chối/huỷ/hết hạn của phần chờ về đó [test: apps/admin-web/src/features/processes/lib/module-cluster.test.ts » có Kết thúc · Từ chối ⇒ declined/voided/timeout đều về bước đó]

## Việc còn lại
- u3b: vẽ MỘT ô với 3 đầu ra (nhập `moduleClusters` / `clusterOf` từ `@ai/contracts/hub-admin` hoặc `lib/module-cluster`).
- p25: Delete / Ctrl+C gọi `ops.remove(uid)` / `ops.duplicate(uid)` hoặc `expandToClusters(stages, uids)`; `use-workbench.remove` (canvas/) chọn stage kế có thể nằm trong cụm sắp xoá.
- e2e `e2e/journey-approval/cr122-editor.spec.ts:105` còn kỳ vọng mục `waitEsign` trong menu (khoá test — qc sửa).
