---
id: cr122-p16-n2-int
lát: cr122-p16-n2-int
cr: CR-122
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Hai ca int N2 (`defs-flow.int.test.ts`) đỏ vì def test có trigger `contract.submitted`: lát A cấp đầu ra "Bắt đầu khi" (bản ghi + dữ kiện, gồm `contract_id`, `date`) cho mọi cạnh nên trường test coi là "thiếu" đã có sẵn. Đổi hành vi CÓ CHỦ Ý, không phải lỗi sản phẩm.

## Làm
`edgeBody` gửi `trigger: null, app: null` (PUT null ⇒ xoá trigger) để def kiểm cạnh không có hồ sơ cấp trường.

## Không làm / Chạm
Chỉ sửa test. Không đổi code sản phẩm.

## Test tối thiểu
evotest int đúng file defs-flow.int.test.ts.

## Quyết định trong lúc làm
Dùng def không trigger thay vì đổi tên trường: giữ nguyên kịch bản (thiếu bắt buộc ⇒ 422; sai kiểu ⇒ warnings).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

Không thay đổi hành vi (lý do: chỉ sửa dữ liệu test cho khớp hành vi lát A đã có chủ ý — đầu ra Bắt đầu khi có ở mọi cạnh)

## Việc còn lại
Không.
