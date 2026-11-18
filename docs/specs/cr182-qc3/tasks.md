---
id: cr182-qc3
lát: cr182-qc3
cr: CR-182
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Chạy lại phần đỏ cuối đợt 2 sau fix-cr182-wait / fix-cr182-j01.

## Làm
`journey-dot2.spec.ts` (tab «Gõ họ tên», tách ca Gửi lại link, regex bản ký), `partner-sign-link.spec.ts`, `_cr181-kit.prepareSignPlaces` (chờ «Tự đặt theo» bật).

## Không làm / Chạm
Không sửa code sản phẩm.

## Test tối thiểu
e2e cr181, cr127 (j01).

## Quyết định trong lúc làm
Không có.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: lát chỉ sửa e2e)

## Việc còn lại
Lỗi sản phẩm `canResend` (nút «Gửi lại link»); chạy lại `journey-dot2` từ ca «Đã ký» tới hết.
