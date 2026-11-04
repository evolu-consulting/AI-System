---
id: cr118-tenant-settings
lát: cr118-tenant-settings
cr: CR-118
làn: nhanh (UI; server đã gộp ở cr118-flow-routing)
migration: không
phụ thuộc: cr118-flow-routing (API process-routing), cr118-capabilities (GET /hub-admin/tenants/:id/capabilities)
---
## Plan (ngắn)
Spec §6 (đoạn "Tenant chỉ xem") + §11.2. Hai nơi UI dùng chung MỘT logic thuần `@ai/web-kit/routing-rules`:
- sohoptac-web › Cài đặt › "Ứng dụng & quy trình" (`features/settings/components/apps/*`, chunk lười): chỉ quản trị công ty + chủ gói
  (`owner && tenant_admin|platform_admin`); mức + add-on (từ `/hub-admin/tenants/:id/capabilities`), mỗi khe: quy trình đã gán (tên + phiên bản,
  sơ đồ chỉ đọc lười qua `FlowCanvasLazy`) + bộ sửa luật (thêm/xoá/đổi thứ tự, chọn nhiều phòng ban, quy trình trong số đã gán, mặc định;
  lưu cả danh sách, `version`; 409 ⇒ "đã có người sửa" + Tải lại không mất nháp; 422 ⇒ câu tiếng Việt).
- admin-web › `TenantProcessSlots` (cùng component ở trang công ty và ngăn "Công ty" của /apps/$appKey): `SlotRouting` = gán thêm / bỏ gán
  quy trình (bỏ gán bị luật dùng ⇒ 409 nêu số luật bị ảnh hưởng) + `RoutingRules` (bản nhỏ trùng chức năng, dùng shadcn của admin).
Đường: luật `/tenants/:tid/process-routing/:slot` mount ở GỐC hub (như `process-slots`), năng lực ở `/hub-admin/tenants/:id/capabilities`.

## Làm
- [x] Delta
- [x] `packages/web-kit/src/routing-rules.ts` + unit
- [x] sohoptac-web: api-apps, hooks, AppsPane/SlotCard/RoutingEditor/RuleRow/DeptPicker, mục "apps" trong SettingsDialog (ẩn với member/đối tác)
- [x] proxy `/hub-admin` + `/tenants` → hub: `apps/sohoptac-web/rsbuild.config.ts` (+ test) và `deploy/prod-sohoptac2/nginx.conf` (server contracts-web)
- [x] admin-web: api-routing, use-slot-routing, SlotRouting, RoutingRules, gắn vào `TenantProcessSlots`
- [x] i18n vi/en (`contracts.settings.apps.*` ở rep3; `tenants.slots.routing.*`)
- [x] e2e viết, KHÔNG chạy: `e2e/contracts-web/tenant-routing.cw.ts`, `e2e/P-a/pf4/tenant-routing.pa.ts`

## Không làm / Chạm
Không sửa server/contract. Không migration. Sơ đồ của quy trình ĐÃ GÁN nhưng KHÔNG đang dùng chưa vẽ được: hub chưa có đường đọc định nghĩa theo
`def_id` cho tenant (chỉ `/pack/contracts/approval-flow` = quy trình đang dùng) ⇒ hiện tên + phiên bản, ghi chú. Phòng ban con: server khớp theo
cây (luật chọn phòng cha áp cả con); UI chỉ liệt kê phòng ban phẳng của `/admin/org` kèm câu giải thích.

## Test tối thiểu
unit `packages/web-kit/src/routing-rules.test.ts`; `apps/sohoptac-web/rsbuild.config.test.ts`. e2e chạy MỘT lần cuối đợt (evotest `-Filter contracts-web`
+ job admin).

## Quyết định trong lúc làm
- Logic sửa luật + ánh xạ lỗi dùng chung ở `@ai/web-kit/routing-rules` (thuần, kiểu từ contracts); mỗi app tự lo chữ/giao diện.
- Luật mặc định gửi `condition: {}` và xếp cuối thân PUT; luật thường cần ≥ 1 phòng ban (kiểm trước, server vẫn là nguồn thật).
- 409 `VERSION_CONFLICT`: KHÔNG làm tươi ngầm (giữ nháp); nút Tải lại refetch rồi remount theo `version`.
- Cần proxy `/hub-admin` + `/tenants` cho contracts-web (trước đó chỉ `/pack`, `/conversations`, `/runs`, `/notifications`, `/auth`, `/admin`); sửa nginx
  TRONG worktree này, KHÔNG deploy. Dùng `/tenants` vì route luật nằm ở gốc hub; SPA không có route `/tenants`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-04 (đợt cr118-r1)

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Cài đặt › Ứng dụng & quy trình (tenant tự sửa luật chọn quy trình)
Quản trị công ty + chủ gói thấy mục "Ứng dụng & quy trình": mức, add-on, mỗi khe các quy trình đã gán (tên, phiên bản, sơ đồ chỉ đọc) và bộ sửa luật
chọn quy trình theo phòng ban (thêm/xoá/đổi thứ tự, nhiều phòng ban, chỉ chọn trong số đã gán, một mặc định, lưu cả danh sách theo `version`). Không
gán thêm, không sửa nội dung quy trình. Thành viên/đối tác không thấy mục.
- Kịch bản: tenant admin thêm luật theo phòng ban, chọn quy trình, đặt mặc định, Lưu ⇒ PUT đúng thân và luật khớp phòng ban chọn quy trình đó [test: e2e/contracts-web/tenant-routing.cw.ts » tenant admin thêm luật theo phòng ban ⇒ người phòng đó khởi tạo đúng quy trình]
- Kịch bản: lưu lệch `version` (409) ⇒ báo "đã có người sửa", giữ bản nháp, có nút Tải lại [test: e2e/contracts-web/tenant-routing.cw.ts » 409: báo 'đã có người sửa', giữ bản nháp, Tải lại lấy bản mới]
- Kịch bản: thành viên không thấy mục [test: e2e/contracts-web/tenant-routing.cw.ts » thành viên không thấy mục 'Ứng dụng & quy trình']
- Kịch bản: thêm/xoá/đổi thứ tự luật, chọn phòng ban, một mặc định, trần 50, kiểm trước khi lưu [test: packages/web-kit/src/routing-rules.test.ts » thêm xoá đổi thứ tự sửa luật và trần 50 luật]
- Kịch bản: lỗi 409/422 của hợp đồng ánh xạ về loại lỗi để hiện tiếng Việt [test: packages/web-kit/src/routing-rules.test.ts » mã 409/422 của hợp đồng]
- Kịch bản: contracts-web proxy `/hub-admin` và `/tenants` sang hub [test: apps/sohoptac-web/rsbuild.config.test.ts » proxy /hub-admin và /tenants chuyển sang hub-api]

### MODIFIED admin/ung-dung-quyen.md
#### Yêu cầu: Gán quy trình cho tenant × khe (tập nhiều quy trình) và sửa luật chọn
Ở trang công ty và ngăn "Công ty" của trang app, mỗi khe có khối "Quy trình được gán & luật chọn theo phòng ban": platform_admin gán thêm quy trình đã
xuất bản, bỏ gán (bị chặn khi còn luật dùng, nêu số luật bị ảnh hưởng) và sửa luật như tenant admin.
- Kịch bản: platform gán thêm quy trình; bỏ gán quy trình đang được luật dùng ⇒ 409 nêu luật số bị ảnh hưởng [test: e2e/P-a/pf4/tenant-routing.pa.ts » platform gán quy trình vào tập của tenant và bỏ gán quy trình đang được luật dùng bị 409 nêu luật]
- Kịch bản: số thứ tự luật bị ảnh hưởng lấy từ `details.rules` (priority + 1, bỏ trùng) [test: packages/web-kit/src/routing-rules.test.ts » IN_USE: số thứ tự luật = priority + 1, bỏ trùng, bỏ phần tử sai]

## Việc còn lại
- Chạy e2e một lần cuối đợt; relock `tests/.lock` (e2e mới) bởi điều phối.
- Khi hub có đường đọc định nghĩa theo `def_id` cho tenant: vẽ sơ đồ cho mọi quy trình đã gán (hiện chỉ quy trình đang dùng).
- Deploy: nginx contracts-web cần `hub-admin|tenants` (đã sửa trong repo, chưa deploy).
