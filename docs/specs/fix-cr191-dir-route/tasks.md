---
id: fix-cr191-dir-route
lát: fix-cr191-dir-route
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Soát cuối đợt CR-191: gỡ đường ghi cũ `PUT /admin/tenants/:id/directory` (tenant_admin tự bật/tắt danh bạ) vì chỉ quản trị Sổ Hợp Tác được bật/tắt (`PUT /pack/contracts/connect/listing`). GoodsCombo bỏ `setTimeout` cứng ở onBlur.

## Làm
- [x] `tenants.routes.ts` gỡ route + import; `contracts/tenants.ts` gỡ `TenantDirectoryListedRequestSchema`; giữ `directory-verified`.
- [x] `tenants.directory.int.test.ts`: bật danh bạ ghi thẳng DB; ca cũ «chỉ quản trị chính công ty bật/tắt» thay bằng «đường cũ 404 mọi vai».
- [x] `GoodsCombo.tsx`: `onBlur` đóng ngay (mục gợi ý đã `onMouseDown preventDefault` nên không mất click).

## Không làm / Chạm
Không gỡ `setDirectoryListed` (service/repo): `tenant-onboard.run.ts` (CLI vận hành khai công ty) còn dùng. Không đụng admin-web.

## Test tối thiểu
- apps/admin-api/src/modules/tenants/tenants.directory.int.test.ts (evotest)

## Quyết định trong lúc làm
- Giữ hàm service `setDirectoryListed` cho onboarding CLI (ngoài phạm vi route); ghi cho điều phối quyết có đưa onboarding sang đường Sổ Hợp Tác không.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED platform/company-directory.md
#### Yêu cầu: Danh bạ công ty tự nguyện (CR-124 FLOW4-FR-03/04/05, NFR-03/04)
Bật/tắt danh bạ không còn do quản trị công ty tự làm qua admin-api; chỉ quản trị Sổ Hợp Tác qua `PUT /pack/contracts/connect/listing`. Quản trị nền tảng vẫn đặt Đã xác minh.
- Kịch bản: khi ai đó gọi đường cũ PUT /admin/tenants/:id/directory thì bị từ chối (403/404) và cờ không đổi [test: apps/admin-api/src/modules/tenants/tenants.directory.int.test.ts » đường cũ PUT /admin/tenants/:id/directory đã gỡ: mọi vai bị từ chối (403/404), không đổi cờ (CR-191)]

### REMOVED platform/company-directory.md
#### Yêu cầu: Kịch bản «chỉ quản trị chính công ty bật/tắt, thiếu MST ⇒ 422»
Lý do: CR-191 — quyền bật/tắt chuyển cho quản trị Sổ Hợp Tác; đường admin-api cũ gỡ, ca test thay bằng ca bị từ chối.

## Việc còn lại
- Onboarding CLI vẫn bật danh bạ qua `setDirectoryListed` (tenant-onboard.run.ts:143).
- Kịch bản «công tắc bật được» trong docs/current (admin-web directory.test.ts) mô tả UI đã gỡ ở lát trước.
