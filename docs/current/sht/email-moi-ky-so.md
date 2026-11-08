# Email Mời ký có thẻ tóm tắt hợp đồng và ảnh trang đầu, chỉ tới người ký

Cập nhật: 2026-11-08 · Nguồn: CR-124/125.

## CR-124/125 · Delta gộp 2026-11-08 (đợt cr124-cr125)

#### Yêu cầu: Email Mời ký có thẻ tóm tắt hợp đồng và ảnh trang đầu, chỉ tới người ký (nguồn: cr125-x12-sign-email-preview)
Tới lượt người ký công ty, hệ thống gửi đúng một email tiếng Việt (hoặc theo ngôn ngữ người ký) tiêu đề "Mời ký: <tên HĐ> · <đối tác>", có thẻ tóm tắt, ảnh trang 1, một nút "Xem hợp đồng và ký" dẫn tới thẻ ký trên trang hợp đồng (sau đăng nhập) và dòng người gửi; không đính PDF, không điều khoản; người không phải người ký không nhận.
- Kịch bản: khi tới lượt người ký thì chỉ người ký nhận một email có link sâu, trường thẻ và ảnh nhúng [test: apps/hub-api/src/modules/notify/esign-invite.int.test.ts » tới lượt người ký ⇒ MỘT email tới đúng người ký, có link sâu, thẻ tóm tắt và ảnh nhúng, người khác không nhận]
- Kịch bản: khi dựng thư thì có đủ trường thẻ, một nút, chân thư, ảnh CID và thoát HTML [test: apps/hub-api/src/modules/notify/domain/sign-invite-mail.rules.test.ts » thẻ có đủ trường, một nút, chân thư, ảnh nhúng CID, văn bản dự phòng có link]
- Kịch bản: khi không có ảnh hoặc dữ liệu sai dạng thì vẫn có thẻ hoặc dùng thư văn bản thường [test: apps/hub-api/src/modules/notify/domain/sign-invite-mail.rules.test.ts » dữ liệu sai dạng ⇒ null (dùng thư văn bản thường), ảnh base64 sai bị bỏ]

#### Yêu cầu: Ảnh trang đầu dựng một lần mỗi phiên bản hợp đồng và tắt được theo công ty (nguồn: cr125-x12-sign-email-preview)
Ảnh trang 1 dựng ở máy chủ một lần cho mỗi tệp (phiên bản) rồi nhớ; lỗi dựng ⇒ bỏ ảnh giữ thẻ; cài đặt công ty "Kèm ảnh trang đầu trong email mời ký" (mặc định bật) tắt ⇒ không ảnh và không dựng.
- Kịch bản: khi nhiều người ký hoặc gửi lại cùng tệp thì chỉ dựng ảnh một lần [test: apps/hub-api/src/modules/packs/contracts/application/esign-invite.test.ts » perf: nhiều người ký / gửi lại cùng tệp ⇒ dựng ảnh đúng MỘT lần]
- Kịch bản: khi công ty tắt cài đặt thì email không ảnh và không dựng [test: apps/hub-api/src/modules/notify/esign-invite.int.test.ts » công ty tắt 'Kèm ảnh trang đầu' ⇒ email vẫn có thẻ, KHÔNG ảnh và không dựng]
- Kịch bản: khi PDF hợp lệ thì ảnh là JPEG ≤ 560 px dưới 120 KB, PDF hỏng thì null [test: apps/hub-api/src/modules/packs/contracts/adapters/page-thumb.test.ts » PDF hợp lệ ⇒ JPEG rộng ≤ 560 px, nhỏ hơn 120 KB]
