---
id: cr121-c3c-tenants-list
lát: cr121-c3c-tenants-list
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c1b (khuôn danh sách), cr121-c2 (trang chi tiết công ty)
---
## Plan (ngắn)
Áp khuôn ListPage/DetailDrawer/list-filter cho `/tenants`, đúng như Ứng dụng/Tính năng/Lệnh/Agent.

## Làm
- `TenantsPage`: tiêu đề + số đếm, nút "Thêm công ty", phễu lọc chỉ icon (nhóm Trạng thái), chip có xoá, "n / tổng", ô tìm. Gỡ `FilterChips` cũ (một bộ lọc một control).
- `TenantTable`: bấm hàng mở `TenantDrawer` (mã công ty, số người dùng, ứng dụng đang bật, trạng thái) + "Mở trang chi tiết" tới `/tenants/$id?tab=profile`.
- i18n vi+en: `tenants.list.create/what`, `tenants.drawer.*`.
- e2e: sửa `tenants.spec.ts`, `m1-flow.spec.ts` (selector đổi); mới `cr121-tenants-list.spec.ts` (viết, chưa chạy).

## Không làm / Chạm
- Không đổi API/contract; không đụng trang chi tiết (C-2), Tổng quan.

## Test tối thiểu
- Không tách lib lọc mới (dùng `list-filter` đã có unit test). Typecheck + e2e viết sẵn.

## Quyết định trong lúc làm
- Ứng dụng đang bật trong ngăn nạp theo công ty đang mở (`useTenantFeatureStates` + `appsOn`, một request khi mở), không đổi API danh sách.
- Tiêu đề trang + caption bảng đổi "Tenants" thành "Công ty"/"Companies" (i18n), e2e đổi theo.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED admin/tenant-user.md
#### Yêu cầu: Danh sách Công ty theo khuôn danh sách chung
Trang `/tenants` có tiêu đề + số đếm, nút "Thêm công ty", phễu lọc chỉ icon (Trạng thái) với chip có nút xoá và dòng "n / tổng"; bấm hàng mở ngăn tóm tắt (mã, số người dùng, ứng dụng đang bật, trạng thái) có liên kết "Mở trang chi tiết" tới tab Hồ sơ.
- Kịch bản: khi chọn Đã khoá trong phễu thì hiện chip "Trạng thái: Đã khoá" và "n / tổng" giảm; bỏ chip thì đủ lại [test: e2e/cr121-tenants-list.spec.ts » CR-121 · /tenants phễu lọc Đã khoá cho chip và n / tổng, bỏ chip thì đủ lại]
- Kịch bản: khi bấm hàng acme thì mở ngăn tóm tắt và "Mở trang chi tiết" dẫn tới tab Hồ sơ [test: e2e/cr121-tenants-list.spec.ts » CR-121 · /tenants bấm hàng acme mở ngăn tóm tắt và Mở trang chi tiết tới tab Hồ sơ]

## Việc còn lại
- [x] Bộ lọc "Ứng dụng" — xong ở lát cr121-q1-app-filter-contract-label (API `?app=` + `apps[]` + cột/nhóm lọc).
- Chạy e2e `cr121-tenants-list`, `tenants`, `m1-flow` ở cuối đợt.
