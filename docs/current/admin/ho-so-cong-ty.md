# Admin · Hồ sơ công ty

Cập nhật: 2026-11-09 · Gộp từ: cr121-c2-tenant-profile, cr121-f4-review-mediums (đợt cr125-wave).

## Yêu cầu: Hồ sơ công ty nhập tay (nguồn: cr121-c2-tenant-profile)
Mỗi công ty có hồ sơ tuỳ chọn: tên pháp lý, mã số thuế, địa chỉ, số nhân viên, người liên hệ, email, số điện thoại, CEO, Giám đốc. platform_admin sửa từng trường (ô trống = xoá); tenant_admin chỉ xem hồ sơ công ty mình; công ty khác ⇒ không thấy.
- Kịch bản: khi platform_admin sửa hồ sơ rồi tenant_admin của công ty đó mở lại thì thấy đúng dữ liệu, còn tenant_admin công ty khác bị 404 [test: apps/admin-api/src/modules/tenants/tenants.profile.int.test.ts » đường chính: platform_admin đọc hồ sơ trống, sửa từng trường, CEO/Giám đốc + phòng ban hiện đúng, tenant_admin đọc được]
- Kịch bản: khi tenant_admin công ty khác đọc hoặc sửa hồ sơ thì 404 và không có gì bị ghi [test: apps/admin-api/src/modules/tenants/tenants.profile.int.test.ts » chặn chéo tenant: tenant_admin công ty khác ⇒ 404 cả đọc lẫn sửa, không có gì bị ghi]
- Kịch bản: khi gửi email/số điện thoại/mã số thuế/số nhân viên sai định dạng thì bị từ chối, giá trị rỗng thì xoá [test: apps/admin-api/src/modules/tenants/tenants.profile.rules.test.ts » CR-121 · TenantProfileUpdateRequestSchema (email, SĐT, MST, quy mô)]

## Yêu cầu: CEO và Giám đốc phải là thành viên công ty (nguồn: cr121-c2-tenant-profile)
CEO/Giám đốc chọn từ user nội bộ đang hoạt động của chính công ty; người ngoài công ty, đối tác hoặc đã ngừng hoạt động ⇒ 422 `LEADER_NOT_MEMBER` kèm trường sai; DB cũng chặn bằng khoá ngoại kép.
- Kịch bản: khi chọn CEO là user công ty khác hoặc user đã ngừng hoạt động thì 422 và không ghi gì [test: apps/admin-api/src/modules/tenants/tenants.profile.int.test.ts » CEO/Giám đốc không phải thành viên công ty ⇒ 422 câu rõ ràng, DB cũng chặn FK chéo công ty]

## Yêu cầu: Hub không đọc được thông tin liên hệ công ty (nguồn: cr121-c2-tenant-profile)
`hub_ro` chỉ SELECT theo cột cũ của `admin.tenants` (trước 0035); 9 cột hồ sơ (liên hệ, MST, địa chỉ, CEO/Giám đốc…) là dữ liệu cá nhân nên Hub không có đường đọc.
- Kịch bản: khi hub_ro đọc cột liên hệ/MST/CEO hoặc `select *` của tenants thì bị từ chối (42501) [test: tests/acceptance/M1/db-rls.int.test.ts » CR-121 · hub_ro không đọc được cột liên hệ/hồ sơ mới của tenants (PII) ⇒ 42501]

## Yêu cầu: Một nguồn cho 4 khoá hồ sơ khi onboarding (nguồn: cr121-c2-tenant-profile)
Onboarding (yaml/seed) ghi tên pháp lý, địa chỉ, MST, email vào CỘT của tenant; jsonb `profile` chỉ giữ website, Zalo, điện thoại phụ; khoá spec không khai thì giữ giá trị nhập tay.
- Kịch bản: khi tách hồ sơ spec thì 4 khoá thành cột và phần còn lại ở jsonb, khoá không khai thì không bị coi là đổi [test: apps/admin-api/src/modules/tenants/tenants.profile.rules.test.ts » CR-121 · D6 · onboarding ghi CỘT cho 4 khoá chuyển-cột]
- Kịch bản: khi onboard tenant mới thì MST nằm ở cột tax_code, không còn trong jsonb [test: tests/acceptance/NITI/onboard.int.test.ts » onboard]

## Yêu cầu: Đọc hồ sơ tốn tối đa 2 câu SQL (nguồn: cr121-c2-tenant-profile)
`GET /admin/tenants/:id/profile` đọc hồ sơ + phòng ban bằng 2 câu theo tập (không SQL theo hàng).
- Kịch bản: khi đọc hồ sơ thì chỉ 2 câu dữ liệu (+1 câu đặt scope RLS) [test: apps/admin-api/src/modules/tenants/tenants.profile.int.test.ts » perf: GET hồ sơ ≤ 2 câu SQL dữ liệu (+1 câu đặt scope RLS)]

## Yêu cầu: Tab của trang chi tiết công ty (nguồn: cr121-c2-tenant-profile)
Tab theo thứ tự: Hồ sơ (mặc định) · Ứng dụng · Quy trình (chỉ platform_admin) · Thành viên · Cài đặt, rồi Nhóm · Đối tác · Phân quyền · Agents · Quota. Không còn tab "Tổng quan"; số người dùng, ứng dụng đang bật, số vai nằm trên MỘT dòng ở đầu trang; `?tab=overview` cũ mở Hồ sơ.
- Kịch bản: khi mở công ty không kèm tab thì thấy tab Hồ sơ và không có tab Tổng quan [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts]
- Kịch bản: khi platform_admin sửa tên công ty tại chỗ và chọn CEO thì dữ liệu còn sau khi tải lại [test: e2e/cr121-tenant-profile.spec.ts » CR-121 · sửa tên công ty tại chỗ (Lưu), rồi chọn CEO từ thành viên]
- Kịch bản: khi nhập số nhân viên sai thì hiện câu hướng dẫn, chưa lưu [test: apps/admin-web/src/features/tenants/lib/profile-fields.test.ts » CR-121 · validateField]

## Yêu cầu: Hồ sơ công ty chứa PII không lộ cho Hub, quyền kiểm ngay ở service (nguồn: cr121-f4-review-mediums)
Cột `profile` (jsonb) của công ty không còn đọc được bằng role `hub_ro`. Đọc hồ sơ: platform_admin mọi công ty, tenant_admin chỉ công ty mình; sửa hồ sơ chỉ platform_admin — kiểm trong service, không chỉ ở route.
- Kịch bản: khi hub_ro đọc cột `profile` thì bị từ chối (42501), các cột khác vẫn đọc được [test: apps/hub-api/src/modules/ops/ops.f4-privacy.int.test.ts » đọc cột profile (kể cả select *) bị từ chối, cột còn lại vẫn đọc được]
- Kịch bản: khi member gọi đọc hoặc tenant_admin công ty khác gọi đọc thì 403 / 404, và tenant_admin gọi sửa thì 403 không ghi gì [test: apps/admin-api/src/modules/tenants/tenants.profile.authz.test.ts » GET: member ⇒ FORBIDDEN, tenant_admin công ty khác ⇒ NOT_FOUND]
