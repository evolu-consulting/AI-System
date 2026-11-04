---
id: cr118-routing-deleted
lát: cr118-routing-deleted
cr: CR-118
làn: đầy đủ (quyền tenant_admin đọc dữ liệu platform)
migration: không
phụ thuộc: cr118-flow-routing (đã gộp)
---
## Plan (ngắn)
Review (Thấp) trên cr118-flow-routing: `assignedOf`/`assignedDef` không lọc `deleted_at`, `assignedDef` rơi về NHÁP thư viện khi
chưa có bản xuất bản ⇒ tenant_admin thấy def đã xoá + đọc nháp của platform; launch lại lọc def đã xoá ⇒ `route_unavailable` mà UI
không có lý do.
1. `assignedOf` bỏ def đã xoá; `rel_version` lấy từ hàng release thật.
2. `assignedDef` bỏ def đã xoá; chưa xuất bản ⇒ chỉ platform_admin thấy nháp, tenant_admin ⇒ 404.
3. GET luật: mỗi luật có `unavailable: "deleted" | "unpublished"` khi quy trình của luật không chạy được.
4. PUT: chọn def trong tập nhưng đã xoá / chưa xuất bản ⇒ 422 `ROUTING_PROCESS_UNAVAILABLE` (`details.reason`).
5. Launch: `route_unavailable` ⇒ lượt kẹt `FLOW_ROUTE_UNAVAILABLE` (khác `FLOW_ROUTE_NONE`).

## Không làm / Chạm
Không UI (sohoptac-web `attention.ts` chưa biết `FLOW_ROUTE_NONE`/`FLOW_ROUTE_UNAVAILABLE` — lát UI). Không đổi migration.

## Quyết định trong lúc làm
- Kiểm "def còn chạy được" ở PUT bằng đọc scope system TRƯỚC tx ghi (tx tenant_admin là scope user, không đọc được def thư viện).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Quy trình đã gán bị xoá / chưa xuất bản
Danh sách + sơ đồ quy trình đã gán bỏ quy trình đã xoá (404); tenant_admin chỉ thấy bản xuất bản (không thấy nháp); luật trỏ
quy trình không chạy được mang lý do; lưu luật chọn quy trình đó ⇒ 422; khởi tạo khớp luật đó ⇒ chặn với lý do riêng.
- Kịch bản: danh sách bỏ def đã xoá, luật mang lý do [test: apps/hub-api/src/modules/processes/library/routing-deleted.int.test.ts » danh sách bỏ def đã xoá, luật mang lý do unavailable]
- Kịch bản: sơ đồ def đã xoá ⇒ 404, nháp chỉ platform_admin [test: apps/hub-api/src/modules/processes/library/routing-deleted.int.test.ts » sơ đồ: def đã xoá ⇒ 404, nháp chỉ platform_admin xem]
- Kịch bản: launch ⇒ FLOW_ROUTE_UNAVAILABLE [test: apps/hub-api/src/modules/processes/library/routing-deleted.int.test.ts » launch khớp luật có def đã xoá ⇒ FLOW_ROUTE_UNAVAILABLE]
- Kịch bản: PUT ⇒ 422 ROUTING_PROCESS_UNAVAILABLE [test: apps/hub-api/src/modules/processes/library/routing-deleted.int.test.ts » PUT chọn def đã xoá / chưa xuất bản ⇒ 422 ROUTING_PROCESS_UNAVAILABLE]

## Việc còn lại
- UI: hiện `rules[].unavailable`, mã lỗi `ROUTING_PROCESS_UNAVAILABLE`, lý do kẹt `FLOW_ROUTE_NONE`/`FLOW_ROUTE_UNAVAILABLE`.
