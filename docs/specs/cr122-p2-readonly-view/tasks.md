---
id: cr122-p2-readonly-view
lát: cr122-p2-readonly-view
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: E6
---
## Plan (ngắn)
Sửa lỗi sản phẩm qc tìm ở Q1: #2 xem chỉ đọc flow theo sự kiện, #3 Lưu bị chặn không báo, Sao chép flow theo sự kiện bị Hub từ chối (G2).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Xem và sao chép flow Thư viện theo sự kiện
Flow Thư viện có "Bắt đầu khi" mở ra canvas chỉ đọc (có node Bắt đầu khi); công ty sao chép được thành bản riêng (chép trigger/app/các bước, giữ nguồn và phiên bản, chưa xuất bản). Lưu bị chặn luôn báo lý do và bước cần sửa.
- Kịch bản: tenant_admin sao chép flow trigger đã gán ⇒ bản công ty có trigger, chưa xuất bản [test: apps/hub-api/src/modules/processes/library/clone-flow-for-company.int.test.ts]
- Kịch bản: def có trigger ⇒ dựng canvas chỉ đọc [test: apps/admin-web/src/features/processes/lib/library-flow.test.ts]
