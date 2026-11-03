---
id: cr112-rbac-ui
lát: cr112-rbac-ui
cr: CR-112
fr: ADM-FR-80, ADM-FR-82
làn: nhanh
migration: không
phụ thuộc: cr112-app-roles (S1)
---
## Plan (ngắn)
Tab "Vai theo ứng dụng" của màn Phân quyền: khối vai theo app (bảng Vai | Mức | Người | Sửa + Tạo vai), bảng gán người dùng nội bộ vào vai
(Người dùng | Vai hệ thống | Vai theo ứng dụng | Quyền thực tế), "Kiểm tra quyền" từng người, một nút Lưu cho mọi thay đổi chưa lưu.
Dùng API S1 `/admin/app-roles*`; không thêm API.

## Làm
- [x] `features/app-roles/` (api, lib thuần: staging/diff + chạy lô, effective, view, errors, levels; hook `use-roles-draft`; component RolesPanel/RoleBlock/RoleDialog/UserAssignTable/UserRoleCell/CheckPermissionDialog).
- [x] Gắn vào `/access` làm tab đầu và mặc định (`?tab=roles|matrix|check`). `RolesTab` (export default của `RolesPanel.tsx`, props `{tenant:{id}, onDirtyChange?}`) để lát nav nhúng vào tab workspace.
- [x] i18n vi/en khối `appRoles` + `access.tab.roles`.
- [x] Test: unit staging/diff, chạy lô + 409, effective; e2e `e2e/app-roles.spec.ts` (6 ca); sửa `access-matrix`/`m3-flow` (mở tab Ma trận).

## Không làm / Chạm
Không đổi API/contract; không sửa sidebar/routing/tab workspace (lát cr112-nav). Chạm: `routes/_authed/access.tsx` (kiểu search), `features/access/{pages/AccessPage,hooks/use-access-view}`.

## Test tối thiểu
- unit `apps/admin-web/src/features/app-roles/lib/{staging,effective}.test.ts`
- e2e `e2e/app-roles.spec.ts` (platform_admin + tenant_admin acme)

## Quyết định trong lúc làm
- "Kiểm tra quyền" tái dùng `GET /admin/users/:id/effective-access` (đã có): mức theo app = feature `<k'>-read|write|admin` hiệu lực; nguồn = Group của vai ⇒ "qua vai", Group khác ⇒ "quyền ngoài vai", grant_user ⇒ "cấp lẻ". Không tính phía client từ groups+grants.
- App hiển thị = app có vai (từ `GET /admin/app-roles`), không gọi `GET /tenants/:id/packs` (chỉ platform). Bật gói luôn tạo 3 vai mặc định.
- Vai mặc định chỉ đọc trong UI (không đổi tên/mức/xoá); vai tuỳ biến: tạo/sửa tên-mức/xoá. Xoá bị khoá khi vai còn người (sau thay đổi nháp), nháp gỡ người + xoá vai chạy theo thứ tự gỡ ⇒ xoá.
- Lưu = chạy tuần tự (tạo ⇒ sửa ⇒ gán/gỡ ⇒ xoá), dừng ở lỗi đầu. 409 VERSION_CONFLICT hoặc đã ghi dở ⇒ tải lại + bỏ nháp + báo; chưa ghi gì ⇒ giữ nháp.
- Danh sách người: `GET /admin/users?kind=internal` (đối tác không vào vai); trang 50, tìm theo tên/username.
- Tab mặc định của `/access` đổi từ Ma trận sang Vai theo ứng dụng ⇒ `access-matrix`/`m3-flow` thêm bước bấm tab "Ma trận".
- Hạ tầng e2e: cấu hình gốc `playwright.config.ts` dùng chung DB `ai_system_test` giữa các worktree ⇒ chạy song song bị đè dữ liệu; đã chạy bằng DB riêng (`db:test:create rbac`, đặt TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED admin/ung-dung-quyen.md
#### Yêu cầu: Tab Phân quyền theo vai (tạo vai, gán người, Lưu một lượt)
Màn Phân quyền có tab đầu "Vai theo ứng dụng": mỗi app một khối với các vai (mức Quản trị/Sửa/Xem, số người), tạo/sửa/xoá vai tuỳ biến, gán và gỡ người dùng nội bộ; mọi thay đổi là nháp (badge "N thay đổi chưa lưu") và chỉ ghi khi bấm Lưu. platform_admin chọn công ty; tenant_admin chỉ công ty mình.
- Kịch bản: khi tạo vai "Kế toán HĐ" mức Sửa và gán lan rồi Lưu thì Group + grant read/write + thành viên được ghi một lượt [test: e2e/app-roles.spec.ts » ADM-FR-80 · ADM-FR-82 · platform_admin: 3 vai mặc định không sửa/xoá]
- Kịch bản: khi người ở hai vai cùng app thì quyền thực tế là mức cao nhất, bỏ nháp đưa về cũ [test: e2e/app-roles.spec.ts » ADM-FR-82 AC2 · an ở 2 vai cùng app (Chỉ xem + Nhân viên)]
- Kịch bản: khi vai có mức cao hơn trần công ty thì hiện "không hiệu lực" [test: e2e/app-roles.spec.ts » ADM-BR-12 · công ty chỉ có entitlement tới Sửa]
- Kịch bản: khi tenant_admin vào Phân quyền thì thấy vai công ty mình, gán/gỡ người và xoá vai trống (gỡ người trước rồi xoá) [test: e2e/app-roles.spec.ts » ADM-FR-77 · ADM-FR-80 · ADM-FR-82 · tenant_admin (binh, acme)]
- Kịch bản: khi lưu gặp 409 VERSION_CONFLICT thì báo vai đã đổi ở nơi khác, tải lại và bỏ nháp [test: e2e/app-roles.spec.ts » ADM-FR-80 · 409 VERSION_CONFLICT: vai đổi ở nơi khác]
- Kịch bản: khi chỉnh nháp thì chỉ lưu chênh lệch, thứ tự thao tác là tạo ⇒ sửa ⇒ gán/gỡ ⇒ xoá, lỗi dừng lô [test: apps/admin-web/src/features/app-roles/lib/staging.test.ts » thứ tự tạo ⇒ sửa ⇒ gán/gỡ ⇒ xoá]

#### Yêu cầu: Kiểm tra quyền theo app của một người
Từ bảng gán người, "Kiểm tra quyền" cho mức thực tế theo từng app và nguồn: qua vai, "quyền ngoài vai" (Group phòng ban) hoặc cấp lẻ; nguồn vượt trần ghi "không hiệu lực".
- Kịch bản: khi kiểm tra lan (nhóm phòng ban có contracts-read) thì hiện Xem qua nhóm kèm nhãn "quyền ngoài vai", không có dòng "Qua vai" [test: e2e/app-roles.spec.ts » ADM-FR-82 AC5 · Kiểm tra quyền của lan]
- Kịch bản: khi dựng giải thích từ effective-access thì tách vai khỏi quyền ngoài vai và lấy mức cao nhất hiệu lực [test: apps/admin-web/src/features/app-roles/lib/effective.test.ts » quyền qua vai + 'quyền ngoài vai' từ Group phòng ban]

## Việc còn lại
- Gắn vào workspace dưới khoá tab `access` (ACCESS_TAB của apps-tab): trong `TenantDetailPage` một dòng `lazy(() => import("@/features/app-roles/components/RolesPanel"))` + `<TabsContent value="access"><Suspense><RolesTab tenant={tenant} onDirtyChange={…}/></Suspense></TabsContent>` (lát này không sửa shell/workspace theo brief). Khi đó khi đó có thể bỏ tab Ma trận/Kiểm tra quyền cũ hoặc giữ làm công cụ nâng cao.
- Cảnh báo "ghi đè khi sửa grant tay trên Group vai" (spec §13) chưa có ở UI Nhóm.
- e2e `m3-flow` hardcode cổng 3000 nên không chạy được theo làn; bước bấm tab "Ma trận" thêm vào đó chưa kiểm bằng chạy thật.
- Cấu hình e2e gốc nên có DB theo làn (ENV_FILE_VARS) để các worktree chạy song song không đè nhau.
