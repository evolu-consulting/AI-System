---
id: cr125-g6-contract-settings
lát: cr125-g6-contract-settings
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

## Làm

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Quy trình duyệt chỉ chọn ở một nơi
Thẻ "Quy trình đang áp dụng" ở Cài đặt › Ứng dụng & quy trình chỉ còn MỘT dòng "Đang áp dụng: <tên>" + liên kết "Xem sơ đồ ở mục Quy trình duyệt" (chuyển sang mục Quy trình duyệt); sơ đồ chỉ xem ở mục đó. Cùng trạng thái dùng một chữ/khoá: "Đang hiệu lực" (`contracts.gape.status.active`) và "Đang chờ ký" (`contracts.esign.pending`).
- Kịch bản: khi mở mục Ứng dụng thì thẻ quy trình chỉ có một dòng và liên kết sang Quy trình duyệt, không có nút xem/ẩn sơ đồ [test: thủ công — slot-labels.test.ts đã đổi tên/gộp]
- Kịch bản: khi hiện trạng thái "Đang hiệu lực"/"Đang chờ ký" thì cùng một khoá [test: thủ công — slot-labels.test.ts đã đổi tên/gộp]

(Bản sao khoá `contracts.flow.err.<MÃ>` ở locale v2l/esignflow đã gỡ: không còn nơi đọc; mã lỗi quy trình dùng khoá chuẩn `process.admin.library.form.err.<MÃ>` của G1.)

## Việc còn lại
