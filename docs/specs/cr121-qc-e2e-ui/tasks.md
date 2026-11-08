---
id: cr121-qc-e2e-ui
lát: cr121-qc-e2e-ui
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c10, cr121-c12, cr121-c14, cr121-c14b, cr121-c16, cr121-c22
---
## Plan (ngắn)
Sửa e2e UI bám giao diện cũ theo luồng mới của CR-121 C (sidebar phẳng 6 mục, Hệ thống gom lối vào, Công cụ AI, công ty 5 tab, Ứng dụng dạng bảng). Không che lỗi sản phẩm bằng test.

## Làm
- `e2e/support/helpers.ts`: thêm `openSystemEntry` (Hệ thống → thẻ lối vào `system-hub`).
- `ops/system.ops.ts` → `/system-health` qua Hệ thống; tenant_admin: hub không có thẻ Tình trạng, `/system-health` bị chặn.
- `auth.spec.ts`, `secrets.spec.ts`, `m4-usage`, `m4-transfer`: vào Chi phí/Secrets/Import-Export qua Hệ thống; menu phẳng.
- `partners.spec.ts` (Đối tác = mục con Thành viên), `tenant-daily-limits` (Quota trong Cài đặt), `tenant-packs` (bảng Ứng dụng `apps-row-*`), `pm-checklist/admin-cr112.pm.ts` (Công ty → bảng → workspace; Phân quyền = Thành viên › Phân quyền).
- `cr121-list.spec.ts`, `conflict-commands.spec.ts`: danh sách /commands đã gộp vào /ai-tools (chip Lệnh); ca xung đột bật/tắt chuyển sang công tắc "Bật command" của editor.
- Sửa code (nhỏ): `routes/_authed/tenants/index.tsx` — tenant_admin bấm "Công ty" ở sidebar (`/tenants`) trước đây vào ForbiddenState; nay chuyển thẳng tới công ty mình.

## Không làm / Chạm
Không sửa code sản phẩm khác. Perf: không.

## Test tối thiểu
evotest e2e jobs root-0/1/2, ops, pm-checklist-pm (-Dirty).

## Quyết định trong lúc làm
- m4-audit "Tải thêm" đỏ trong wave là chập chờn khi tải cao (xanh khi chạy lại), không đổi.
- `features/commands` (CommandsPage, list/*) không còn route nào dùng — mã chết cần dọn (D6), ngoài lát này.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Công ty ở sidebar đưa quản trị công ty vào thẳng công ty của mình
Quản trị công ty (tenant_admin) bấm Công ty ở sidebar thì vào workspace công ty mình, không thấy danh sách công ty.
- Kịch bản: khi binh (tenant_admin) bấm Công ty thì mở /tenants/<công ty acme> [test: e2e/auth.spec.ts]