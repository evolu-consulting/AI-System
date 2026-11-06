---
id: cr121-c14-company-tabs
lát: cr121-c14-company-tabs
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c, c11, c12, c13
---
## Plan (ngắn)
Trang công ty còn đúng 5 tab Hồ sơ · Ứng dụng · Quy trình · Thành viên · Cài đặt cho platform_admin VÀ tenant_admin (Q6). Artboard `Tpl-Settings.dc.html`. Spec R2.

## Làm
- `lib/workspace-tabs.ts`: `TenantTab = profile|apps|processes|members|settings`, `MemberView = users|groups|partners|access|agents`, `legacyTab()` đổi khóa cũ (`info→settings`, `features|packs→apps`, `users|groups|partners|access|agents→members+view`, `quota→settings+at=quota`). `validateWorkspaceSearch` nhận URL cũ và đổi sang tab mới; `?tab=access&view=check` cũ ⇒ `view=access&mode=check` (tham số con của Phân quyền đổi `view`→`mode`).
- `members/MembersTab.tsx`: bộ chọn mục con (Người dùng · Nhóm · Đối tác · Phân quyền · Agents) nhúng màn có sẵn; `settings/SettingsTab.tsx`: thông tin (mã, múi giờ, chạy cùng lúc), ứng dụng mặc định, Quota (`id=quota`, cuộn tới khi `at=quota`), Khoá công ty (chuyển từ đầu trang xuống đây). Phòng ban đã ở Hồ sơ (c10).
- Dòng tóm tắt đầu trang thêm "x/y việc có quy trình" (link sang tab Quy trình khi còn việc chưa có quy trình).
- `/users|groups|partners|access|agents` cũ (`legacyTarget`) ⇒ `tab=members&view=<mục>`.
- Dọn khóa i18n sót (không còn chỗ đọc): `tenants.tab.{overview,info,features,agents,quota,users,groups,partners,access,packs,unavailableBody}`, `appcfg.tab.{processes,companies}`, `tenants.slots.*` (chỉ giữ `routing`), `process.admin.flows.*`.
- SỬA LỖI i18n c11–c13: admin-web nội suy bằng `{x}` (không phải `{{x}}`): đổi toàn bộ chuỗi mới ở `tenants.flows.*`, `tenants.apps.*`, `appcfg.assignNote` sang `{x}`; `AppRow` dùng lại `tenants.features.levelAria` (bị đổi nhầm ở c13).

## Không làm / Chạm
Không: "Gói + Đổi gói" (chưa có khái niệm gói thương mại), thanh lưu gộp một thanh cho cả Cài đặt (còn thanh của TenantInfoForm và Quota riêng).

## Test tối thiểu
- unit: `tenants/lib/workspace-tabs.test.ts`, `workspace-search.test.ts` (khóa cũ → tab mới, Phân quyền cũ), `legacy-redirect.test.ts` (route cũ → Thành viên + mục con).
- e2e (viết, không chạy): `e2e/cr121-c14-tabs.spec.ts` (tenant_admin 5 tab; URL cũ). Sửa (không chạy): `cr112-nav.spec.ts`, `groups-list.spec.ts`, `stg/smoke.stg.ts:164`; `deployed/20-flows-visible` đã sửa ở c13.

## Quyết định trong lúc làm
- `?tab=info` ⇒ `settings` (nội dung Cài đặt cũ), khác bảng spec ghi `profile`.
- `view` là mục con của Thành viên (theo spec); tab con của Phân quyền chuyển sang `mode`. `#quota` thay bằng `at=quota` (search param, không dùng hash).
- Cả hai vai thấy 5 tab; tenant_admin: Hồ sơ/Ứng dụng/Cài đặt chỉ xem, Quota rút gọn, không khoá công ty.

## Khác biệt so với artboard (chưa chụp ảnh — điều phối chụp ở UAT)
- Cài đặt: chưa có "Gói + Đổi gói", chưa có nút chép mã công ty kèm "Đã chép", thanh lưu vẫn riêng (Thông tin / Quota), chưa một thanh "Có thay đổi chưa lưu · Huỷ · Lưu" chung.
- Khoá công ty là khối riêng cuối tab Cài đặt (artboard: nút "Khoá công ty…" kèm mô tả dữ liệu được giữ nguyên), chưa banner "Công ty đang bị khoá" ở đầu trang.
- Thành viên: bộ chọn mục con dạng nút (không phải chip lọc có đếm).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/cong-ty-5-tab.md
#### Yêu cầu: Trang công ty có đúng 5 tab cho cả hai vai
Trang công ty có Hồ sơ, Ứng dụng, Quy trình, Thành viên, Cài đặt cho quản trị nền tảng và quản trị công ty. Nhóm, Đối tác, Phân quyền, Agents là mục con của Thành viên; Quota và Khoá công ty nằm ở Cài đặt. Dòng đầu trang nêu số việc có quy trình.
- Kịch bản: cả hai vai thấy đúng 5 tab theo thứ tự [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts » platform_admin VÀ tenant_admin thấy đúng 5 tab theo thứ tự Hồ sơ · Ứng dụng · Quy trình · Thành viên · Cài đặt]
- Kịch bản: khóa tab cũ chuyển sang tab mới kèm mục con [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts » khóa cũ ⇒ tab mới + mục con: info ⇒ settings, features/packs ⇒ apps, users/groups/partners/access/agents ⇒ members, quota ⇒ settings#quota]
- Kịch bản: URL cũ của Phân quyền và route cũ chuyển đúng mục con [test: apps/admin-web/src/features/tenants/lib/workspace-search.test.ts » Phân quyền cũ ?tab=access&view=check ⇒ members/access, mode=check, dạng mới view=access&mode=matrix giữ nguyên]
- Kịch bản: quản trị công ty thấy 5 tab và mục con (hành trình thật) [test: e2e/cr121-c14-tabs.spec.ts » tenant_admin mở công ty mình: đúng 5 tab theo thứ tự, không còn tab Nhóm/Đối tác/Phân quyền/Agents/Quota]

## Việc còn lại
- Cài đặt: Gói + Đổi gói, chép mã, thanh lưu chung, banner khoá (xem Khác biệt).
- Chưa gỡ `TenantDefaultAppCard`/`TenantQuotaTab` riêng (vẫn dùng trong Cài đặt).