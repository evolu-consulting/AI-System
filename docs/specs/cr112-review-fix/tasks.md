---
id: cr112-review-fix
lát: cr112-review-fix
cr: CR-112
fr: ADM-FR-78, ADM-FR-80, ADM-FR-81
làn: đầy đủ
migration: admin 0032_app_roles_agents_guard.sql (when 1801220000000)
phụ thuộc: cr112-app-roles, cr112 backfill, cr112 workspace-apps
---
## Plan (ngắn)
Sửa lỗi review cuối đợt CR-112: vai tuỳ biến chiếm Group vai mặc định (TB); chốt tenant trong `app_roles_grant_agents`; bật gói
tới đúng mức; tenant_admin không gọi GET packs; nhãn lỗi ROLE_GROUP_MANAGED.

## Làm
- [x] Tạo vai tuỳ biến: khoá `viewer|editor|owner` ⇒ 422 `ROLE_KEY_RESERVED`; công ty chưa có entitlement gói (trần null) ⇒ 422 `PACK_NOT_ROLEABLE`.
- [x] `enablePack`: Group `<k'>-viewer|editor|owner` đang thuộc vai tuỳ biến ⇒ 409 `ROLE_GROUP_CONFLICT {keys}` trước mọi ghi.
- [x] Migration 0032: `admin.app_roles_grant_agents` từ chối (42501) khi scope ≠ platform và `p_tenant` ≠ `app.tenant_id`.
- [x] `PUT /admin/tenants/:id/packs/:k?level=read|write|admin`: chỉ cấp entitlement tới mức đó (vắng ⇒ cả 3 như cũ); tab Ứng dụng gửi mức đích, không cấp Quản trị rồi thu hồi.
- [x] Tab Ứng dụng: tenant_admin không gọi GET packs (403), suy gói từ entitlement + danh sách vai (`derivePacks`).
- [x] i18n: `groups.error.roleManaged` (ROLE_GROUP_MANAGED), `appRoles.error.keyReserved`, `tenants.apps.error.roleGroupConflict`.

## Không làm / Chạm
Không sửa 0031. Không đổi Group/grant của gói khi bật theo mức (vẫn 3 Group + 6 grant; trần do entitlement).

## Test tối thiểu
- int `apps/admin-api/src/modules/app-roles/app-roles.review.int.test.ts` (+ hồi quy service/backfill int, N1 admin-packs).
- unit `apps/admin-api/src/modules/packs/packs.rules.test.ts`, `apps/admin-web/src/features/tenants/lib/apps-plan.test.ts`, `apps/admin-web/src/features/app-roles/lib/staging.test.ts`.

## Quyết định trong lúc làm
- Xung đột Group khi bật gói: từ chối (409) thay vì đổi tên — không tự sửa dữ liệu khách; Group cũ không gắn vai nào vẫn được nhận như trước (readiness #16 / backfill).
- `?level=` là query (PUT vẫn không body) — tương thích client cũ.
- tenant_admin: "số người" của gói = tổng thành viên các vai (có thể đếm trùng người giữ 2 vai) vì không gọi được GET packs.
- Chốt 0032 fail-closed: phiên không đặt `app.scope` cũng bị từ chối (mọi đường gọi hiện có đều qua withScope/withConfigWrite).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Vai tuỳ biến không chiếm vai mặc định và chỉ tạo khi công ty có gói
Tạo vai tuỳ biến chỉ khi công ty có entitlement còn hiệu lực của gói; khoá viewer/editor/owner dành cho vai mặc định. Bật gói từ chối nếu Group vai mặc định đang thuộc vai tuỳ biến, không ghi gì.
- Kịch bản: khi tenant_admin tạo vai cho gói chưa bật thì 422 PACK_NOT_ROLEABLE và không có Group nào được tạo [test: apps/admin-api/src/modules/app-roles/app-roles.review.int.test.ts » ADM-FR-80 · gói chưa bật cho công ty]
- Kịch bản: khi tạo vai với khoá viewer/editor/owner thì 422 ROLE_KEY_RESERVED [test: apps/admin-api/src/modules/app-roles/app-roles.review.int.test.ts » ADM-FR-80 · khoá viewer/editor/owner]
- Kịch bản: khi Group `<k'>-owner` thuộc vai tuỳ biến mà bật gói thì 409 ROLE_GROUP_CONFLICT, không entitlement/grant nào được ghi [test: apps/admin-api/src/modules/app-roles/app-roles.review.int.test.ts » ADM-FR-81 · Group `<k'>-owner` đã thuộc vai tuỳ biến]
- Kịch bản: khi phiên tenant gọi cấp agent vai cho tenant khác thì DB từ chối 42501 [test: apps/admin-api/src/modules/app-roles/app-roles.review.int.test.ts » ADM-FR-80 · scope tenant gọi cho tenant khác]

#### Yêu cầu: Bật gói tới đúng mức từ tab Ứng dụng & Gói
Bật gói nhận mức đích, chỉ cấp entitlement tới mức đó; tab Ứng dụng gửi mức đích nên lỗi ở bước sau không để trần lên Quản trị. tenant_admin xem tab mà không gọi API chỉ dành cho platform.
- Kịch bản: khi bật gói với level=write thì công ty có entitlement read+write, vai Toàn quyền không hiệu lực [test: apps/admin-api/src/modules/app-roles/app-roles.review.int.test.ts » ADM-FR-78 · PUT ?level=write]
- Kịch bản: khi chọn Tắt → Sửa thì kế hoạch bật gói mức Sửa, không thu hồi gì [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts » AC1: Tắt → Sửa]
- Kịch bản: khi tenant_admin mở tab thì trạng thái gói suy từ entitlement + vai [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts » bật ⇔ có entitlement Xem]

## Việc còn lại
- Không có.
