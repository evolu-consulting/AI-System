---
id: fix-e2e-drawer-drift
lát: fix-e2e-drawer-drift
cr: CR-103
làn: nhanh
migration: không
phụ thuộc: fnr-editor-drawer
---
## Plan (ngắn)
Ngăn chi tiết giai đoạn đóng mặc định (người dùng chốt 2026-10-29) ⇒ e2e khoá nào giả định ngăn mở sẵn thì thêm bước bấm node (hoặc Esc khi ngăn đè node đích). Không đổi assertion khác.

## qc sửa e2e khoá
Lý do chung: người dùng chốt ngăn đóng mặc định 2026-10-29.
- e2e/P-a/pf4/admin-editor.pa.ts · E-P15b: bấm node "Đọc hoá đơn" trước khi kiểm region "Giai đoạn 1: Đọc hoá đơn".
- e2e/P-b/admin/editor.pb.ts · E-PB08: `openStage1` (bấm node "Phân tích") trước khi dùng region giai đoạn 1, cả trước và sau tải lại.
- e2e/P-b/admin/editor.pb.ts · E-PB09: `openStage1` trước khi dùng region giai đoạn 1.
- e2e/P-b2/admin/canvas.pb2.ts · E-PB2-08: thêm chờ listbox đóng hẳn trước `Escape` (tránh Esc bị popup Select nuốt, flake).
- Đã rà toàn bộ e2e/** (panel, region giai đoạn, ô trong panel): P-b2, P-c, P-c2, P-d, fnr đã bấm node trước; không cần sửa.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: e2e theo ngăn chi tiết đóng mặc định)