---
id: sign-or-upload
lát: sign-or-upload
cr: CR-141
làn: nhanh
migration: không
phụ thuộc: CR-135c (Hồ sơ), CR-138b (Ký & đối tác)
---
## Plan (ngắn)
Bước «Ký hợp đồng» (node `contracts.esign`) làm MỘT trong hai: ký số (chỉ khi công ty bật) hoặc tải lên bản đã ký (PDF/JPG/PNG). Thay quyết định Q4 cũ (tắt ký số ⇒ báo lỗi `ESIGN_DISABLED`).
Bản tải lên lưu ĐÚNG chỗ bản ký số (G1): `contracts.files` + `esign_envelopes` nhà cung cấp `upload` đã `completed` + `signed_file_id` ⇒ «Hồ sơ», chi tiết HĐ «Đã ký», tải về dùng nguyên. Không migration.
Người được giao tải = người ký của bước (`company_signers` hoặc người bắt đầu), ghi ở sự kiện nội bộ `sign_upload_open` lúc bước mở; Toàn quyền duyệt thay (ghi `override`).

## Làm
- [x] Luật thuần `domain/sign-upload.rules.ts` (+ test): qua bước khi ký số HOẶC có tệp; loại tệp; ai được tải.
- [x] Repo `adapters/sign-upload.repo.ts` + `esign.repo.ts#openSignWait`; use case `application/sign-upload.usecase.ts`; route `GET|POST /contracts/:id/signed-upload`; nối `sign-upload.mount.ts`.
- [x] Tool `contracts-esign-send`: ESIGN_DISABLED ⇒ `awaiting_upload` (không lỗi), bước chờ `esign.completed` do route tải lên bắn.
- [x] int `adapters/sign-upload.int.test.ts` (đường chính, người không được giao, duyệt thay, chéo công ty).
- [x] UI/i18n/e2e: khối «Tải lên bản đã ký», nhãn lịch sử, câu Cài đặt «Ký & đối tác», bỏ cảnh báo `esign_off` (e2e `e2e/journey-approval/cr141-sign-or-upload.spec.ts` viết, chưa chạy).

## Quyết định trong lúc làm
- Phong bì giả `provider='upload'` thay vì bảng/cột mới (một nguồn cho bản đã ký); phong bì ký số còn mở bị huỷ SAU khi thả bước (không bắn `esign.voided`).
- «Người được giao» = người ký của node (`company_signers`); node không chọn người ký ⇒ nhóm «Người ký HĐ» của công ty (`signer_group_id`, Cài đặt › Ký & đối tác) nếu đã đặt (người gửi không tự tải bản ký khi công ty đã có nhóm ký); chưa đặt nhóm ⇒ giữ cũ (thiếu người ký là lỗi nghiệp vụ, CEO-review #2).
- Soát lại: phong bì ký số mở bị huỷ TRƯỚC khi ghi bản tải lên (`latest` sau đó là phong bì upload); `insertSigned` khoá hàng HĐ `for update` ở câu riêng; kiểm chữ ký đầu tệp (%PDF, FFD8FF, 89504E47); nhãn phong bì `upload` = «Bản đã ký tải lên».

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Bước Ký hợp đồng: ký số hoặc tải lên bản đã ký
Bước «Ký hợp đồng» chỉ qua khi người được giao bước ký số xong, hoặc tải lên bản đã ký (PDF, JPG, PNG). Công ty tắt ký số thì bước chỉ còn cách tải lên, không báo lỗi. Bản tải lên là phiên bản «Đã ký» của hợp đồng, hiện trong «Hồ sơ» và chi tiết hợp đồng; lịch sử ghi ai tải, lúc nào, tên tệp. Toàn quyền duyệt thay được và lịch sử ghi rõ duyệt thay.
- Kịch bản: khi người ký được giao (khác người tạo HĐ) tải bản ký thì HĐ có bản «Đã ký», có dòng lịch sử và bước được thả [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-upload.int.test.ts » đường chính: người ký được giao (khác người tạo) tải ⇒ phong bì «upload» đã ký + tệp + dòng lịch sử + thả bước, tải lần hai bị chặn]
- Kịch bản: khi người không được giao tải thì bị chặn, Toàn quyền tải thay thì lịch sử ghi duyệt thay [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-upload.int.test.ts » người không được giao (kể cả người tạo HĐ) bị chặn, không ghi gì, Toàn quyền duyệt thay và ghi rõ]
- Kịch bản: khi tệp không phải PDF/JPG/PNG hoặc bước không còn chờ thì không tải được [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-upload.int.test.ts » định dạng lạ ⇒ file_type, bước chưa mở chờ ⇒ not_awaiting]
- Kịch bản: khi công ty khác tải vào HĐ này thì không thấy HĐ và không ghi gì [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-upload.int.test.ts » chéo công ty ⇒ không thấy HĐ (not_found), không ghi gì]
- Kịch bản: khi chưa ký số và chưa có tệp thì bước chưa qua [test: apps/hub-api/src/modules/packs/contracts/domain/sign-upload.rules.test.ts » qua bước khi đã ký số hoặc đã tải bản ký, không có cái nào thì chưa qua]
