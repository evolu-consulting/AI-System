---
id: cr182-qc
lát: cr182-qc
cr: CR-182
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
e2e cuối đợt 2: seed công ty `dot2` (quy trình theo vai, vai chưa giao), hành trình `journey-dot2`, sửa e2e khoá theo hành vi mới, chạy evotest.

## Làm
`e2e/cr181/journey-dot2.spec.ts`, `_cr181-stack.ts` (`dot2Company`), `_cr181-kit.ts` (`readPartnerLink`), sửa `j01`/`j03`/`delegation-sign`/`journey-3-vai`/`cr182-assign`, baseline `shell-*` + `s05`/`v2f-detail`, int `esign-node` (DocuSign ẩn).

## Không làm / Chạm
Không sửa code sản phẩm.

## Test tối thiểu
e2e job cr181, contracts-web, cr127, journey-approval; int esign-node.

## Quyết định trong lúc làm
- `_cr127-kit.newPage` có shim tạm cho `Element.scrollTo` (lỗi sản phẩm `PageStage.tsx:115`); gỡ khi sản phẩm sửa.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: lát chỉ thêm/sửa test e2e + int theo hành vi đợt 2 đã có)

## Việc còn lại
Xem báo cáo qc: ca đỏ còn lại do lỗi sản phẩm.
