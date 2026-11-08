---
id: cr121-c2-tenant-profile
lát: cr121-c2-tenant-profile
cr: CR-121
làn: nhanh (phần migration/quyền: Opus low soát diff)
migration: 0035_tenant_profile
phụ thuộc:
---
## Plan (ngắn)
Hồ sơ công ty nhập tay (tên pháp lý, MST, địa chỉ, quy mô, liên hệ, CEO, Giám đốc) + danh sách phòng ban chỉ đọc, hiện ở tab "Hồ sơ" của trang chi tiết công ty (admin-web).
Bỏ tab "Tổng quan" lồng trong công ty (sidebar đã có Tổng quan); số tóm tắt thành MỘT dòng ở đầu trang.

## Làm
- DB `0035_tenant_profile.sql`: 9 cột tuỳ chọn trên `admin.tenants` (RLS/GRANT của bảng áp nguyên). CEO/Giám đốc = FK kép `(id, user)` → `users(tenant_id, id)` `ON DELETE SET NULL (cột)` ⇒ chỉ trỏ được user cùng công ty.
- Backfill MỘT lần (D6) từ `profile` jsonb (niti-onboard 0015) cho khoá trùng: legal_name, address, tax_id→tax_code, email→contact_email, phones[0]→contact_phone; UI không đọc lại các khoá này từ jsonb (thẻ jsonb chỉ còn website/Zalo/điện thoại phụ).
- API `GET /admin/tenants/:id/profile` (platform_admin + tenant_admin công ty mình, như `GET /:id`; 2 câu SQL dữ liệu) và `PATCH /admin/tenants/:id/profile` (chỉ platform_admin, như `PATCH /:id`; theo `version`, từng trường, `""`/null = xoá, CEO/Giám đốc phải là user nội bộ đang hoạt động của công ty ⇒ 422 `LEADER_NOT_MEMBER`). Tên công ty vẫn sửa qua `PATCH /admin/tenants/:id`.
- admin-web: tab = Hồ sơ · Ứng dụng · Quy trình · Thành viên · Cài đặt (+ Nhóm · Đối tác · Phân quyền · Agents · Quota giữ nguyên phía sau); mặc định Hồ sơ; sửa tại chỗ (bút ⇒ ô nhập + Lưu/Huỷ, IconButton).

## Không làm / Chạm
Không làm danh sách Công ty, nội dung tab Quy trình/Ứng dụng. Phòng ban lấy từ `admin.departments` (có trưởng phòng); chưa có DetailDrawer nên link sang tab Nhóm. Không đổi allowlist audit (chỉ ghi `summary.profile_fields`, không giá trị PII).

## Test tối thiểu
unit: `tenants.profile.rules.test.ts`, `profile-fields.test.ts`, `workspace-tabs.test.ts`, `profile.test.ts`; int: `tenants.profile.int.test.ts` (đường chính, chéo tenant, 422, ≤ 2 câu SQL) + `tenant-scope.int.test.ts` (ma trận quyền thêm 2 route); e2e viết (không chạy): `e2e/cr121-tenant-profile.spec.ts`.

## Quyết định trong lúc làm
- Tab "Cài đặt" giữ nguyên nội dung (kể cả ô Tên công ty) theo yêu cầu; ô tên ở Hồ sơ dùng cùng `PATCH /admin/tenants/:id` ⇒ cùng một nguồn/version (xem Việc còn lại).
- Key URL `info` giữ cho tab Cài đặt (liên kết cũ không gãy); `?tab=overview` cũ ⇒ về Hồ sơ.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/ho-so-cong-ty.md
#### Yêu cầu: Hồ sơ công ty nhập tay
Mỗi công ty có hồ sơ tuỳ chọn: tên pháp lý, mã số thuế, địa chỉ, số nhân viên, người liên hệ, email, số điện thoại, CEO, Giám đốc. platform_admin sửa từng trường (ô trống = xoá); tenant_admin chỉ xem hồ sơ công ty mình; công ty khác ⇒ không thấy.
- Kịch bản: khi platform_admin sửa hồ sơ rồi tenant_admin của công ty đó mở lại thì thấy đúng dữ liệu, còn tenant_admin công ty khác bị 404 [test: apps/admin-api/src/modules/tenants/tenants.profile.int.test.ts » đường chính: platform_admin đọc hồ sơ trống, sửa từng trường, CEO/Giám đốc + phòng ban hiện đúng, tenant_admin đọc được]
- Kịch bản: khi tenant_admin công ty khác đọc hoặc sửa hồ sơ thì 404 và không có gì bị ghi [test: apps/admin-api/src/modules/tenants/tenants.profile.int.test.ts » chặn chéo tenant: tenant_admin công ty khác ⇒ 404 cả đọc lẫn sửa, không có gì bị ghi]
- Kịch bản: khi gửi email/số điện thoại/mã số thuế/số nhân viên sai định dạng thì bị từ chối, giá trị rỗng thì xoá [test: apps/admin-api/src/modules/tenants/tenants.profile.rules.test.ts » CR-121 · TenantProfileUpdateRequestSchema (email, SĐT, MST, quy mô)]

#### Yêu cầu: CEO và Giám đốc phải là thành viên công ty
CEO/Giám đốc chọn từ user nội bộ đang hoạt động của chính công ty; người ngoài công ty, đối tác hoặc đã ngừng hoạt động ⇒ 422 `LEADER_NOT_MEMBER` kèm trường sai; DB cũng chặn bằng khoá ngoại kép.
- Kịch bản: khi chọn CEO là user công ty khác hoặc user đã ngừng hoạt động thì 422 và không ghi gì [test: apps/admin-api/src/modules/tenants/tenants.profile.int.test.ts » CEO/Giám đốc không phải thành viên công ty ⇒ 422 câu rõ ràng, DB cũng chặn FK chéo công ty]

#### Yêu cầu: Hub không đọc được thông tin liên hệ công ty
`hub_ro` chỉ SELECT theo cột cũ của `admin.tenants` (trước 0035); 9 cột hồ sơ (liên hệ, MST, địa chỉ, CEO/Giám đốc…) là dữ liệu cá nhân nên Hub không có đường đọc.
- Kịch bản: khi hub_ro đọc cột liên hệ/MST/CEO hoặc `select *` của tenants thì bị từ chối (42501) [test: tests/acceptance/M1/db-rls.int.test.ts » CR-121 · hub_ro không đọc được cột liên hệ/hồ sơ mới của tenants (PII) ⇒ 42501]

#### Yêu cầu: Một nguồn cho 4 khoá hồ sơ khi onboarding
Onboarding (yaml/seed) ghi tên pháp lý, địa chỉ, MST, email vào CỘT của tenant; jsonb `profile` chỉ giữ website, Zalo, điện thoại phụ; khoá spec không khai thì giữ giá trị nhập tay.
- Kịch bản: khi tách hồ sơ spec thì 4 khoá thành cột và phần còn lại ở jsonb, khoá không khai thì không bị coi là đổi [test: apps/admin-api/src/modules/tenants/tenants.profile.rules.test.ts » CR-121 · D6 · onboarding ghi CỘT cho 4 khoá chuyển-cột]
- Kịch bản: khi onboard tenant mới thì MST nằm ở cột tax_code, không còn trong jsonb [test: tests/acceptance/NITI/onboard.int.test.ts » onboard]

#### Yêu cầu: Đọc hồ sơ tốn tối đa 2 câu SQL
`GET /admin/tenants/:id/profile` đọc hồ sơ + phòng ban bằng 2 câu theo tập (không SQL theo hàng).
- Kịch bản: khi đọc hồ sơ thì chỉ 2 câu dữ liệu (+1 câu đặt scope RLS) [test: apps/admin-api/src/modules/tenants/tenants.profile.int.test.ts » perf: GET hồ sơ ≤ 2 câu SQL dữ liệu (+1 câu đặt scope RLS)]

#### Yêu cầu: Tab của trang chi tiết công ty
Tab theo thứ tự: Hồ sơ (mặc định) · Ứng dụng · Quy trình (chỉ platform_admin) · Thành viên · Cài đặt, rồi Nhóm · Đối tác · Phân quyền · Agents · Quota. Không còn tab "Tổng quan"; số người dùng, ứng dụng đang bật, số vai nằm trên MỘT dòng ở đầu trang; `?tab=overview` cũ mở Hồ sơ.
- Kịch bản: khi mở công ty không kèm tab thì thấy tab Hồ sơ và không có tab Tổng quan [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts]
- Kịch bản: khi platform_admin sửa tên công ty tại chỗ và chọn CEO thì dữ liệu còn sau khi tải lại [test: e2e/cr121-tenant-profile.spec.ts » CR-121 · sửa tên công ty tại chỗ (Lưu), rồi chọn CEO từ thành viên]
- Kịch bản: khi nhập số nhân viên sai thì hiện câu hướng dẫn, chưa lưu [test: apps/admin-web/src/features/tenants/lib/profile-fields.test.ts » CR-121 · validateField]

## Việc còn lại
- D6 đã làm: ô "Tên công ty" chỉ còn ở Hồ sơ (bỏ khỏi Cài đặt); onboarding ghi cột; API chi tiết công ty không trả 4 khoá cũ của jsonb. Readers của jsonb `profile`: `tenants.repo.tenantProfile` (đã strip 4 khoá) → `TenantDetail.profile` → `lib/profile.ts` (chỉ website/Zalo/điện thoại); `tenant-onboard/adapters/onboard.repo.ts` (lock gộp cột+jsonb); `seed-niti.ts` chỉ chuyển tiếp `profile` hiện có vào OnboardSpec. Hub không đọc `profile`.
- Dữ liệu cũ: jsonb của tenant onboard trước 0035 còn 4 khoá cũ đến lần onboard kế (đã backfill sang cột, API/UI không đọc lại).
- `deploy/tenants/nitigroup.yaml` giữ nguyên khoá `profile.*` (loader tách sang cột).
- Phòng ban hiện chỉ link sang tab Nhóm (chưa có DetailDrawer).
- `hub_ro`: 0035 thu SELECT mức bảng của `admin.tenants`, chỉ GRANT cột cũ — hub-api chỉ đọc id/key/name/active/max_concurrent_sub/timezone/default_app/settings (đã grep), cột mới của tenants mặc định không cấp cho Hub.
