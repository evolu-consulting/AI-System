---
id: cr182-qc4
lát: cr182-qc4
cr: CR-182
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Chạy cr181 cho journey-dot2 + partner-sign-link tới xanh.

## Làm
`journey-dot2.spec.ts` (bản ký tải bằng API, đợi URL phụ lục, toast gửi lại khi tắt thư), `partner-sign-link.spec.ts` (tiêu đề hộp tạo chữ ký).

## Không làm / Chạm
Không sửa code sản phẩm.

## Test tối thiểu
e2e cr181: 41 xanh / 0 đỏ.

## Quyết định trong lúc làm
Không có.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: lát chỉ sửa e2e và chú thích test)

## Việc còn lại
Không.
