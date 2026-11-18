---
id: cr182-qc2
lát: cr182-qc2
cr: CR-182
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Lượt e2e cuối đợt 2: gỡ shim scrollTo, sửa mock cr182-assign, chạy cr181 / contracts-web / cr127 / journey-approval.

## Làm
`_cr127-kit.newPage` (gỡ shim), `cr182-assign.cw.ts` (can_edit cấp danh sách, người thường bấm force), `journey-dot2.spec.ts` (chẩn đoán).

## Không làm / Chạm
Không sửa code sản phẩm.

## Test tối thiểu
e2e cr181, contracts-web, cr127, journey-approval.

## Quyết định trong lúc làm
- `journey-dot2` còn một dòng `collectDiag` (in session của sale) để chẩn đoán lỗi `signStepOf`; gỡ khi sản phẩm sửa.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: lát chỉ sửa e2e)

## Việc còn lại
Lỗi sản phẩm `signStepOf` chặn `partner-sign-link` và `journey-dot2` (xem báo cáo).
