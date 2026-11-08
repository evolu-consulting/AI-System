---
id: cr122-fix-reds
lát: cr122-fix-reds
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: B, A
---
## Plan (ngắn)
Sửa 2 unit đỏ có sẵn (uow-boundary, contracts-intake.seed), mẫu "Duyệt theo phòng ban" (nhánh khác X phải qua Trưởng phòng duyệt), helper nhãn cạnh `edgeIssueView`, bỏ skip `flowEdgeIssues = 0` của 3 mẫu.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Mẫu "Duyệt theo phòng ban" không cho ký khi chưa ai duyệt
Hợp đồng của phòng ban không khớp điều kiện vẫn phải qua Trưởng phòng duyệt rồi mới tới Ký số.
- Kịch bản: phòng ban khác X ⇒ nhóm Trưởng phòng duyệt ⇒ gộp ⇒ Ký số [test: apps/hub-api/src/modules/processes/library/flow-templates.def.test.ts]
