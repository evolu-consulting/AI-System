# Admin · Trang công ty có đúng 5 tab cho cả hai vai

Cập nhật: 2026-11-09 · Gộp từ: cr121-c14-company-tabs (đợt cr125-wave).

## Yêu cầu: Trang công ty có đúng 5 tab cho cả hai vai (nguồn: cr121-c14-company-tabs)
Trang công ty có Hồ sơ, Ứng dụng, Quy trình, Thành viên, Cài đặt cho quản trị nền tảng và quản trị công ty. Nhóm, Đối tác, Phân quyền, Agents là mục con của Thành viên; Quota và Khoá công ty nằm ở Cài đặt. Dòng đầu trang nêu số việc có quy trình.
- Kịch bản: cả hai vai thấy đúng 5 tab theo thứ tự [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts » platform_admin VÀ tenant_admin thấy đúng 5 tab theo thứ tự Hồ sơ · Ứng dụng · Quy trình · Thành viên · Cài đặt]
- Kịch bản: khóa tab cũ chuyển sang tab mới kèm mục con [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts » khóa cũ ⇒ tab mới + mục con: info ⇒ settings, features/packs ⇒ apps, users/groups/partners/access/agents ⇒ members, quota ⇒ settings#quota]
- Kịch bản: URL cũ của Phân quyền và route cũ chuyển đúng mục con [test: apps/admin-web/src/features/tenants/lib/workspace-search.test.ts » Phân quyền cũ ?tab=access&view=check ⇒ members/access, mode=check, dạng mới view=access&mode=matrix giữ nguyên]
- Kịch bản: quản trị công ty thấy 5 tab và mục con (hành trình thật) [test: e2e/cr121-c14-tabs.spec.ts » tenant_admin mở công ty mình: đúng 5 tab theo thứ tự, không còn tab Nhóm/Đối tác/Phân quyền/Agents/Quota]
