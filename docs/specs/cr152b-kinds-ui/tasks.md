# cr152b-kinds-ui — CR-152: giao diện hai loại HĐ «Nhượng quyền» + «Thỏa thuận hợp tác»

id: cr152b-kinds-ui · cr: CR-152 · làn: frontend · phụ thuộc: cr152a-kinds-api (đã trên staging-improve) · bản mẫu: `docs/specs/cr152-contract-kinds/prototype.json`

## Plan
Form riêng theo loại (ở bước xác nhận sau AI đọc và khi sửa HĐ nháp), khối tóm tắt + danh sách kỳ ở chi tiết HĐ, hộp ghi doanh thu / đối soát kỳ. Không đụng `features/partners`, `settings/*` (điểm uy tín = cr152c).

## Làm
| # | Việc | File |
|---|---|---|
| 1 | Luật thuần: ô hiện/ẩn, thân PUT, tiền tính ra, số tháng còn lại | `contract-form/lib/kind-terms.ts` (+ test) |
| 2 | Form riêng (Nhượng quyền 3 tab; Hợp tác + banner có chia/không chia), ô AI chưa chắc viền vàng | `contract-form/components/KindTermsFields.tsx` |
| 3 | 5 ô loại HĐ ở bước xác nhận; ẩn giá trị HĐ, kho/bảng SP với 2 loại; lưu trường riêng sau khi đổi loại | `DealTiles.tsx`, `FieldsGrid.tsx`, `InfoPanel.tsx`, `DetailGrid.tsx`, `use-info-form.ts` |
| 4 | Tóm tắt + danh sách kỳ + hộp ghi kỳ (xem số tính ra trước khi lưu) | `contract-review/components/KindSummary.tsx`, `PeriodDialog.tsx` |
| 5 | Nhãn VI/EN, mã lỗi → câu nghiệp vụ | `packages/i18n/locales/contracts/v2f.{vi,en}.json`, `save-error.ts` |

## Quyết định trong lúc làm
- HĐ nhập tay vẫn 3 loại cơ bản: `POST /contracts/manual` chốt HĐ `done` ngay nên không ghi được trường riêng (chỉ ghi khi nháp). Hai loại mới tạo qua tải file → AI đọc → xác nhận (đổi loại được ở đó).
- Nút ghi kỳ là MỘT nút ở khối tóm tắt, chọn kỳ trong hộp (kỳ còn mốc báo cáo mở và mốc phí chưa xác nhận); quyền như sửa mốc (`write`, HĐ chưa bị thay thế, chưa khoá).
- Danh sách HĐ: không có bộ lọc theo loại sẵn; nhãn loại ở cột Loại tự hiện 2 loại mới (thêm khoá i18n).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/loai-hd-nhuong-quyen-hop-tac-ui.md

#### Yêu cầu: Form riêng theo loại hợp đồng
Chọn Nhượng quyền ⇒ ba tab Chung / Phí / Pháp lý; ô «Đã đăng ký Bộ Công Thương» và ngày chỉ hiện khi tick «Bên nhượng quyền ở nước ngoài». Chọn Hợp tác ⇒ cách chia, phần của mình %, kỳ đối soát và banner theo có chia / không chia. Ô AI chưa chắc viền vàng; hai loại không có giá trị HĐ, kho, bảng sản phẩm.
- Kịch bản: khi bên nhượng quyền không ở nước ngoài thì ô Bộ Công Thương ẩn, tick thì hiện [test: apps/workspace-web/src/features/contract-form/lib/kind-terms.test.ts » Bộ Công Thương chỉ hiện khi bên nhượng quyền ở nước ngoài]
- Kịch bản: khi chọn cách tính phí thì chỉ hiện tỷ lệ hoặc số tiền cố định, Hợp tác không chia thì ẩn phần chia [test: apps/workspace-web/src/features/contract-form/lib/kind-terms.test.ts » Nhượng quyền: tỷ lệ hoặc số tiền theo cách tính phí, Hợp tác không chia ẩn phần chia]
- Kịch bản: khi lưu thì số kiểu Việt đổi thành số, ô rỗng hoặc ẩn xoá khoá, % ngoài 0–100 bị chặn [test: apps/workspace-web/src/features/contract-form/lib/kind-terms.test.ts » thân PUT: số kiểu Việt, ô rỗng/ẩn ⇒ null, % ngoài 0–100 ⇒ bad]
- Kịch bản: khi AI chưa chắc một ô thì tô vàng tới khi người sửa [test: apps/workspace-web/src/features/contract-form/lib/kind-terms.test.ts » ô AI chưa chắc tô vàng tới khi người sửa]

#### Yêu cầu: Tóm tắt và ghi kỳ ở chi tiết hợp đồng
Khối tóm tắt: phí ban đầu, phí định kỳ, còn hiệu lực (Nhượng quyền) hoặc cách chia (Hợp tác) kèm danh sách kỳ. Nút «Ghi doanh thu kỳ…» (Nhượng quyền) / «Ghi đối soát kỳ…» (Hợp tác có chia) mở hộp, hiện số tiền tính ra trước khi lưu; người không có quyền sửa mốc không thấy nút; Hợp tác không chia không có nút.
- Kịch bản: khi doanh thu kỳ 820 triệu, phí 5% thì hộp hiện phí 41 triệu, thêm 1% quảng cáo thì 49,2 triệu [test: apps/workspace-web/src/features/contract-form/lib/kind-terms.test.ts » phí kỳ Nhượng quyền: 5% × 820 triệu + 1% quảng cáo = 49,2 triệu, cố định thì lấy số cố định]
- Kịch bản: khi lợi nhuận chung 500 triệu, mình 60% thì mình 300 triệu, đối tác 200 triệu, tổng đúng từng đồng [test: apps/workspace-web/src/features/contract-form/lib/kind-terms.test.ts » chia Hợp tác: mình 60% của 500 triệu = 300 triệu, đối tác 200 triệu, tổng đúng từng đồng]
- Kịch bản: khi hợp đồng còn 36 tháng thì hiện số tháng còn hiệu lực [test: apps/workspace-web/src/features/contract-form/lib/kind-terms.test.ts » số tháng còn hiệu lực]
- Kịch bản: khi người được giao ghi doanh thu kỳ cho HĐ Nhượng quyền thì thấy phí tính ra, lưu xong kỳ hiện số đã ghi [test: e2e/cr152/kinds-ui.spec.ts » Nhượng quyền theo %: tóm tắt phí + ghi doanh thu kỳ thấy phí tính ra rồi lưu]
- Kịch bản: khi Hợp tác không chia thì chỉ có ghi nhớ và không có nút ghi đối soát [test: e2e/cr152/kinds-ui.spec.ts » Hợp tác không chia: chỉ có ghi nhớ, không có nút ghi đối soát]

## Việc còn lại
- Điểm uy tín: lát cr152c. Manual create cho 2 loại mới cần backend (xem báo cáo).
