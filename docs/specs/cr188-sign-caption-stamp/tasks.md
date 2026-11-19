---
id: cr188-sign-caption-stamp
lát: cr188-sign-caption-stamp
cr: CR-188
làn: đầy đủ
migration: hub 0161
phụ thuộc:
---
## Plan (ngắn)
BR-188-1: «Dòng dưới chữ ký» (Họ tên · Chức vụ · Phòng ban) lưu theo phiên bản chữ ký (`hub.user_signatures.caption`, hub 0161), điền sẵn từ hồ sơ khi tạo, sửa được; null ⇒ máy chủ dựng từ hồ sơ lúc ký.
BR-188-2: dấu in = dòng caption + dòng riêng «Ký ngày dd/mm/yyyy hh:mm» (giờ VN, giờ máy chủ) LUÔN in (người ký nội bộ + đối tác); bỏ tuỳ chọn caption ở Cài đặt › Chữ ký.
BR-188-3: «Gõ họ tên» có 6 phông (hàng chọn, nạp lười).

## Làm
- [x] Migration hub 0161: cột `caption` + CHECK ≤ 200; DROP + CREATE `sig_get_active`, `sig_create(+p_caption DEFAULT NULL)`, `signature_for_stamp` (đổi cột OUT nên không dùng CREATE OR REPLACE), cấp lại quyền; giữ `signature_settings.caption` (ngừng đọc, TECH-DEBT #301).
- [x] contracts `signature.ts`: `caption` ở item/create, `profile_caption` ở `MySignatureView`; hub `signaturesRepo.profile()` (1 câu), `profileCaption()`.
- [x] Máy chủ in: `signedOnLine`, `sign-stamp.pdf.ts` in 2 dòng (co chữ 7,5→5 pt, vượt thì cắt «…»), `sign-save.usecase.ts`, `partner-sign-save.ts`, cổng `signHubPort.prepare`.
- [x] Web: ô «Dòng dưới chữ ký» (`SignatureCreator`/`CreateFlow`/`CreateSignatureDialog`), bỏ ngày khỏi xem trước, bỏ nhóm caption ở `SignaturePane`; hàng chọn 6 phông (`signature-fonts.ts`), nạp lười.
- [x] Phông tự host `public/fonts/` + OFL: Pacifico, Lobster, Charm, Great Vibes, Allura (cùng Dancing Script sẵn có).

## Không làm / Chạm
Không làm «Giấy tờ đã ký bằng chữ ký này», Kiểm tra tệp. Không sửa migration cũ, không đổi quyền đọc: người dùng chỉ đọc caption của CHÍNH MÌNH (hàm DEFINER theo `app.user_id`); `signature_png_by_ids` (0157, quản trị) không trả caption.

## Test tối thiểu
unit `sign.rules.test.ts` (signedOnLine), `sign-stamp.pdf.test.ts`, `signature.rules.test.ts`, `signature-fonts.test.ts`, `my-signature.test.tsx`; int `signatures.int.test.ts`, `sign-save.int.test.ts`, `migrate-hub.int.test.ts` (evotest `-Dirty`); e2e `e2e/cr181/first-login-signature.spec.ts` (chưa chạy).

## Quyết định trong lúc làm
- Cả 6 phông đủ glyph tiếng Việt (kiểm bảng cmap của tệp): Great Vibes và Allura CÓ đủ ⇒ giữ nguyên danh sách spec, không thay.
- `sig_create` chuẩn hoá caption ở DB (cắt khoảng trắng, rỗng ⇒ NULL, > 200 ⇒ 22023); người dùng xoá trắng ô ⇒ null ⇒ dựng từ hồ sơ lúc ký (không có cách «không in dòng tên» — spec không đòi).
- Cờ `caption` của từng dấu trong body ký giữ ở contract (tương thích) nhưng máy chủ bỏ qua; web luôn gửi `true`. `sign_marks.caption` nay luôn lưu dòng caption đã in.
- Dấu một phần in cả hai dòng dưới khung; dấu nhiều phần (giáp lai/xoè quạt) in dòng chữ dưới PHẦN CUỐI (soát Opus #1). Khung sát đáy trang không đủ chỗ ⇒ bỏ dòng caption, giữ «Ký ngày …» (soát Opus #2). Dòng dài co chữ tới 5 pt rồi cắt «…».
- Đối tác (ký nhanh, không hồ sơ): dòng dưới = tên người ký/đối tác + «Ký ngày …».
- Bản chữ ký cũ (trước 0161) caption = NULL, không backfill ghi đè ⇒ dựng từ hồ sơ lúc ký.
- Dòng dưới của «chữ ký tắt» (initials) không có ô nhập; dùng hồ sơ lúc ký khi in.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Dấu ký trên tài liệu
Dấu ký in chữ ký + dòng «Họ tên · Chức vụ · Phòng ban» (bản lưu theo phiên bản chữ ký; chưa lưu thì dựng từ hồ sơ lúc ký) + dòng riêng «Ký ngày dd/mm/yyyy hh:mm» theo giờ Việt Nam, giờ máy chủ, LUÔN in; công ty không còn tuỳ chọn tắt ngày.
- Kịch bản: khi ký thì dấu luôn có dòng «Ký ngày …» giờ VN [test: apps/hub-api/src/modules/packs/contracts/domain/sign.rules.test.ts » signedOnLine (BR-188-2)]
- Kịch bản: khi dấu một phần thì in hai dòng và co chữ cho vừa khung [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-stamp.pdf.test.ts » CR-188 · dấu một phần in HAI dòng (caption + «Ký ngày …»); thiếu caption vẫn in dòng ngày]
- Kịch bản: khi dấu nhiều phần thì «Ký ngày …» in ở phần cuối [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-stamp.pdf.test.ts » CR-188 · dấu nhiều phần (giáp lai/xoè quạt): «Ký ngày …» + caption in ở PHẦN CUỐI, các phần trước không in]
- Kịch bản: khi lưu ký thì dòng caption đã lưu được in và ghi vào dấu [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-save.int.test.ts » N2: người có lượt KHÁC người tạo HĐ Lưu được, dấu mang user_signature_id = chữ ký đang dùng (K3), ô đã ký, còn ô ⇒ my_open_fields_left > 0]

### MODIFIED hub/chu-ky-noi-bo.md
#### Yêu cầu: Dòng dưới chữ ký
Màn tạo chữ ký có ô «Dòng dưới chữ ký» điền sẵn Họ tên · Chức vụ · Phòng ban từ hồ sơ, sửa được, lưu theo phiên bản; xem trước không còn ngày. Chỉ chính chủ đọc được dòng này.
- Kịch bản: khi tạo chữ ký có dòng dưới thì lưu và đọc lại đúng, bản cũ giữ dòng riêng [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » lưu rồi đọc lại ở getActive / getActiveAll / signature_for_stamp; bản cũ giữ caption riêng; rỗng ⇒ null]
- Kịch bản: khi người khác đọc thì không thấy dòng dưới của mình [test: apps/hub-api/src/modules/signatures/signatures.int.test.ts » người KHÁC (cùng công ty, công ty khác) không đọc được caption của a1; bảng không đọc trực tiếp]
- Kịch bản: khi hồ sơ có chức vụ, phòng ban thì ô điền sẵn đủ ba phần [test: apps/hub-api/src/modules/signatures/domain/signature.rules.test.ts » profileCaption (BR-188-1)]
- Kịch bản: khi mở màn tạo thì ô dòng dưới điền sẵn và không có ngày [test: apps/workspace-web/src/features/my-signature/my-signature.test.tsx » CR-188 · dòng dưới chữ ký + phông (gõ họ tên)]

#### Yêu cầu: Sáu phông «Gõ họ tên»
«Gõ họ tên» cho chọn Dancing Script, Pacifico, Great Vibes, Allura, Lobster, Charm (tự host, OFL, đủ dấu tiếng Việt), nạp khi dùng.
- Kịch bản: khi kiểm từng phông thì đủ glyph «Nguyễn Thị Ánh Ngọc» [test: apps/workspace-web/src/features/my-signature/lib/signature-fonts.test.ts » sáu phông, khoá và họ phông không trùng; phông mặc định có trong danh sách]
- Kịch bản: khi người dùng chọn phông thì xem trước đổi theo [test: e2e/cr181/first-login-signature.spec.ts » Lần đầu đăng nhập ⇒ tạo chữ ký ⇒ vào app ⇒ «Chữ ký của tôi»]

### REMOVED hub/chu-ky-noi-bo.md
#### Yêu cầu: Tuỳ chọn dòng dưới chữ ký của công ty
Công ty không còn chọn Họ tên/Chức danh/Ngày/Giờ ở Cài đặt › Chữ ký (cột `signature_settings.caption` ngừng đọc).
- Kịch bản: khi quản trị mở Cài đặt chữ ký thì không còn nhóm «Dòng dưới chữ ký» [test: e2e/cr181/first-login-signature.spec.ts » CR-188 · Cài đặt chữ ký không còn tuỳ chọn «Dòng dưới chữ ký» của công ty]

## Việc còn lại
- Chạy e2e cuối đợt (điều phối). Soát Opus: hàm DEFINER 0161 + quyền đọc caption.
- Spec cũ `docs/specs/CR-181` mô tả `settings.caption`: gộp Delta vào `docs/current` ở bước Đóng.
