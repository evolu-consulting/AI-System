# Admin · Workspace công ty cho tenant_admin

Cập nhật: 2026-11-09 · Gộp từ: cr112-tenant-scope (đợt cr125-wave).

## Yêu cầu: tenant_admin vào workspace công ty mình (ADM-FR-81) (nguồn: cr112-tenant-scope)
tenant_admin xem chi tiết công ty mình (chỉ xem) và quota rút gọn; thao tác chỉ-platform (sửa, khoá, gói, giới hạn ngày, app mặc định, tool quy trình) trả 403; mọi route `/admin/tenants/:id*` của công ty khác trả 404; member và đối tác 403; platform_admin không đổi.
- Kịch bản: khi tenant_admin mở chi tiết và quota công ty mình thì 200, quota không có trường tiền; route chỉ-platform trên công ty mình thì 403 [test: apps/admin-api/src/modules/tenants/tenant-scope.int.test.ts » tenant_admin: tenant mình đọc được chi tiết + quota rút gọn, route chỉ-platform ⇒ 403]
- Kịch bản: khi tenant_admin gọi bất kỳ route `/admin/tenants/:id*` của công ty khác hay id lạ thì 404 [test: apps/admin-api/src/modules/tenants/tenant-scope.int.test.ts » tenant_admin: tenant khác ⇒ 404 MỌI route (cả route chỉ-platform), id không tồn tại cũng 404]
- Kịch bản: khi member gọi workspace công ty thì 403 [test: apps/admin-api/src/modules/tenants/tenant-scope.int.test.ts » member ⇒ 403 cả tenant mình lẫn tenant khác]
- Kịch bản: khi đối tác gọi workspace công ty thì 403 [test: apps/admin-api/src/modules/tenants/tenant-scope.int.test.ts » đối tác (user ngoài) ⇒ 403 trên workspace công ty]
- Kịch bản: khi platform_admin mở mọi công ty thì như cũ 200 [test: apps/admin-api/src/modules/tenants/tenant-scope.int.test.ts » platform_admin: mọi tenant như cũ (chi tiết + quota đủ tiền)]
- Kịch bản: khi tenant_admin mở /tenants/<id> trên admin-web thì chỉ thấy tab Thông tin (chỉ xem)/Agent/Users [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts]
