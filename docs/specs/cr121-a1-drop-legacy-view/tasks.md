---
id: cr121-a1-drop-legacy-view
lát: cr121-a1-drop-legacy-view
cr: CR-121 (A)
làn: nhanh
migration: có (hub 0099)
phụ thuộc: cr120-single-source (0091), hub 0096 (cột source)
---
## Plan (ngắn)
Gỡ view cũ `hub.process_slot_assignments` (0091) và đường `legacy-act` (web). Nguồn gán duy nhất = `process_tenant_defs` + `process_routing_rules` (`is_default`, cột `source`).

## Làm
- [x] Grep mọi chỗ đọc/ghi `process_slot_assignments`: code chạy thật KHÔNG còn chỗ nào đọc (resolve/route/ops/slot-assign đã dùng nguồn mới từ CR-120); còn lại: khai báo Drizzle `processSlotAssignments` (không ai import → xoá), test int đọc view → chuyển sang `process_routing_rules where is_default`, comment.
- [x] Migration `packages/db/migrations-hub/0099_drop_slot_assign_view.sql` + journal idx 84: DROP VIEW chỉ khi relkind = 'v' (không động tới bảng cùng tên ở DB trước 0091). Grant của view đi theo khi DROP; view không có policy riêng. Bảng `process_slot_assignments_legacy` GIỮ (đối chiếu).
- [x] Web: xoá `platform/flow/adapters/legacy-act.ts`, `LegacyActDone`/`FlowActDone`; `act` luôn đi route flow.
- [x] Test int: view không còn (slot-single-source), migrate-hub (danh sách bảng không còn view), library-rls (đọc chéo tenant trên luật mặc định), các int đọc gán chuyển nguồn.

## Không làm / Chạm
- KHÔNG gỡ máy duyệt cũ `needsLevel2` / `flowViewOfApproval` (chờ người dùng quyết công ty chưa gán chạy gì).
- Không xoá bảng `_legacy` (lát dọn dữ liệu sau). Không sửa migration cũ (0068/0089/0090/0091 giữ thứ tự: DB mới vẫn dựng rồi gỡ view).
- Đường nóng: không chạm (không đổi SQL chạy thật) ⇒ perf: không.

## Test tối thiểu
- int: `slot-single-source.int.test.ts` (view không còn; 0099 không động tới bảng; chạy lại vô hại; resolve/route đúng), `migrate-hub.int.test.ts`, các int đọc gán đã chuyển nguồn; unit web `http.test.ts`.

## Quyết định trong lúc làm
- Test đọc "gán" của tenant = luật `is_default` của tenant × khe (đúng câu view cũ dẫn xuất; join `process_tenant_defs` bỏ vì luật mặc định luôn có hàng tập gán).
- `library-rls`: bỏ 4 ca ghi qua view (55000) — view không còn; quyền ghi luật do test routing RLS sẵn có phủ.
- Runtime flow tắt (`HUB_FLOW_RUNTIME=off`): `act` không còn đường dự phòng, route 404 ⇒ lỗi hiện cho người dùng (rollback bản phát hành CR-120 đã hết nhiệm vụ).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Gán tenant × khe = đúng một quy trình
Gán tenant × khe chỉ nằm ở tập gán `process_tenant_defs` + luật `is_default` của `process_routing_rules`; view `process_slot_assignments` đã gỡ (hub 0099), không còn đối tượng cùng tên nào để đọc.
- Kịch bản: khi chạy 0099 thì view không còn, bảng `_legacy` vẫn không cấp cho hub_rw và còn dữ liệu cũ, gán hiệu lực đọc từ luật mặc định [test: apps/hub-api/src/modules/processes/library/slot-single-source.int.test.ts » CR-121 A1 · hub 0099 gỡ VIEW process_slot_assignments, gán hiệu lực đọc từ luật mặc định, bảng _legacy không cấp cho hub_rw và còn dữ liệu cũ]
- Kịch bản: khi không còn view thì resolveSlot/routeSlot vẫn đúng [test: apps/hub-api/src/modules/processes/library/slot-single-source.int.test.ts » resolveSlot/routeSlot chỉ đọc nguồn mới (không còn đối tượng process_slot_assignments)]
- Kịch bản: khi scope user đọc luật mặc định thì chỉ thấy tenant mình [test: apps/hub-api/src/modules/processes/library/library-rls.int.test.ts » chặn đọc chéo tenant bảng gán, release, khe]

### MODIFIED engine/flow-web.md
#### Yêu cầu: Hành động của task đi một đường duy nhất
`FlowRuntime.act` luôn gọi route flow của kit; đường dự phòng `legacy-act` (endpoint approvals cũ khi `HUB_FLOW_RUNTIME=off`) đã gỡ.
- Kịch bản: khi cờ runtime tắt thì act vẫn gọi route flow và lỗi 404 được ném, không có yêu cầu tới endpoint cũ [test: apps/workspace-web/src/platform/flow/adapters/http.test.ts » CR-121: cờ tắt ⇒ act KHÔNG còn đường cũ (legacy-act đã gỡ) — vẫn đi route flow, 404 ném ApiError]

## Việc còn lại
- Gỡ bảng `process_slot_assignments_legacy` sau khi prod đối chiếu xong.
- Gỡ máy duyệt cũ `needsLevel2` (chờ quyết định người dùng).
