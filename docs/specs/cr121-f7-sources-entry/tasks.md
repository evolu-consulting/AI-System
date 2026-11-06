---
id: cr121-f7-sources-entry
lát: cr121-f7-sources-entry
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c
---
## Plan (ngắn)
Lỗi F7: tenant_admin mất lối vào `/sources` (Nguồn) bằng UI — sidebar bỏ mục, thẻ Hệ thống chỉ cho platform_admin, nhưng trang vẫn cho vào.

## Kiểm API
`/admin/sources*` (hub-api `sources.routes.ts`) dùng `requireAdminRole` và `readTenant`/`writeTenant` (`source.rules.ts`): tenant_admin luôn bị ép về công ty của mình (tenant khác ⇒ `SOURCE_NOT_FOUND`), `local_path` chỉ platform_admin, đường dẫn bị ẩn với vai không phải platform; test int `tests/acceptance/P-b/pfs1/sources-authz.int.test.ts` phủ quyền và cách ly công ty. ⇒ AN TOÀN để mở.

## Làm
- `features/system/lib/registry.ts`: mục `sources` cho cả platform_admin và tenant_admin (vẫn ẩn khi module đóng băng tắt); mô tả `system.hub.sources` giữ nguyên ("Nguồn tham chiếu … mà quy trình dùng"), dữ liệu là của công ty mình.

## Không làm / Chạm
Không đổi API/trang Nguồn. Không sửa e2e.

## Test tối thiểu
- unit: `features/system/lib/registry.test.ts » tenant_admin thấy Chi phí · Nhật ký · Góp ý · Nguồn …` (vai + cờ đóng băng).

## Ca e2e cần đổi (qc, không chạy)
- Ca tenant_admin xem màn Hệ thống (`cr121-c22-system.spec.ts`): nay thấy thêm thẻ "Nguồn" (khi module nguồn bật) và mở được `/sources`; ca đếm số thẻ của tenant_admin (3 → 4).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/he-thong-nguon-tenant-admin.md
#### Yêu cầu: Quản trị công ty vào được Nguồn từ màn Hệ thống
Quản trị công ty thấy thẻ Nguồn ở màn Hệ thống (khi module nguồn bật) và chỉ xem/sửa nguồn của công ty mình; đường dẫn máy chủ vẫn chỉ quản trị nền tảng thấy.
- Kịch bản: tenant_admin thấy thẻ Nguồn, ẩn khi module đóng băng tắt [test: apps/admin-web/src/features/system/lib/registry.test.ts » tenant_admin thấy Chi phí · Nhật ký · Góp ý · Nguồn (dữ liệu công ty mình), member không thấy gì]

## Việc còn lại
- e2e hành trình tenant_admin mở Nguồn (qc).