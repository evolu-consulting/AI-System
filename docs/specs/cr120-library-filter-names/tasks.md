---
id: cr120-library-filter-names
lát: cr120-library-filter-names
cr: CR-120
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Bảng "Thư viện" của `/processes` (platform_admin): (1) nút phễu + popover lọc App · Việc (khe, nhãn) · Trạng thái · Tenant, chip bỏ được, lưu URL, lọc client trên danh sách đã tải; gom theo app khi chưa chọn app (≥ 2 app). (2) Quy tắc đặt tên: tên = việc làm (các bước), không mã hoá ai/khi nào (CONVENTIONS §11). (3) seed-niti đổi tên 3 quy trình (khoá giữ). (4) Script một lần `rename-process-defs.ts` (chạy thử mặc định, `--apply`), KHÔNG chạy prod.

## Làm
- `lib/library-filter.ts` (+test), `components/library/LibraryFilter.tsx`, `hooks/use-library-rows.ts`, `DataTable` thêm `group`, route search `slot|status|tenant`, i18n vi/en.
- `seed-niti.data.ts`: "Duyệt 2 cấp: Kế toán → Giám đốc" / "Duyệt 1 cấp: Giám đốc" / "Duyệt 1 cấp: Kế toán" (seed đã tự cập nhật tên khi khác ⇒ idempotent).
- `tools/scripts/src/rename-process-defs.ts` (+ `.rules.ts` + test): theo khoá `niti-mua-kd|niti-ban-kd|niti-mua-bgd|hd-mac-dinh`; qua `DefsService.update` (audit) rồi xuất bản lại nếu trước đó không có thay đổi chờ.

## Không làm / Chạm
Không đổi hub/DB schema/migration; không đổi tên trong migration 0069 (def mặc định đổi bằng script). Perf: chỉ lọc mảng đã tải (không thêm request); lọc "đã gán cho tenant X" mới tải danh sách gán của def có tenant (cùng khoá cache ô Tenant).

## Test tối thiểu
Unit: library-filter.test.ts, rename-process-defs.rules.test.ts. typecheck admin-web + scripts, check:bundle. Không chạy e2e.

## Quyết định trong lúc làm
- Tên mặc định `hd-mac-dinh` = "Duyệt 2 cấp: Biên tập → Toàn quyền" (đúng bước: cấp 1 nhóm contracts-editor, cấp 2 contracts-owner).
- Tuỳ chọn tenant lấy từ danh sách tenant gán được; "Mặc định" = def là mặc định của khe; "Chưa gán" = không mặc định và 0 tenant.
- Lọc app dùng chung `?app=` của CR-118.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Lọc danh sách thư viện bằng nút phễu
Bảng Thư viện có nút phễu mở popover lọc theo App, Việc (khe, hiện nhãn), Trạng thái (Nháp/Đã xuất bản), Tenant (đã gán cho …/Chưa gán/Mặc định); bộ lọc bật hiện thành chip bỏ được; lưu ở URL; lọc phía client không gọi thêm API; chưa chọn app thì gom dòng theo app.
- Kịch bản: khi lọc theo app, trạng thái, mặc định, chưa gán hoặc tenant đã gán thì chỉ còn dòng khớp [test: apps/admin-web/src/features/processes/lib/library-filter.test.ts » lọc app / trạng thái / mặc định / chưa gán / theo tenant đã gán]
- Kịch bản: khi URL có giá trị lọc lạ thì bị bỏ và bộ lọc hợp lệ đi vòng qua URL không đổi [test: apps/admin-web/src/features/processes/lib/library-filter.test.ts » parse bỏ giá trị lạ, round-trip qua URL]
- Kịch bản: khi chưa chọn app thì dòng được gom theo app giữ thứ tự [test: apps/admin-web/src/features/processes/lib/library-filter.test.ts » tuỳ chọn app/khe theo nhãn + gom nhóm theo app giữ thứ tự]

#### Yêu cầu: Tên quy trình theo việc làm
Tên quy trình mô tả các bước duyệt ("Duyệt 2 cấp: Kế toán → Giám đốc"), không chứa phòng ban khởi tạo hay loại hợp đồng (thuộc luật chọn quy trình); dòng phụ là nhãn khe. Script một lần đổi tên theo khoá, chạy lại không đổi gì.
- Kịch bản: khi đặt tên theo bảng đổi tên thì mọi tên có dạng "Duyệt N cấp: …" và không mã hoá ai/khi nào [test: tools/scripts/src/rename-process-defs.rules.test.ts » tên mới theo bước, không mã hoá ai/khi nào]
- Kịch bản: khi chạy kế hoạch đổi tên lần hai sau khi áp thì mọi mục là đúng tên [test: tools/scripts/src/rename-process-defs.rules.test.ts » kế hoạch đổi tên idempotent]

## Việc còn lại
- Điều phối: hỏi người dùng trước khi chạy `rename-process-defs.ts --apply` trên prod (chạy thử trước).
- e2e hành trình lọc thư viện (chạy cuối đợt): chưa viết.