---
id: cr125-fix-docusign-return
lát: cr125-fix-docusign-return
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Bug quay demo 2 (DocuSign sandbox, máy cục bộ): giám đốc ký xong, về trang HĐ vẫn thấy «Đến lượt bạn ký / Ký ngay». Webhook Connect không tới được localhost; việc ghi nhận ký phụ thuộc đúng MỘT lần `POST /esign/refresh` lúc quay về (tham số `?esign=return`), không còn nút làm mới (x2 bỏ nút, x6 bỏ poll).

## Làm
- Web: `useEsign.refresh()` (một lời gọi, idempotent) dùng cho cả lần quay về lẫn nút mới «Cập nhật trạng thái ký» + dòng «Đã kiểm tra lúc …». Quay về làm mới khi có `?esign=return` HOẶC cờ `esign-away:<id>` (sessionStorage, đặt lúc bấm Ký ngay) hoặc `pageshow` từ bộ nhớ đệm (Back) ⇒ không phụ thuộc tham số URL còn sống.
- Web: `esignView` dùng cùng định nghĩa «đã ký» với hub (`signed_at` HOẶC trạng thái completed/signed) ⇒ hết «Ký ngay» dù nhà cung cấp thiếu mốc giờ.
- Web: `?ky=1` mở thẳng bằng cách ký của phong bì / mặc định công ty (`autoSignProvider`); hộp «Chọn cách ký» chỉ khi chưa xác định cách nào. Nút «Ký ngay» thường vẫn hỏi khi có nhiều cách.
- Hub: `mergeSigners` ghép người ký trùng email theo thứ tự (demo dùng một hộp thư) và gán mốc dự phòng khi nhà cung cấp báo `completed` thiếu `signedDateTime`.
- Hub: `signUrl` — người ký công ty bị chặn lượt (người trước ký rồi mà hub chưa biết) ⇒ hỏi nhà cung cấp một lần rồi mới kết luận `ESIGN_NOT_YOUR_TURN`.
- Fake DocuSign: `completeSigner(id, email)` (ký từng người).

## Không làm / Chạm
Không migration, không DLC, không đổi contract/hợp đồng API. Không chạy e2e.

## Test tối thiểu
Unit `esign-view.test.ts`, `esign-merge.test.ts`; int `tests/acceptance/esign-multi/esign-multi.int.test.ts` (evotest -Dirty).

## Quyết định trong lúc làm
- Mốc «kiểm tra lúc» giữ ở phía web (state của hook), không thêm cột/trường hub.
- Không poll nền (Luật 4c); chỉ làm mới theo sự kiện quay về / bấm nút / bị chặn lượt.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Quay về từ nhà cung cấp ký thì trạng thái được cập nhật
Khi người dùng quay về trang HĐ sau khi ký ở nhà cung cấp (có `?esign=return`, hoặc vừa rời trang để ký), web gọi MỘT lần làm mới phong bì từ nhà cung cấp; người ký được ghi nhận đã ký, hết «Đến lượt bạn ký», bước kế chạy khi phong bì xong. Thẻ ký số có nút «Cập nhật trạng thái ký» (kèm «Đã kiểm tra lúc …») cho lúc webhook chậm; gọi lại không đổi kết quả.
- Kịch bản: khi nhà cung cấp báo giám đốc đã ký thì làm mới ghi signed_at, đối tác ký xong thì phong bì hoàn tất, gọi lại không đổi [test: tests/acceptance/esign-multi/esign-multi.int.test.ts » phong bì hoàn tất ở nhà cung cấp ⇒ refresh đầu tiên chuyển hoàn tất + lưu bản đã ký, gọi lại idempotent]
- Kịch bản: khi quay về mất tham số URL thì cờ vừa rời đi ký vẫn kích hoạt làm mới [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » làm mới khi có ?esign=return HOẶC cờ vừa rời đi ký (đường quay về mất tham số)]
- Kịch bản: khi nhà cung cấp báo người ký completed mà thiếu mốc giờ thì không còn Ký ngay [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » nhà cung cấp báo người ký completed mà chưa có signed_at ⇒ coi là đã ký (cùng luật hub): hết 'Ký ngay']
- Kịch bản: khi hai người ký dùng chung email thì trạng thái ghép theo thứ tự [test: apps/hub-api/src/modules/packs/contracts/application/esign-merge.test.ts » cùng một email cho hai người ký ⇒ ghép lần lượt, không dồn cả hai về người đầu]

#### Yêu cầu: «Ký ngay» không bị chặn lượt oan
Khi người ký trước đã ký ở nhà cung cấp mà hub chưa nhận (webhook trễ), `sign-url` hỏi nhà cung cấp một lần trước khi trả 409 `ESIGN_NOT_YOUR_TURN`.
- Kịch bản: khi đối tác ký trước đã ký ở nhà cung cấp thì giám đốc bấm Ký ngay nhận được đường dẫn ký [test: tests/acceptance/esign-multi/esign-multi.int.test.ts » người ký trước (đối tác) đã ký ở nhà cung cấp nhưng hub chưa biết ⇒ Ký ngay của giám đốc không bị chặn lượt (hỏi nhà cung cấp một lần)]

#### Yêu cầu: Link «Mời ký» (`?ky=1`) không hỏi cách ký khi đã xác định
Với `?ky=1` và nhiều nhà cung cấp, nếu phong bì đã có cách ký (hoặc công ty có mặc định) thì mở thẳng trang ký; hộp «Chọn cách ký» chỉ hiện khi người dùng thực sự phải chọn.
- Kịch bản: khi phong bì đã có nhà cung cấp thì `?ky=1` mở thẳng không hỏi [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » ?ky=1 nhiều nhà cung cấp: có cách ký của phong bì / mặc định công ty ⇒ mở thẳng không hỏi, chưa xác định ⇒ null (mới hỏi)]

## Việc còn lại
- Kiểm tay với DocuSign sandbox thật (quay lại sau Finish) khi quay demo; e2e cuối CR.
