---
id: cr118-pa-routing-e2e
lát: cr118-pa-routing-e2e
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: cr118-tenant-settings
---
## Plan (ngắn)
P-a pf4 `tenant-routing.pa.ts` đỏ: DB e2e của stack P-a không chạy migration gói ⇒ `/admin/tenants/:id/packs` trả 500 ⇒ tab Tính năng chỉ hiện lỗi, khối khe không mount (lỗi TEST). Thêm `fakePacks`. Sửa thêm lỗi ỨNG DỤNG: GET sơ đồ quy trình đã gán của sohoptac dùng nhầm tiền tố `/hub-admin` (route ở gốc hub).

## Làm
- [x] test dùng `fakePacks`; mock cw đổi đường dẫn; `api-apps.ts` DEF dùng ROUTE (gốc hub)

## Không làm / Chạm
Không server.

## Test tối thiểu
evotest `-Step e2e -All -Filter P-a` một lần.

## Quyết định trong lúc làm
- Test e2e đã khoá ⇒ cần relock.

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: sửa đường dẫn gọi sơ đồ và sửa e2e; hành vi đã mô tả ở cr118-tenant-settings)

## Việc còn lại
