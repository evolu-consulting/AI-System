---
id: cr112-nav
lát: cr112-nav
cr: CR-112
làn: nhanh
migration: không
phụ thuộc: cr112-tenant-scope
---
## Plan (ngắn)
Sidebar lồng 3 nhóm (Nền tảng · Công ty · Hệ thống) + workspace công ty `/tenants/$tenantId` có tab Người dùng/Nhóm/Đối tác/Phân quyền/Agents nhúng màn có sẵn; route cũ chuyển hướng. ADM-FR-76, ADM-FR-77 (phần web).
- `features/shell/lib/nav.ts`: `navGroups` mới (nhóm `companies` động); `companies.ts` (danh sách công ty theo vai); `SidebarCompanies.tsx` (tìm, "+ Tạo công ty", trạng thái tải/rỗng/lỗi; thu gọn = một biểu tượng).
- Workspace: `lib/workspace-tabs.ts` (thứ tự tab, tenant_admin thấy info/features/users/groups/partners/access/agents), `workspace-search.ts` (search hợp nhất, `view` = tab con Phân quyền), `workspace-context.tsx`, `components/EmbeddedTab.tsx` (nạp lười).
- Màn Users/Groups/Partners/Access/Agents đổi `getRouteApi` sang route workspace, tenant lấy từ context (bỏ ô chọn Tenant, `PageHeader` hạ h2 khi nhúng).
- Route cũ `/users /groups /partners /access` (+ `/agents` cho tenant_admin): `beforeLoad` → `legacyTarget` (giữ query; platform: `?tenant=` rồi công ty chọn gần nhất `ai.lastTenant`, chưa có ⇒ `/tenants`; tenant_admin: công ty mình).

## Làm
- [x] Nav model + sidebar công ty + i18n vi/en (nhóm, ô tìm, nhãn tab).
- [x] Workspace tab theo thứ tự spec; tab Ứng dụng & Gói (key `features`) từ lát apps-tab, tenant_admin xem được (chỉ đọc).
- [x] Redirect route cũ + nhớ công ty chọn gần nhất; sidebar nhớ thu gọn (đã có `ai.sidebarCollapsed`).
- [x] unit: nav theo role, companies, legacy-redirect, workspace-tabs, viewed-tenant; e2e `cr112-nav.spec.ts` (tenant_admin chỉ công ty mình) + sửa e2e chạm sidebar cũ.

## Không làm / Chạm
- Không chạm roles/permissions backend, tab Phân quyền vai (lát app-roles/rbac-ui): tab Phân quyền hiện là màn ma trận/kiểm tra quyền cũ, theo công ty đang mở.
- Tab Tổng quan (COULD), wizard (S7), tab Quota rút gọn cho tenant_admin: chưa làm.
- Không sửa `/groups/new`, `/groups/$id` (editor giữ route riêng).

## Test tối thiểu
- unit `shell/lib/nav.test.ts`, `shell/lib/companies.test.ts`, `tenants/lib/legacy-redirect.test.ts`, `tenants/lib/workspace-tabs.test.ts`.
- e2e `e2e/cr112-nav.spec.ts`; sửa `auth, tenants, m1-flow, users, groups-list, partners, access-matrix, access-user-tab, m3-flow`.

## Quyết định trong lúc làm
- Ô tìm công ty là `type=text` (không `search`) để không va `getByRole("searchbox")` của các màn khác; lọc phía client trên danh sách ≤ 200 (dùng chung cache với trang Tenants).
- Search của workspace gộp mọi bộ lọc tab (q, status, role, page, drawer, org, view…); đổi tab chỉ giữ `tab`. Phân quyền: `?tab=matrix|check` cũ thành `view`.
- tenant_admin giữ mục Quy trình trong nhóm "Chức năng" riêng (không có nhóm Nền tảng); Chi phí/Nhật ký/Góp ý nằm ở Hệ thống.
- Tab nhúng dùng `tenant` của workspace (`resolveWorkspaceTenant`) nên không gọi danh sách tenant thêm.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/sidebar-cong-ty.md
#### Yêu cầu: Sidebar lồng và workspace công ty (ADM-FR-76, ADM-FR-77)
Sidebar có ba nhóm Nền tảng, Công ty, Hệ thống; Người dùng, Nhóm, Đối tác, Phân quyền nằm trong workspace công ty; route cũ chuyển hướng tới tab tương ứng; tenant_admin chỉ thấy công ty mình, không có nhóm Nền tảng và không có ô tìm.
- Kịch bản: khi platform_admin mở khung thì thấy ba nhóm theo thứ tự Nền tảng, Công ty, Hệ thống và các mục Người dùng/Nhóm/Đối tác/Phân quyền không còn trên sidebar [test: apps/admin-web/src/features/shell/lib/nav.test.ts » ADM-FR-76 · platform_admin thấy 3 nhóm Nền tảng · Công ty · Hệ thống đúng thứ tự Q9]
- Kịch bản: khi platform_admin gõ vào ô tìm thì danh sách công ty lọc theo tên hoặc mã [test: apps/admin-web/src/features/shell/lib/companies.test.ts » platform_admin: mọi công ty, lọc theo tên hoặc mã không phân biệt hoa thường]
- Kịch bản: khi mở /users?tenant=<mã> thì chuyển tới tab Người dùng của công ty đó, giữ query; chưa chọn công ty thì về danh sách công ty [test: apps/admin-web/src/features/tenants/lib/legacy-redirect.test.ts » platform_admin + ?tenant=<mã> ⇒ workspace công ty đó, giữ query, bỏ tenant]
- Kịch bản: khi tenant_admin mở khung thì sidebar chỉ có công ty mình, không nhóm Nền tảng [test: apps/admin-web/src/features/shell/lib/nav.test.ts » ADM-FR-77 · tenant_admin không có nhóm Nền tảng, chỉ nhóm Công ty (của mình) và Hệ thống]
- Kịch bản: khi tenant_admin mở workspace thì chỉ thấy các tab Thông tin, Ứng dụng & Gói (chỉ xem), Người dùng, Nhóm, Đối tác, Phân quyền, Agents [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts » tenant_admin chỉ thấy info/features/users/groups/partners/access/agents, tab chỉ-platform trên URL ⇒ info]
- Kịch bản: khi tenant_admin vào khung trên trình duyệt thì sidebar chỉ có công ty acme, /users chuyển về tab Người dùng của acme, công ty khác báo không tìm thấy [test: e2e/cr112-nav.spec.ts » ADM-FR-77 · tenant_admin binh: sidebar chỉ có công ty acme, không nhóm NỀN TẢNG, không ô tìm công ty, /users → tab Người dùng của acme, công ty khác ⇒ Không tìm thấy]

## Việc còn lại
- e2e chưa xanh hoặc chưa chạy lại sau nav mới: `partners.spec` (test 4 `/users` badge Đối tác, cần điều tra), `secrets.spec` (nav "Workflows" cũ, có từ trước), `feature-ui.spec` (có từ trước), `m4-overview`, `m4-conflict`, `conflict-users`, `groups-editor`, `groups-members`, `users-groups`, `m4-2fa`: chạy một lần cuối đợt (DB test bị reset giữa chừng khi chạy nhiều spec).
- Tab Quota rút gọn cho tenant_admin; tab Tổng quan; wizard.
