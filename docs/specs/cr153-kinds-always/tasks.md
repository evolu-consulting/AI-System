# cr153-kinds-always — CR-153 («Nhượng quyền» + «Thỏa thuận hợp tác» luôn có ở Thêm giao dịch và Thông tin hợp đồng)

## Plan
Bỏ nhánh 3 loại trong `DealTiles` (G1): luôn 5 loại. «Thêm giao dịch» thêm khối trường riêng khi chọn 2 loại này. API `POST /contracts/deals` đã nhận `deal` 5 loại + `kind_terms` (CR-152d) ⇒ không đổi API.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | `DealTiles` luôn `ALL_DEALS`, bỏ prop `kinds` | `contract-form/components/DealTiles.tsx`, `contract-review/components/InfoPanel.tsx`, `lib/deal.ts` | [x] |
| 2 | «Thêm giao dịch»: khối `KindTermsFields` + `setTerm` | `contract-new/pages/DealNewPage.tsx`, `hooks/use-contract-form.ts` | [x] |
| 3 | Test | `form-model.test.ts`, `e2e/contracts-web/cr153-kinds-always.cw.ts` (viết, chưa chạy) | [x] |

## Quyết định trong lúc làm
- Chi tiết HĐ không phải bước xác nhận: ô loại vẫn khoá (chỉ đọc), chỉ hiện đủ 5 ô.
- Thiếu trường bắt buộc của loại mới ⇒ máy chủ trả lỗi, hiện ở `form.err` (không thêm kiểm tra client).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/hop-dong-loai-kinh-te.md

#### Yêu cầu: Hai loại Nhượng quyền và Thỏa thuận hợp tác luôn hiện
- Kịch bản: khi mở «Thêm giao dịch» thì thấy đủ 5 loại và chọn Nhượng quyền hiện khối trường riêng [test: e2e/contracts-web/cr153-kinds-always.cw.ts » Thêm giao dịch: đủ 5 loại, chọn Nhượng quyền hiện khối trường riêng]
- Kịch bản: khi xem chi tiết HĐ đang hiệu lực thì khối Thông tin hợp đồng hiện đủ 5 loại, chỉ đọc [test: e2e/contracts-web/cr153-kinds-always.cw.ts » Chi tiết HĐ đang hiệu lực: khối Thông tin hợp đồng vẫn hiện đủ 5 loại (khoá, chỉ đọc)]
