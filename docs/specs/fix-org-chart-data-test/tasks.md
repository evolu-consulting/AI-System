---
id: fix-org-chart-data-test
lát: fix-org-chart-data-test
cr: CR-189
làn: nhanh
migration: không
phụ thuộc: cr189-org-chart-cards
---
## Plan (ngắn)
`org-chart-data.test.ts` (admin-web) đỏ trên staging: `toChartDepts` đã trả `jobTitle` cho mỗi người (BR-189-3/4: danh sách avatar và thẻ phòng hiện chức vụ) nhưng test cũ còn kỳ vọng `{id, name}`. Code đúng theo spec, sửa kỳ vọng của test (thêm ca có chức vụ).

## Làm
- [x] `org-chart-data.test.ts`: kỳ vọng `jobTitle: null` khi chưa nhập, `jobTitle` đúng khi có.

## Không làm / Chạm
Không đổi code sản phẩm. Chạm: `apps/admin-web/src/features/org/lib/org-chart-data.test.ts`.

## Test tối thiểu
unit `bun test apps/admin-web/src/features/org/lib/org-chart-data.test.ts`.

## Quyết định trong lúc làm
- Code đúng, test lạc hậu: `OrgChartPerson.jobTitle` có chủ đích (thẻ phòng/danh sách avatar CR-189), nên sửa test thay vì bỏ `jobTitle` khỏi code.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ cập nhật kỳ vọng test theo hành vi CR-189 đã có).

## Việc còn lại
Không.
