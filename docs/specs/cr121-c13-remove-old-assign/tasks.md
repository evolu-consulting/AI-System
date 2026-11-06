---
id: cr121-c13-remove-old-assign
lát: cr121-c13-remove-old-assign
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c, c11, c12
---
## Plan (ngắn)
Gỡ chỗ gán quy trình thứ 3, 4 (D6): `/apps/$appKey` (tab Quy trình + ngăn Công ty) và `flowsMode`/`RulesPanel` của `/processes`; chuyển hướng URL cũ. Công ty › Quy trình là nơi duy nhất gán (c11). Spec: `docs/specs/cr121-c/spec.md` R7 + bảng URL cũ (R2).

## Làm
- `/apps/$appKey`: còn 3 tab Tổng quan · Tính năng · Xem trước + khối `AssignNote` (link "Quy trình của <công ty>" sang `/tenants/$id?tab=processes`). Gỡ `CompaniesTab`, `ProcessesTab`, `SlotCard`, `SlotDeclInfo`. `?tab=processes|companies` cũ ⇒ Tổng quan + thông báo nhấn mạnh "Gán quy trình ở trang Công ty" (`isLegacyAssignTab`, `notice=assign`).
- `/processes`: chỉ là Thư viện (platform_admin). Gỡ `flowsMode`, TenantPicker, `FlowsList`/`FlowItem`/`CreateDialog`/`FlowDiagram`/`FlowWhenText`/`RulesPanel`, `use-flows-list`. Route `beforeLoad`: tenant_admin ⇒ Quy trình của công ty mình; platform `?tenant=<id>` (không kèm bộ lọc) ⇒ `/tenants/<id>?tab=processes` (`processesRedirectTenant`).
- `TenantFeaturesTab`: gỡ prop `onlyApp`/`onDraft`. Nhãn mức đổi sang `tenants.apps.level.*` (gỡ `tenants.features.level`).
- Grep sạch `useSlotRoutingActions` / `flowsMode` / `RoutingRules` / `SlotRouting` ngoài `tenants/flows/**` (còn `RulesPanel` trùng tên của workspace-web, không liên quan).

## Không làm / Chạm
Không: thư viện đối chiếu (c15), 5 tab (c14), trình sửa (c17), API.

## Test tối thiểu
- unit: `tenants/lib/legacy-redirect.test.ts » /processes?tenant= chuyển tới Công ty › Quy trình`, `apps/lib/app-config.test.ts » tab`.
- e2e (viết, không chạy): `app-config.spec.ts` (F1 treo, thay F2 bằng test chuyển hướng + thông báo), `P-a/pf4/admin-editor`, `admin-processes`, `P-b2/admin/canvas` (E-PB2-12) treo vì dùng hộp "Tạo quy trình" theo công ty đã gỡ, `deployed/20-flows-visible` bỏ phần danh sách theo công ty.

## Quyết định trong lúc làm
- Bộ lọc thư viện "Dùng bởi công ty" cũng dùng `?tenant=` (UUID/none/default): chỉ chuyển hướng khi `?tenant=<id>` đứng một mình; c15 nên đổi tên tham số lọc.
- Tab Xem trước của trang app chỉ còn bản đã lưu (không còn bản nháp từ ngăn Công ty).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED admin/cau-hinh-app.md
#### Yêu cầu: Khối gán quy trình nằm trong thẻ app (ADM-FR-84) (nguồn: cr118-app-config)
Trang app (`/apps/<key>`) chỉ còn thông tin app (Tổng quan, Tính năng, Xem trước) và link sang Công ty › Quy trình của từng công ty; không còn tab Quy trình gán hay ngăn Công ty. `/processes` chỉ còn là Thư viện; tenant_admin và `?tenant=<id>` được chuyển tới Công ty › Quy trình.
- Kịch bản: URL cũ của tab gán ở trang app mở Tổng quan kèm thông báo gán ở trang Công ty [test: apps/admin-web/src/features/apps/lib/app-config.test.ts » tab]
- Kịch bản: `/processes?tenant=<id>` và tenant_admin chuyển tới tab Quy trình của công ty [test: apps/admin-web/src/features/tenants/lib/legacy-redirect.test.ts » CR-121 c13 · /processes?tenant= chuyển tới Công ty › Quy trình]

## Việc còn lại
- Trap: lối "Tạo quy trình công ty từ mẫu (sdlc)" ở `/processes` của tenant_admin không còn (hộp `CreateDialog` gỡ cùng `flowsMode`); công ty nhận quy trình qua Sao chép từ Thư viện. Cần điều phối xác nhận.
- Khoá i18n `appcfg.tab.processes|companies`, `tenants.slots.*`, `process.admin.flows.*` (phần danh sách) còn lại chưa dọn; `useAppProcesses` giữ cho cảnh báo cấu hình ở Tổng quan.
- `test:lock:write` do qc ghi.