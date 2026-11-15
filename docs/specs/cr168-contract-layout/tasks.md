# cr168-contract-layout — bố cục trang chi tiết HĐ + chọn Loại khi nhập tay [CR-168]

Nguồn: CR-168 (ảnh UAT trang HĐ nháp nhập tay). Phạm vi: `features/contract-review` (ContractBody, ContractHead, DetailLead, InfoPanel), `FormBar`; PATCH `/contracts/:id/fields` nhận thêm `deal` (không migration).

## Delta (so với docs/current)

Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Trang chi tiết HĐ bố cục gọn, đều
Đầu trang: tên + chip trạng thái một hàng, nút chính + «Thao tác» thẳng hàng bên phải cùng hàng tên khi đủ chỗ; dòng thông tin có nhãn rõ (Số HĐ · Loại · Đối tác · File ký · Hồ sơ · Phụ trách). Các khối cách nhau đều. Màn nhập tay: hai cột (thông tin | tệp gốc) bằng nhau, lấp đủ vùng nội dung, màn hẹp xếp dọc. «Tài liệu kèm» giữ nguyên.
- Kịch bản: khi mở HĐ nhập tay trên màn rộng thì nút «Thao tác» cùng hàng với tên và dòng thông tin có nhãn [test: e2e/contracts-web/cr157-manual-fallback.cw.ts » CR-168 · đầu trang: nút cùng hàng với tên, dòng thông tin có nhãn]

#### Yêu cầu: Trang HĐ nháp không còn khối «Khi gửi, hợp đồng sẽ đi qua»
Khối xem trước luồng duyệt bị bỏ khỏi trang chi tiết HĐ (API xem trước vẫn giữ).
- Kịch bản: khi mở HĐ nháp thì không có khối xem trước luồng duyệt [test: e2e/contracts-web/cr157-manual-fallback.cw.ts » CR-168 · không còn khối xem trước luồng duyệt trên trang HĐ nháp]

#### Yêu cầu: Nhập tay chọn được Loại hợp đồng
HĐ nhập tay còn nháp: người dùng chọn Loại (Mua / Bán / Giới thiệu / Nhượng quyền / Thỏa thuận hợp tác); lưu cùng «Lưu nháp». Máy chủ đặt hướng tiền theo loại (Mua ⇒ mua vào; còn lại ⇒ bán ra) đúng ràng buộc `contracts_deal_ck`; trường riêng của Nhượng quyền / Hợp tác bị xoá khi đổi sang loại khác. HĐ không phải nhập tay đổi loại ⇒ 409 `CONTRACT_LOCKED`.
- Kịch bản: khi nhập tay chọn Giới thiệu rồi Lưu nháp thì PATCH gửi deal = referral [test: e2e/contracts-web/cr157-manual-fallback.cw.ts » CR-168 · nhập tay: chọn Loại hợp đồng rồi Lưu nháp gửi deal trong PATCH]
- Kịch bản: khi HĐ nhập tay còn nháp đổi loại thì server ghi loại mới, khi không phải nhập tay thì bị khoá [test: apps/hub-api/src/modules/packs/contracts/application/patch-fields.usecase.test.ts » patchFields · CR-168 đổi Loại HĐ nhập tay]

## Quyết định trong lúc làm
- Nhập tay lưu deal/direction mặc định chỉ khi NULL theo `dealOf` của web (`startManual`); nay người dùng chọn được Loại và PATCH `fields` nhận thêm `deal` (contract: thêm field tuỳ chọn, `fields` rỗng hợp lệ khi có `deal`); direction suy theo loại (buy ⇒ purchase, còn lại ⇒ sale).
- Khối xem trước luồng: chỉ gỡ UI (`SubmitPreview.tsx` xoá); `fetchSubmitPreview`, `lib/submit-preview.ts` và API server để lại (không nơi nào khác render).
- Khoảng cách khối: thân trang `flex flex-col gap-4`, bỏ `mb-*` của khối con bằng `[&>*]:mb-0!`.
- Đổi loại khi nhập tay xoá ô đối tác đã gõ theo loại cũ (khoá ô theo loại, như màn xác nhận AI).
