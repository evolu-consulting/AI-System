---
id: cr121-q1-app-filter-contract-label
lát: cr121-q1-app-filter-contract-label
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c3c-tenants-list
---
## Plan (ngắn)
A. `GET /admin/tenants?app=<chat|community|contracts|knowledge>` + mỗi hàng `apps[]` (CÙNG một câu SQL: subquery aggregate + `exists`). App của feature = tiền tố khoá (`chat-app` ⇒ chat), bỏ `contracts-approval-engine` (ẩn) — khớp `feature-meta` ở admin-web. UI: nhóm lọc "Ứng dụng" trong ListPage + cột "Ứng dụng" (chip nhãn nghiệp vụ).
B. Pack kit có "bộ đặt nhãn bản ghi" (`recordLabelRegistry`, cửa `packs/kit/public.ts`); gói contracts đăng ký (`record-label.mount.ts`) trả `HĐ <số> · <tên>` theo TẬP id (1 câu `= any`, tx gói RLS tenant của run). Trang chi tiết lượt chạy dùng; không có nhãn ⇒ giữ "HĐ <id8>".

## Làm
- contracts `tenants.ts` (+`TENANT_APP_IDS`, `apps`, `app`); `tenants.repo.ts/service.ts`; `TenantsPage/TenantTable/api.ts`; i18n `tenants.col.apps` vi+en.
- hub: `kit/application/record-label.ports.ts`, `kit/adapters/record-label-registry.ts`, `kit/public.ts`, `contracts/adapters/record-label.repo.ts`, `contracts/record-label.mount.ts`, `run-detail.service.ts/map.ts`.

## Không làm / Chạm
- Không migration, không DLC, không quyền mở lại HĐ, không engine. Danh sách lượt chạy: không có nơi nào hiển thị nhãn bản ghi (chỉ trang chi tiết) ⇒ chưa có gì để áp.

## Test tối thiểu
- unit: `record-label.ports.test.ts`, `record-label.repo.test.ts`, `run-detail.map.test.ts`.
- int: `tenants.list-app.int.test.ts`; `run-detail.int.test.ts` (nhãn thật).
- e2e (viết, chưa chạy): `e2e/cr121-tenants-list.spec.ts`.

## Quyết định trong lúc làm
- Hàm đặt nhãn nhận `(tenantId, ids)` và tự mở `PackUow.system` (Hub không có tx của gói).
- Số câu SQL: list công ty = 1 (+1 đếm counts như cũ); nhãn = 1 câu/trang (+ set_config role của tx gói).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/tenant-user.md
#### Yêu cầu: Lọc danh sách Công ty theo Ứng dụng
Phễu lọc của `/tenants` có nhóm "Ứng dụng" (Chat AI, Cộng đồng, Sổ Hợp Tác, Tri thức); mỗi hàng hiện các ứng dụng đang bật bằng nhãn nghiệp vụ. API `GET /admin/tenants?app=` lọc bằng entitlement còn hiệu lực và trả `apps` trong cùng câu SQL.
- Kịch bản: khi lọc Sổ Hợp Tác thì chỉ còn công ty đang bật ứng dụng đó, bỏ chip thì đủ lại [test: e2e/cr121-tenants-list.spec.ts » CR-121 · /tenants lọc Ứng dụng Sổ Hợp Tác chỉ còn công ty đang bật, cột Ứng dụng hiện nhãn nghiệp vụ]
- Kịch bản: khi gọi API với `app=contracts` thì bỏ qua entitlement đã thu hồi và feature ẩn, `apps` mỗi hàng đã khử trùng [test: apps/admin-api/src/modules/tenants/tenants.list-app.int.test.ts]

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Nhãn hợp đồng thật ở trang chi tiết lượt chạy
Nguồn gắn lượt hiển thị mã HĐ thật và tên HĐ do gói contracts đặt (một câu theo tập id, dưới RLS tenant của lượt); không có nhãn thì giữ "HĐ <8 ký tự id>".
- Kịch bản: khi lượt gắn một HĐ có số HD-Q1-001 thì nguồn hiện "HĐ HD-Q1-001 · Thuê kho Q1" [test: apps/hub-api/src/modules/processes/runs/run-detail.int.test.ts » R-4 · nguồn hợp đồng và lượt đã chạy lại]
- Kịch bản: khi gói không trả nhãn thì giữ nhãn cũ theo id [test: apps/hub-api/src/modules/processes/runs/run-detail.map.test.ts » gói hợp đồng ⇒ kind contract + nhãn HĐ + app_key]

## Việc còn lại
- Chạy e2e `cr121-tenants-list` cuối đợt (điều phối).