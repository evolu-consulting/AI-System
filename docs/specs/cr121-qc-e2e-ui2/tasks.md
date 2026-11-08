---
id: cr121-qc-e2e-ui2
lát: cr121-qc-e2e-ui2
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-qc-e2e-ui, cr121-r1-processes, cr121-r2-shell-tenants
---
## Plan (ngắn)
Vòng 2 sửa e2e UI theo thiết kế mới (đỏ ngoài phạm vi vòng 1 + ca bị R1/R2 đổi) và gỡ mã chết D6 của danh sách /commands.

## Làm
- e2e: `m4-quota`, `commands`, `cr112-wizard`, `cr112-nav`, `tenants`, `groups-list`, `users`, `access-user-tab`, `usage-analytics`, `m2-flow`, `x1/workflows-side-effect.x1.ts`, `P-a/pf4/admin-processes.pa.ts`, `P-a/pf4/process-library.pa.ts`; helper `_kit/ui.ts openTenantAppsTab` (Công ty → bảng → công ty) và `support/helpers.ts openWorkflowProcessFromNav` (Công cụ AI).
- Code: gỡ `commands/pages/CommandsPage.tsx`, `components/list/*`, `use-command-actions`, `use-command-toggle`, `use-command-fail`, `use-commands-nav` (không ai import). Giữ khả năng XOÁ command: nút "Xoá" ở đầu editor `/commands/$id` (+ `CommandDeleteDialog` chuyển sang `editor-parts/`, về Công cụ AI sau khi xoá).
- Code: `/ai-tools` có nút "Tạo lệnh" và "Tạo workflow" ở đầu trang (trước chỉ có ở trạng thái rỗng ⇒ không còn lối tạo lệnh/workflow).

## Không làm / Chạm
Không đụng `cr121-c-flows`, `c14-tabs`, `c16-ai-tools`, `app-config`, `m1-flow`, `d6b-notify`. Perf: không.

## Quyết định trong lúc làm
- Công tắc bật/tắt command chuyển sang editor (đã có sẵn); ca "hoàn tác 5 giây" của danh sách bỏ vì không còn danh sách.
- Xoá workflow bị chặn: kiểm bằng API (409) vì danh sách /workflows và nút Xoá đã gỡ.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Công cụ AI có lối tạo, editor lệnh có Xoá
Trang Công cụ AI có nút Tạo lệnh và Tạo workflow; trang sửa lệnh có nút Xoá (gõ lại tên) thay cho menu hàng của danh sách lệnh cũ.
- Kịch bản: khi platform_admin mở Công cụ AI thì thấy Tạo lệnh [test: e2e/commands.spec.ts » ADM-FR-20 · M2-R26 · /commands → Công cụ AI (CR-121 c16): chip Lệnh, ô tìm, nút 'Tạo lệnh', hàng /dich đang bật]
- Kịch bản: khi xoá lệnh ở editor thì gõ tên rồi về Công cụ AI [test: e2e/commands.spec.ts » ADM-FR-20 · M2-R26 · xoá /tr-nhanh ở editor: alertdialog 'Xoá /tr-nhanh?' gõ tên → nút 'Xoá command' → toast 'Đã xoá /tr-nhanh' → về Công cụ AI, không còn hàng /tr-nhanh]