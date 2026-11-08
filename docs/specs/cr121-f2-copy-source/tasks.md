---
id: cr121-f2-copy-source
lát: cr121-f2-copy-source
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: c17
---
## Plan (ngắn)
Lỗi từ e2e `library-readonly-copy.pa.ts`: bản riêng không hiện dòng "Sao từ thư viện: … · vN". Nguyên nhân: `CopySourceLine` lấy công ty từ `useProcessTenant().tenantId`, vốn LUÔN vắng với tenant_admin (Hub tự suy từ phiên) và vắng với platform khi không chọn công ty ⇒ truy vấn bị tắt. Cùng gốc làm `EditorLoadFailure` không bao giờ mở được trang chỉ-xem thư viện cho tenant_admin mở thẳng.

## Làm
- `lib/company-copy.ts`: `copyTenantId(def)` = `tenant_id` của chính bản riêng (một nguồn, không phụ thuộc `?company=`); `viewerTenantId(isPlatform, picked, sessionTenant)` = công ty của phiên cho tenant_admin.
- `ProcessEditorPage.tsx`: `CopySourceLine` dùng `copyTenantId(def)`; `EditorLoadFailure` dùng `viewerTenantId(...)`.

## Test
unit `lib/company-copy.test.ts » CR-121 f2 …`. Không sửa e2e. Perf: không chạm.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/ban-rieng-nguon-thu-vien.md
#### Yêu cầu: Bản riêng luôn ghi nguồn thư viện (CR-121 R8)
Bản riêng của công ty luôn ghi "Sao từ thư viện: <gốc> · vN", công ty lấy từ chính bản riêng (không phụ thuộc đường dẫn mở); tenant_admin mở thẳng quy trình thư viện cũng vào được trang chỉ-xem.
- Kịch bản: công ty của dòng nguồn lấy từ tenant_id của bản riêng; tenant_admin dùng công ty của phiên [test: apps/admin-web/src/features/processes/lib/company-copy.test.ts » CR-121 f2 · công ty của dòng 'Sao từ thư viện' lấy từ chính def]