---
id: cr122-a-auto-facts
lát: cr122-a-auto-facts
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: gd0 16205281a (N1/N2/E4/E5/E6)
---
## Plan (ngắn)
Flow bắt đầu từ một bản ghi ⇒ mọi bước tự biết bản ghi đó: đầu ra của Bắt đầu khi = `record` + mọi fact của sự kiện, có ở MỌI cạnh;
lúc mở lượt input của run có `record` + facts; tool của node tự nhận đầu vào trùng khoá. Cầu nối AI chỉ còn cho tool lạ.

## Làm
- [x] Manifest: `AppEventDecl.record {key, label{vi,en}}` (contracts: `contract_id` "Hợp đồng"; community: `post_id`/`join_id`/`report_id`); `AppNodeIo.label?{vi,en}` (+ `ioLabel`, vắng ⇒ khoá); `AppFactDecl.label_en?` (vắng ⇒ `label`).
- [x] `start-outputs.ts`: `startOutputsOf`, `recordInputsOf`; `index.ts`: `eventOf`, `defStartOutputs`.
- [x] `flowEdgeIssues`/`flowStageOutputs`: def có `app` + `trigger` ⇒ đầu ra Bắt đầu khi có ở mọi cạnh. Issue thêm `from_name`, `to_name`, `labels[{key,vi,en}]`.
- [x] Mở lượt (`flow-launch` → `start.service`): cùng câu ghi `flow_event_id` nối `record` + facts vào `process_runs.inputs` (khoá đã có thắng).
- [x] Tool (`tool-stage-load.repo`): đầu vào của node (manifest, theo `stage.node`) chưa có nguồn khai rõ mà có trong input lượt ⇒ tự lấy (`autoArgKeys`).

## Hợp đồng cho UI (admin-web, agent UI)
`FlowEdgeWarning` thêm (tuỳ chọn): `from_name`, `to_name` (tên bước; vắng ⇒ khoá), `labels: [{key, vi, en}]` cho từng khoá trong `missing`/`typeMismatch`.
Câu gợi ý: "Bước «{to_name}» cần «{labels[k].vi}»". Kiểm cạnh phía FE nên truyền `app` + `trigger` của bản nháp để có cùng kết quả.

## Quyết định trong lúc làm
- Fact giữ `label: string` (vi) + `label_en?` thay vì đổi sang `{vi,en}` — tránh vỡ chỗ đọc `label` ở admin-web/workspace-web (không được sửa trong lát này).
- Lưu def cập nhật một phần (body không có `trigger`/`app`) ⇒ kiểm cạnh không thấy đầu ra Bắt đầu khi (như cũ); trình sửa gửi trọn def.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Dữ liệu bản ghi tự nối
- Kịch bản: flow G1 không còn báo thiếu contract_id [test: packages/contracts/src/app-manifest/start-outputs.test.ts » flow G1 có app + trigger ⇒ 0 issue (Ký số tự nhận contract_id qua mọi bước)]
- Kịch bản: issue có tên bước + nhãn trường [test: packages/contracts/src/app-manifest/start-outputs.test.ts » không có trigger ⇒ vẫn báo thiếu, kèm tên bước + nhãn trường]
- Kịch bản: Ký số nhận contract_id thật không cần Ghi giá trị [test: apps/hub-api/src/modules/processes/adapters/tools/tool-auto-args.int.test.ts » contract.submitted ⇒ Ký số nhận đúng contract_id thật (không cần node Ghi giá trị)]
- Kịch bản: nguồn khai rõ thắng [test: apps/hub-api/src/modules/processes/adapters/tools/tool-auto-args.int.test.ts » nguồn khai rõ thắng (args có contract_id ⇒ không ghi đè)]
- Kịch bản: cầu nối không gọi AI khi đã khớp [test: apps/hub-api/src/modules/processes/bridge/bridge.routes.test.ts » CR-122 · A · flow của app có trigger ⇒ cạnh vào Ký số đã khớp (contract_id từ Bắt đầu khi), không gọi AI]

## Việc còn lại
- (5) Xem trước bằng HĐ mẫu dùng cùng cơ chế `recordInputsOf` (`app-manifest/preview.ts`) — chưa nối.
- (6) Seed flow mẫu "Duyệt HĐ" không có trong worktree này (đã kiểm bằng flow G1 dựng lại trong unit); kiểm trên seed thật khi Q1 chạy.
- int đi qua dispatcher → `start.service` (SQL nối `inputs`) chưa có riêng; đã kiểm đường đọc tool.
