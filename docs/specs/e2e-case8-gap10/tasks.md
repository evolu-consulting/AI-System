# e2e-case8-gap10 (làn nhanh)

## Plan
1. Gap #10: `gap-b-list.cw.ts:31` timeout ở `getByLabel('Từ ngày')`.
2. Ca 8: 409 STOCK_INSUFFICIENT khi giao vượt tồn không được hiện "Dữ liệu vừa được cập nhật".

## Quyết định
- Gap #10 = LỖI UI (không sửa test). `DateFilterControl`: chọn "Khoảng tuỳ chọn" gọi `onChange({from:"",to:""})`, nhưng trạng thái nằm trên URL và `parseDateSearch`/`dateFilterOf` bỏ giá trị rỗng ⇒ `modeOf` quay về "" ⇒ ô Từ ngày/Đến ngày không bao giờ hiện (người dùng không chọn được khoảng). Sửa: cờ `rangeOpen` ở state cục bộ giữ chế độ "range" khi chưa có ngày.
- Ca 8: code đã đúng (`saveErrorText` + `BUSINESS_409`); test mới xanh ngay lần chạy đầu (không có bước đỏ trước sửa). Hai biến thể: 409 ở settle và ở PATCH items.

## Xong
- [x] DateFilterControl sửa; gap-b-list.cw.ts xanh (4/4)
- [x] e2e/contracts-web/delivery-stock-409.cw.ts xanh (2/2)
