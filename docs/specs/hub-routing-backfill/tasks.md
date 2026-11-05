---
id: hub-routing-backfill
lát: hub-routing-backfill
cr: CR-118
làn: đầy đủ (migration dữ liệu khách + tenant/RLS) — phần UI làn nhanh
migration: hub 0089_routing_backfill (when 1803500000000)
phụ thuộc: cr118-flow-routing (hub 0087)
---
## Plan (ngắn)
Lỗi prod: tenant gán theo đường cũ (`hub.process_slot_assignments`, CR-105/CR-113, vd "Demo Sổ Hợp Tác") không thấy quy trình ở
Cài đặt › Ứng dụng & quy trình (routing chỉ đọc `hub.process_tenant_defs`, 0087 không backfill) và ở admin-web
`/processes?tab=own` (chỉ liệt kê def của tenant). Launch không đổi (resolveSlot đi đường gán cũ).

## Làm
1. hub 0089: `INSERT … SELECT` gán cũ → `process_tenant_defs` (`assigned_by` NULL = hệ thống), `ON CONFLICT DO NOTHING`; không tạo luật.
2. Đường gán cũ (`PUT|DELETE /tenants/:tid/process-slots/:slot`, internal onboarding qua `assignByKey`, seed CR-113) đồng bộ tập gán:
   gán ⇒ thêm def; thay/bỏ gán ⇒ def cũ ra khỏi tập trừ khi luật còn dùng (giữ, audit `kept_in_routing`).
3. GET routing thêm `current_def_id`/`current_def_name` (tuỳ chọn, tương thích ngược): gán cũ ⇒ mặc định khe.
4. Web: workspace-web Cài đặt (RoutingEditor) + admin-web SlotRouting gắn nhãn "Đang dùng"; admin-web `/processes` thêm mục
   chỉ đọc "Được platform gán" (lazy).

## Không làm / Chạm
- Không đổi launch (`slot-resolve.repo`, `slot-route.repo`), không đổi `process_slot_assignments`, không tạo luật.
- Không sửa script one-off `apps/hub-api/scripts/process-library-backfill.ts` (đã chạy ở prod; 0089 phủ dữ liệu của nó).

## Test tối thiểu
- int `apps/hub-api/src/modules/processes/library/routing-backfill.int.test.ts` (viết TRƯỚC code).
- int có sẵn `apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts` (launch không đổi).
- unit mapping UI (workspace-web + admin-web).

## Quyết định trong lúc làm
- "Dấu hệ thống" của `assigned_by` = NULL (cùng quy ước script backfill CR-105; cột không có FK, không có uuid hệ thống chung).
- Thay gán cũ A→B: A ra khỏi tập (nhất quán với bỏ gán) trừ khi luật dùng A.
- `current_def_*` tính cùng thứ tự `RESOLVE_SLOT_SQL` nhưng không đòi bản xuất bản (hiển thị, không launch).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Tập quy trình đã gán gồm cả gán theo đường cũ
Tenant gán quy trình qua `process_slot_assignments` (trước CR-118) có quy trình đó trong tập gán; đường gán cũ giữ hai bảng khớp nhau.
- Kịch bản: khi chạy hub 0089 trên tenant chỉ có gán cũ thì tập gán có def đó (assigned_by NULL), chạy lại không đổi, tenant khác không đổi, scope user chỉ thấy tenant mình [test: apps/hub-api/src/modules/processes/library/slot-single-source.int.test.ts » ensureSlotDefaults (boot) cấp đúng tenant bật app chưa có luật, chạy lại vô hại] (cr120-single-source: bảng gán cũ thành VIEW ⇒ ca 0089 chạy trong int của 0090/0091)
- Kịch bản: khi platform_admin gán/thay/bỏ gán qua `/tenants/:tid/process-slots/:slot` thì GET routing thấy def mới, def cũ bị bỏ trừ khi luật còn dùng [test: apps/hub-api/src/modules/processes/library/routing-backfill.int.test.ts » PUT gán cũ ⇒ hiện trong routing, thay ⇒ bỏ def cũ khỏi tập, DELETE giữ def khi luật còn dùng]
- Kịch bản: khi launch không có luật thì vẫn chạy quy trình gán cũ / mặc định khe như trước [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » X gán A, Y gán B chạy đúng quy trình]

#### Yêu cầu: Quy trình đang dùng
GET `/tenants/:tid/process-routing/:slot` trả `current_def_id`/`current_def_name` = quy trình chạy khi không có luật (gán cũ, không có ⇒ mặc định khe); web gắn nhãn "Đang dùng".
- Kịch bản: khi tenant gán cũ mở routing thì `current_def_id` = def gán; chưa gán ⇒ mặc định khe [test: apps/hub-api/src/modules/processes/library/routing-backfill.int.test.ts » GET routing: tenant gán cũ thấy quy trình + current_def_id, chưa gán ⇒ mặc định khe]
- Kịch bản: khi danh sách quy trình có def đang dùng thì hàng đó có nhãn "Đang dùng"; def đang dùng ngoài tập ⇒ dòng riêng [test: packages/web-kit/src/routing-current.test.ts » routingCurrent]
- Kịch bản: khi platform_admin mở "Quy trình được gán" của tenant thì quy trình gán cũ có nhãn "Đang dùng" [test: e2e/P-a/pf4/tenant-routing.pa.ts » platform gán quy trình vào tập của tenant và bỏ gán quy trình đang được luật dùng bị 409 nêu luật]

#### Yêu cầu: Mục "Được platform gán" ở Quy trình nghiệp vụ › Của công ty (admin-web)
Tab "Của công ty" của `/processes` (tenant_admin, hoặc platform_admin đang xem một tenant) có mục chỉ đọc "Được platform gán": mỗi khe của tenant (capabilities), quy trình đã gán (tên, phiên bản, "Đang dùng") + xem sơ đồ; gán/sửa vẫn chỉ platform, luật ở Cài đặt. Nạp lười.
- Kịch bản: khi tenant có quy trình gán theo khe thì mục liệt kê theo khe với nhãn "Đang dùng"; mặc định khe ngoài tập ⇒ dòng riêng [test: apps/admin-web/src/features/processes/lib/assigned-view.test.ts » assigned-view]

## Việc còn lại
