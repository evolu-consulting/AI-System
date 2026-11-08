---
id: cr112-wizard
lát: cr112-wizard
cr: CR-112
làn: nhanh
migration: không
phụ thuộc: cr112-nav, cr112-apps-tab, cr112-rbac-ui
---
## Plan (ngắn)
Wizard thêm công ty 4 bước tại `/tenants/new` (sidebar "+"), "Onboard lại" ở header workspace, tab Tổng quan (COULD) và tab Quota rút gọn cho tenant_admin. ADM-FR-79 (+ ADM-FR-77 AC4, Q11, Q14). Chỉ web; không đổi backend/contract (mọi GET đã có, `GET /admin/tenants/:id/quotas` đã cho tenant_admin và bỏ tiền).
- Trạng thái wizard nằm trên URL `?tenant=<id>&step=N` (`lib/wizard.ts`): chưa có công ty ⇒ bước 1; có công ty ⇒ resume đúng bước, tối thiểu bước 2; "Onboard lại" = `{tenant, step:2}`.
- Bước 1 `WizardCompanyStep` (form + dialog mật khẩu tạm có sẵn, POST /admin/tenants); bước 2 nhúng nguyên `TenantFeaturesTab`; bước 3 nhúng `RolesPanel` + link "Thêm người dùng ở workspace"; bước 4 = `TenantOverview` (cũng là tab Tổng quan). Bước 3/4 bỏ qua được; "Tiếp tục" khoá khi còn nháp chưa lưu.
- Quota tenant_admin: `TenantQuotaReadonly` chỉ gọi GET quotas (run/token, không tiền, không daily-limits/grants-matrix/packs).

## Làm
- [x] `lib/wizard.ts` + test (resume, skip, tiến/lùi, Onboard lại, validateSearch).
- [x] `components/wizard/*`, `pages/TenantCreatePage.tsx` (wizard), route `new.tsx` validateSearch.
- [x] Header workspace: nút "Onboard lại" (platform_admin, công ty chưa khoá).
- [x] Tab `overview` (đầu danh sách; tenant_admin cũng thấy) + tab `quota` cho tenant_admin (rút gọn).
- [x] i18n vi/en (`tenants.wizard.*`, `tenants.overview.*`, `tenants.quotaRo.*`, `tenants.tab.overview`).
- [x] unit `wizard.test.ts`, `overview.test.ts`, `workspace-tabs.test.ts`; e2e `e2e/cr112-wizard.spec.ts` (3 ca xanh trên DB test riêng).

## Không làm / Chạm
- Không đổi backend, contract, migration. Không sửa e2e có sẵn (agent cr112-e2e-fix làm).
- Tab mặc định khi không có `?tab=` vẫn là Thông tin (đổi sang Tổng quan sẽ làm vỡ nhiều e2e hiện có); Tổng quan đứng đầu danh sách tab.
- Nút của dialog sau tạo công ty đổi nhãn "Đi tới tenant" → "Tiếp tục cấu hình" (đích là bước 2, không phải workspace).

## Test tối thiểu
- unit: `tenants/lib/wizard.test.ts`, `overview.test.ts`, `workspace-tabs.test.ts`.
- e2e: `e2e/cr112-wizard.spec.ts` (đã chạy một lần trên DB riêng `wiz`).

## Quyết định trong lúc làm
- Tab Quota cho tenant_admin là component riêng chỉ đọc, không tái dùng `TenantQuotaTab` (gọi daily-limits/grants-matrix chỉ-platform).
- Bước 2/3 khoá "Tiếp tục/Quay lại/Bỏ qua" khi còn nháp để không mất nháp âm thầm.
- Bước Xem lại làm mới (invalidate) các truy vấn của công ty trước khi hiển thị số liệu.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/wizard-onboard.md
#### Yêu cầu: Wizard thêm công ty 4 bước và Onboard lại (ADM-FR-79)
Wizard `/tenants/new` có 4 bước Thông tin → Ứng dụng & Gói → Phân quyền & Người dùng → Xem lại; bước 1 tạo công ty ngay, các bước sau dùng endpoint có sẵn, trạng thái nằm trên URL nên bỏ ngang vẫn tiếp được; bước 3 và 4 bỏ qua được; "Onboard lại" ở header workspace mở wizard từ bước 2.
- Kịch bản: khi tạo công ty ở bước 1 rồi bấm Thoát thì công ty còn trong DB và workspace mở được, "Onboard lại" mở bước 2, bỏ qua bước 3, Xem lại, Hoàn tất ⇒ tab Tổng quan [test: e2e/cr112-wizard.spec.ts » ADM-FR-79 · AC1,AC2,AC4 · sidebar '+' → bước 1 tạo công ty ngay, Thoát ⇒ công ty còn, 'Onboard lại' mở bước 2, lưu app, bỏ qua bước 3, Xem lại, Hoàn tất ⇒ tab Tổng quan]
- Kịch bản: khi mã công ty trùng thì báo lỗi tại bước 1 và chưa có công ty mới [test: e2e/cr112-wizard.spec.ts » ADM-FR-79 · AC3 · mã trùng 'acme' ⇒ lỗi ngay ở bước 1, chưa có công ty mới, vẫn bước 1]
- Kịch bản: khi URL có công ty thì bước hiện tại là bước đã lưu trên URL (tối thiểu bước 2), chưa có công ty thì luôn bước 1 [test: apps/admin-web/src/features/tenants/lib/wizard.test.ts » chưa có công ty ⇒ bước 1 dù ?step= là gì, có công ty ⇒ resume đúng bước, tối thiểu bước 2]
- Kịch bản: khi bấm Onboard lại thì wizard mở bước 2 trên công ty có sẵn [test: apps/admin-web/src/features/tenants/lib/wizard.test.ts » Onboard lại mở bước 2 trên công ty có sẵn (AC4)]
- Kịch bản: bước 3 và 4 bỏ qua được, bước 1 và 2 thì không [test: apps/admin-web/src/features/tenants/lib/wizard.test.ts » bước 3 và 4 bỏ qua được, bước 1 và 2 thì không (AC2)]

### ADDED admin/tong-quan-quota-rut-gon.md
#### Yêu cầu: Tab Tổng quan và Quota rút gọn cho tenant_admin (ADM-FR-77, Q11, Q14)
Workspace có tab Tổng quan chỉ đọc (số người dùng, ứng dụng đang bật, số vai, quota tháng run/token); tenant_admin thấy thêm tab Quota rút gọn chỉ đọc, không tiền, không gọi route chỉ-platform.
- Kịch bản: khi tenant_admin mở tab Quota thì thấy mức dùng run/token so với giới hạn, không có ô nhập, không có USD và không gọi daily-limits/grants-matrix/packs [test: e2e/cr112-wizard.spec.ts » ADM-FR-77 AC4 · tenant_admin: tab Quota rút gọn chỉ đọc (run/token, không tiền), không gọi route chỉ-platform]
- Kịch bản: khi tóm tắt công ty thì chỉ app đang bật được liệt kê kèm mức cao nhất [test: apps/admin-web/src/features/tenants/lib/overview.test.ts » chỉ liệt kê app đang bật, kèm mức cao nhất, app Tắt và core bị bỏ]
- Kịch bản: khi tenant_admin xem workspace thì thấy thêm tab Tổng quan và Quota [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts]

## Việc còn lại
- e2e có sẵn chịu ảnh hưởng (cr112-e2e-fix): `tenants.spec` (tab đầu giờ là Tổng quan; sau dialog tạo công ty đích là `/tenants/new?tenant=…&step=2`, nút "Tiếp tục cấu hình"), `cr112-nav.spec` (tenant_admin giờ CÓ tab Quota).
