---
id: cr121-c22-system-page
lát: cr121-c22-system-page
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c10-admin-nav
---
## Plan (ngắn)
Artboard `scratchpad\cr121-design\project\Main.dc.html` chỉ định nghĩa icon + nhãn "Hệ thống"; bố cục trang theo khuôn trang hiện có (PageHeader + lưới thẻ token shell), không kiểu mới.

## Làm
- `features/system/lib/registry.ts`: MỘT registry lối vào (Chi phí · Nhật ký · Góp ý · Tình trạng hệ thống · Secrets · Nguồn · Bước DLC · Import/Export), lọc theo vai + cờ module đóng băng. Trang hub đọc từ đây.
- `/system` = hub thẻ (tên nghiệp vụ + một dòng mô tả, i18n `system.hub.*` vi+en). Nav: tenant_admin có thêm mục Hệ thống.
- Trang "Tình trạng hệ thống" (CR-104) chuyển từ `/system` sang `/system-health` (cùng nội dung, vẫn platform_admin); ô Sức khoẻ ở Tổng quan trỏ `/system-health`; breadcrumb cập nhật.
- e2e `e2e/cr121-c22-system.spec.ts` (viết, KHÔNG chạy).

## Không làm / Chạm
Không sửa trang đích, API, DLC. Perf: không.

## Test tối thiểu
`bun test apps/admin-web/src/features/system apps/admin-web/src/features/shell apps/admin-web/src/features/overview/lib`.

## Quyết định trong lúc làm
- `/system` đã là trang Tình trạng (CR-104) ⇒ dời sang `/system-health` và liệt kê nó là một thẻ trong hub (không giữ hai lối cho cùng khái niệm).
- Nguồn / Import-Export chỉ hiện khi cờ module đóng băng bật (route đích vốn redirect khi tắt).
- Bẫy tenant_admin: Chi phí (`/usage` ép tenant mình, tenant khác 404), Góp ý (service ép tenant mình), Nhật ký (`requireRole` cả hai vai, tenantSummary ẩn chi tiết nội bộ) đã giới hạn công ty ở API. `/sources` API/trang cho phép tenant_admin nhưng brief chỉ cho platform_admin thấy trong hub; chưa kiểm sâu phạm vi công ty của Nguồn — ghi bẫy.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Màn Hệ thống gom lối vào quản trị chung
`/system` hiển thị thẻ lối vào theo vai từ một registry: platform_admin thấy Chi phí · Nhật ký · Góp ý · Tình trạng hệ thống · Secrets · Nguồn · Bước DLC · Import/Export; tenant_admin thấy Chi phí · Nhật ký · Góp ý và sidebar có mục Hệ thống.
- Kịch bản: khi tenant_admin xem registry thì chỉ có Chi phí, Nhật ký, Góp ý [test: apps/admin-web/src/features/system/lib/registry.test.ts]
- Kịch bản: khi platform_admin xem registry thì thấy đủ 8 mục [test: apps/admin-web/src/features/system/lib/registry.test.ts]
- Kịch bản: khi tenant_admin mở admin thì sidebar có Hệ thống [test: apps/admin-web/src/features/shell/lib/nav.test.ts]
- Kịch bản: khi tenant_admin bấm Hệ thống rồi Chi phí thì vào /usage [test: e2e/cr121-c22-system.spec.ts » CR-121 · tenant_admin: Hệ thống → Chi phí, chỉ thấy các mục của công ty mình]

## Việc còn lại
- Chạy e2e cuối đợt; chụp UAT; kiểm phạm vi công ty của Nguồn nếu mở cho tenant_admin.