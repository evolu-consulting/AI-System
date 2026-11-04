---
id: cr118-flow-routing
lát: cr118-flow-routing
cr: CR-118
làn: đầy đủ (tenant/quyền/RLS + đường launch)
migration: hub 0087 (journal when 1803000000000)
phụ thuộc: không
---
## Plan (ngắn)
CR-118 §11.2 phần backend: nhiều quy trình được gán cho mỗi tenant × khe + luật chọn quy trình theo phòng ban người khởi tạo.
1. Migration hub 0087: `process_tenant_defs` (tập quy trình platform đã gán, PK tenant+def, UNIQUE tenant+slot+def),
   `process_routings` (đầu danh sách luật tenant × khe, `version`), `process_routing_rules` (`priority`, `condition jsonb`
   `{departmentIds}`, `def_id`, `is_default`; FK (tenant, slot, def) ⇒ tập đã gán, ON DELETE RESTRICT; ≤ 1 mặc định; priority
   0..49). RLS: đọc theo tenant; tập gán chỉ system ghi; luật ghi system hoặc user đúng tenant. Audit + `assign_process`,
   `unassign_process`, `set_routing` (enum Drizzle + CHECK).
2. Thuần `pickProcess(rules, deptAncestors)` (`library/routing.rules.ts`): luật theo priority, khớp khi giao phòng ban ≠ ∅
   (tập tổ tiên gồm phòng ban con ⇒ luật chọn phòng cha khớp người ở phòng con); không khớp ⇒ luật mặc định; không có ⇒ chặn.
3. `routeSlot(db, tenant, slot, userId)` — MỘT câu SQL cố định (luật + tổ tiên phòng ban đệ quy + bản xuất bản của def ứng
   viên + kết quả `resolveSlot` cũ). Không có luật ⇒ y hệt `resolveSlot`. `resolveSlot` (2 tham số) giữ nguyên chữ ký + câu SQL.
   Port gói thêm `routeSlot?` (tuỳ chọn) ⇒ DLC không đổi. Gói contracts: `loadStart` đọc người bắt đầu trước rồi gọi
   `slotFlowOf(d, tenant, starter)`; không khớp/không mặc định ⇒ lượt kẹt `FLOW_ROUTE_NONE`. Run ghi `process_def_id` +
   `route_rule_id` vào snapshot (qua `stampSlotRun`) ⇒ đổi luật sau không ảnh hưởng run cũ.
4. API (hub-admin): platform_admin `PUT/DELETE /tenants/:tid/process-routing/:slot/processes/:defId` (bỏ gán bị luật dùng ⇒
   409 `PROCESS_IN_USE` + danh sách luật); `GET/PUT /tenants/:tid/process-routing/:slot` cho platform_admin và tenant_admin
   CHÍNH tenant (khác ⇒ 404; member ⇒ 403); PUT thay cả danh sách trong một tx, `version` lệch ⇒ 409, def ∉ tập gán ⇒ 422,
   phòng ban ngoài tenant ⇒ 422, > 50 luật ⇒ 422 (zod); bump `hub_config_version` + NOTIFY (⇒ `config.changed`). Contract zod ở
   `packages/contracts/src/hub-admin` (`ProcessRouting*`).

## Làm
- [x] Delta
- [x] Migration 0087 + Drizzle + audit enum
- [x] `pickProcess` + unit
- [x] `routeSlot` + port + contracts `slotFlowOf`/`stampSlotRun`
- [x] Service + route + contract
- [x] int: API/quyền/RLS, launch theo phòng ban + run cũ giữ quy trình

## Không làm / Chạm
Không UI (lát khác). Không DLC (`packs/dlc/**` không đổi; `resolveSlot` giữ chữ ký). Không sửa route `/tenants/:tid/process-slots`
(gán đơn cũ vẫn chạy khi tenant chưa có luật).

## Test tối thiểu
unit `routing.rules.test.ts`; int `routing.routes.int.test.ts`, `routing-launch.int.test.ts`; perf hiện có
`slot-resolve.perf.int.test.ts` (resolveSlot không đổi).

## Quyết định trong lúc làm
- Tập "đã gán" là bảng mới (không đổi PK bảng `process_slot_assignments` của CR-105) — đường cũ không đổi khi chưa có luật.
- Luật mặc định = một hàng `is_default` (điều kiện bỏ qua). Tenant có luật mà không khớp, không mặc định ⇒ chặn launch.
- Tenant admin khác tenant ⇒ 404 (không lộ tồn tại); route dùng scope `user` của tenant đích ⇒ RLS chặn thêm một lớp.
- Đổi quy trình theo lượt ghi đè def tenant `contracts-approval` (đồng bộ theo `source_ref`) — run cũ giữ snapshot riêng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Chọn quy trình theo phòng ban người khởi tạo
Mỗi tenant × khe có danh sách luật có thứ tự {phòng ban → quy trình} + một luật mặc định; luật đầu tiên khớp thắng (phòng ban
con khớp luật của phòng cha); không khớp ⇒ mặc định; không có mặc định ⇒ chặn khởi tạo. Không có luật ⇒ như cũ (gán ⇒ mặc định khe).
- Kịch bản: luật thuần chọn theo thứ tự, phòng con, mặc định, chặn [test: apps/hub-api/src/modules/processes/library/routing.rules.test.ts » pickProcess]
- Kịch bản: khởi tạo bởi người phòng ban có luật ⇒ quy trình của luật đó, ghi id luật vào run [test: apps/hub-api/src/modules/processes/library/routing-launch.int.test.ts » launch chọn quy trình theo phòng ban người khởi tạo]
- Kịch bản: đổi luật sau khi khởi tạo ⇒ run cũ giữ quy trình đã chọn [test: apps/hub-api/src/modules/processes/library/routing-launch.int.test.ts » run cũ giữ quy trình khi đổi luật]
- Kịch bản: không có luật ⇒ kết quả như resolveSlot cũ [test: apps/hub-api/src/modules/processes/library/routing-launch.int.test.ts » không có luật ⇒ như resolveSlot]

#### Yêu cầu: Gán nhiều quy trình cho tenant (platform_admin)
platform_admin gán/bỏ gán quy trình thư viện đã xuất bản cho tenant × khe; bỏ gán quy trình đang được luật dùng ⇒ 409 kèm danh sách luật.
- Kịch bản: gán rồi bỏ gán; bỏ gán khi luật đang dùng ⇒ 409 [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » platform_admin gán và bỏ gán quy trình]

#### Yêu cầu: Tenant admin sửa luật chọn quy trình của tenant mình
GET/PUT luật cho platform_admin và tenant_admin của chính tenant; thay cả danh sách trong một transaction, `version` chống ghi
đè (409), chỉ quy trình đã gán (422), phòng ban của tenant (422), ≤ 50 luật; audit trước/sau; bump cấu hình Hub.
- Kịch bản: tenant admin lưu luật OK + audit + bump [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » tenant admin lưu luật]
- Kịch bản: quy trình chưa gán ⇒ 422 [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » quy trình chưa gán ⇒ 422]
- Kịch bản: phòng ban tenant khác ⇒ 422 [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » phòng ban tenant khác ⇒ 422]
- Kịch bản: tenant admin tenant khác ⇒ 404; member ⇒ 403 [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » tenant admin tenant khác ⇒ 404, member ⇒ 403]
- Kịch bản: ghi đồng thời cùng version ⇒ 409 [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » ghi đồng thời ⇒ 409]
- Kịch bản: RLS — scope user tenant khác không đọc được luật/tập gán [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » RLS chặn đọc chéo tenant]

## Việc còn lại
- UI (lát admin/tenant-settings) dùng API trên.
- e2e (viết, chạy cuối đợt): tenant admin thêm luật theo phòng ban, người phòng đó khởi tạo ⇒ đúng quy trình.
