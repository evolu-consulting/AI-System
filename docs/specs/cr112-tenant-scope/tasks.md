---
id: cr112-tenant-scope
lát: cr112-tenant-scope
cr: CR-112
làn: đầy đủ (quyền)
migration: không
phụ thuộc:
---
## Bảng route (ADM-FR-81) — workspace công ty `/admin/tenants/:id*`

Thứ tự kiểm: không token ⇒ 401 → member/đối tác ⇒ 403 → tenant_admin + công ty khác (hay id lạ) ⇒ **404** → route chỉ-platform ⇒ 403.

| Route | platform_admin | tenant_admin · công ty mình | tenant_admin · công ty khác | member | đối tác |
|---|---|---|---|---|---|
| `GET /admin/tenants` · `POST /admin/tenants` | 200/201 | 403 | — | 403 | 403 |
| `GET /admin/tenants/:id` (chi tiết, chỉ xem) | 200 | **200** | 404 | 403 | 403 |
| `PATCH /:id` · `POST /:id/lock` · `POST /:id/unlock` | 200 | 403 | 404 | 403 | 403 |
| `GET /:id/quotas` | 200 (đủ tiền) | **200** (rút gọn, không `max_usd`/tiền) | 404 | 403 | 403 |
| `PUT /:id/quotas` | 200 | 403 | 404 | 403 | 403 |
| `GET/PUT /:id/daily-limits`, `POST …/:kind/reset` | 200 | 403 | 404 | 403 | 403 |
| `GET /:id/packs`, `PUT/DELETE /:id/packs/:key` | 200 | 403 | 404 | 403 | 403 |
| `GET/PUT /:id/default-app` | 200 | 403 | 404 | 403 | 403 |
| `/:id/workflow-tools*` | 200 | 403 | 404 | 403 | 403 |
| Người dùng `/admin/users*`, nhóm `/admin/groups*`, cấp agent cho nhóm `/admin/grants*` | mọi công ty | công ty mình (không đổi) | user/nhóm công ty khác ⇒ 404 | 403 | 403 |
| Entitlement/feature `/admin/features*`, secrets, onboarding | platform | 403 | 403 | 403 | 403 |

## Plan (ngắn)
- `apps/admin-api/src/lib/tenant-scope.ts`: luật thuần `canAddressTenant`, `requireTenantScope(c, tid)` (404), cổng `tenantWorkspaceGate` gắn ở app.ts cho `/admin/tenants/:id` và `/:id/*` TRƯỚC mọi router `/admin/tenants`.
- `requireAuth` bỏ qua khi actor đã có trong request (cổng + route không đọc DB hai lần).
- tenants.routes: guard theo từng route (bỏ `use("*")`); GET `/:id` mở cho tenant_admin. quotas.routes dùng `requireTenantScope` thay kiểm tay.
- admin-web: `/tenants/$tenantId` mở cho tenant_admin — tab Thông tin (chỉ xem), Agent, Users; ẩn khoá/mở khoá, app mặc định, tab chỉ-platform (`lib/workspace-tabs.ts`).

## Làm
- [x] Cổng phạm vi chung + helper; tenants/quotas routes; web route guard tối thiểu.
- [x] Int ma trận `apps/admin-api/src/modules/tenants/tenant-scope.int.test.ts` (đỏ trên code cũ: 403 thay 200/404).

## Không làm / Chạm
- Không chạm roles/groups-grant compile, migration (lát cr112-app-roles). Không đổi nav/sidebar (lát nav sau).
- `?tenant_id=<khác>` trên `/admin/users|groups|grants` giữ luật cũ ADM-BR-09/M1-R13 (tenant_admin bị ép về công ty mình, không 404) — đổi sẽ phá nhiều test acceptance đã khoá; ghi Việc còn lại.

## Test tối thiểu
- unit `apps/admin-api/src/lib/tenant-scope.test.ts`, `apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts`.
- int `tenant-scope.int.test.ts` (ma trận) + sửa `tests/acceptance/M1/tenants.int.test.ts`, `app-catalog/tenant-default-app.int.test.ts` theo luật 404 mới.

## Quyết định trong lúc làm
- Công ty khác ⇒ 404 cho MỌI route `/:id*` kể cả route chỉ-platform (không lộ tồn tại); công ty mình + route chỉ-platform ⇒ 403.
- Cổng ở app.ts (không rải trong từng router) để router đóng băng (workflow-tools) cũng theo luật 404 mà không sửa.
- Tab Quota (rút gọn) chưa hiện trên web cho tenant_admin: TenantQuotaTab hiện gọi daily-limits/PUT chỉ-platform; API đã sẵn — để lát nav/UI.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/workspace-cong-ty.md
#### Yêu cầu: tenant_admin vào workspace công ty mình (ADM-FR-81)
tenant_admin xem chi tiết công ty mình (chỉ xem) và quota rút gọn; thao tác chỉ-platform (sửa, khoá, gói, giới hạn ngày, app mặc định, tool quy trình) trả 403; mọi route `/admin/tenants/:id*` của công ty khác trả 404; member và đối tác 403; platform_admin không đổi.
- Kịch bản: khi tenant_admin mở chi tiết và quota công ty mình thì 200, quota không có trường tiền; route chỉ-platform trên công ty mình thì 403 [test: apps/admin-api/src/modules/tenants/tenant-scope.int.test.ts » tenant_admin: tenant mình đọc được chi tiết + quota rút gọn, route chỉ-platform ⇒ 403]
- Kịch bản: khi tenant_admin gọi bất kỳ route `/admin/tenants/:id*` của công ty khác hay id lạ thì 404 [test: apps/admin-api/src/modules/tenants/tenant-scope.int.test.ts » tenant_admin: tenant khác ⇒ 404 MỌI route (cả route chỉ-platform), id không tồn tại cũng 404]
- Kịch bản: khi member gọi workspace công ty thì 403 [test: apps/admin-api/src/modules/tenants/tenant-scope.int.test.ts » member ⇒ 403 cả tenant mình lẫn tenant khác]
- Kịch bản: khi đối tác gọi workspace công ty thì 403 [test: apps/admin-api/src/modules/tenants/tenant-scope.int.test.ts » đối tác (user ngoài) ⇒ 403 trên workspace công ty]
- Kịch bản: khi platform_admin mở mọi công ty thì như cũ 200 [test: apps/admin-api/src/modules/tenants/tenant-scope.int.test.ts » platform_admin: mọi tenant như cũ (chi tiết + quota đủ tiền)]
- Kịch bản: khi tenant_admin mở /tenants/<id> trên admin-web thì chỉ thấy tab Thông tin (chỉ xem)/Agent/Users [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts]

## Việc còn lại
- Web: tab Quota rút gọn cho tenant_admin; sidebar chỉ công ty mình (lát nav).
- Cân nhắc `?tenant_id=<khác>` ⇒ 404 trên users/groups/grants (đổi ADM-BR-09/M1-R13, cần qc sửa test khoá).
- e2e cho tenant_admin mở /tenants/<own> (chạy một lần cuối đợt).
