---
id: cr121-c1b-list-drawer
lát: cr121-c1b-list-drawer
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c1-shell
---
## Plan (ngắn)
Khung danh sách "Hướng A" dùng chung (`ListPage`, `DetailDrawer`) áp cho Ứng dụng, Tính năng, Lệnh, Agent.

## Làm
- `components/shared/list/`: `list-filter.ts` (lõi lọc/chip, có unit), `ListPage.tsx` (tiêu đề + số đếm, nút chính, phễu chỉ icon, chip có nút xoá, "n / tổng", `ListEmpty`), `DetailDrawer.tsx` (Sheet: Esc / nền / IconButton đóng, focus trap, ≤420px, full-width ở 375px), `row-click.ts`; `DataTable` thêm `onRowClick`/`activeKey`.
- 4 trang: bộ lọc gom vào phễu, mỗi nhóm một control (Lệnh: Trạng thái/Feature/Workflow; Tính năng: Trạng thái; Ứng dụng: Bật + Đối tượng; Agent: Bật cho công ty). Bấm hàng mở ngăn tóm tắt; ngăn có "Mở trang chi tiết" (Agent chưa có trang chi tiết nên không có liên kết).
- Link tên trong hàng đổi thành chữ (bấm hàng mở ngăn); i18n `common.list.*`, `*.drawer.*`.
- e2e: sửa `commands/features/app-config.spec.ts`; viết (chưa chạy) `e2e/cr121-list.spec.ts`.

## Không làm / Chạm
API, trang chi tiết, route, Công ty (tenants), Quy trình/thư viện, DLC steps.

## Test tối thiểu
`bun test apps/admin-web/src/components/shared/list` · typecheck admin-web (trừ PrefsPanel) · check:bundle · openspec:check.

## Quyết định trong lúc làm
- Agent: lọc theo "Bật cho công ty" (isActive); ô tìm giữ client-side.
- Lỗi cũ "lọc On/Off trùng": Lệnh chỉ còn nhóm Trạng thái (không còn công tắc lọc thứ hai).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/danh-sach.md
#### Yêu cầu: Trang danh sách dùng khung chung
Bộ lọc là nút phễu chỉ icon; mỗi nhóm lọc là một control; giá trị đang lọc hiện thành chip có nút xoá; có dòng "n / tổng"; lọc không khớp hiện "Không có … khớp bộ lọc" kèm "Bỏ lọc".
- Kịch bản: khi chọn lọc Trạng thái "Tắt" ở /commands thì hiện chip và dòng "2 / 5" [test: apps/admin-web/src/components/shared/list/list-filter.test.ts » list-filter]
- Kịch bản: khi bấm hàng thì mở ngăn chi tiết và Esc đóng ngăn [test: e2e/cr121-list.spec.ts » bấm cả hàng mở ngăn]

## Việc còn lại
Chạy e2e `cr121-list.spec.ts` một lần cuối đợt.