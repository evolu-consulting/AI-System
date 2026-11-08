# Gửi thư tiếng Việt cho bên nhận chưa dùng nền tảng với link riêng có token băm

Cập nhật: 2026-11-08 · Nguồn: CR-124/125.

## CR-124/125 · Delta gộp 2026-11-08 (đợt cr124-cr125)

#### Yêu cầu: Gửi thư tiếng Việt cho bên nhận chưa dùng nền tảng với link riêng có token băm (nguồn: cr124-q5-email)
Dòng hộp thư kênh email được bộ gửi lấy theo lô cố định số câu SQL, sinh token ngẫu nhiên 256-bit chỉ lưu băm, gửi thư tiếng Việt (nút Xem hợp đồng và trả lời, hạn trả lời, ghi rõ không phải chữ ký số) qua transport thông báo; chạy lại không gửi đôi.
- Kịch bản: khi bộ gửi chạy thì thư có link riêng, DB chỉ giữ băm token và băm PDF, chạy lại không gửi đôi [test: apps/hub-api/src/modules/partners/email.int.test.ts » gửi một thư tiếng Việt có link, DB chỉ giữ băm token (không bản rõ), chạy lại không gửi đôi]
- Kịch bản: khi lô 2 dòng hay 40 dòng thì số câu SQL bằng nhau [test: apps/hub-api/src/modules/partners/email.int.test.ts » perf: số câu SQL của bộ gửi cố định (2 dòng = 40 dòng)]
- Kịch bản: khi dựng thư thì chữ nghiệp vụ, HTML thoát ký tự, trường chia sẻ chỉ bốn khoá cho phép [test: apps/hub-api/src/modules/partners/domain/email-link.rules.test.ts » tiếng Việt nghiệp vụ, có link, lý do lần trước, HTML thoát ký tự]

#### Yêu cầu: Trang công khai xem đúng một hợp đồng và trả lời một lần, cùng đường ghi với nền tảng (nguồn: cr124-q5-email)
Link mở không cần đăng nhập, chỉ hiện bản chia sẻ + PDF của đúng lần gửi; ba nút Xác nhận / Trả lại sửa (lý do) / Từ chối (lý do) cùng họ tên + chức vụ; ghi qua `hub.partner_email_reply` → `partner_reply_apply`; bộ chuyển phát `partner.<kết quả>` vào tenant gửi đúng một lần; dùng lại link không ghi đôi; nhật ký ghi IP rút gọn, tên, chức vụ, băm PDF.
- Kịch bản: khi mở link rồi Xác nhận thì dòng hộp thư replied nguồn email, tenant gửi nhận partner.confirmed một lần và nhật ký đủ [test: apps/hub-api/src/modules/partners/email.int.test.ts » mở link: đúng một hợp đồng + PDF, Xác nhận ⇒ partner.confirmed vào tenant GỬI, gửi lại không phát đôi]
- Kịch bản: khi Trả lại sửa thiếu lý do hoặc thiếu họ tên thì 422 và không ghi gì [test: apps/hub-api/src/modules/partners/email.int.test.ts » Trả lại sửa cần lý do, thiếu họ tên bị chặn (422) và không ghi gì]
- Kịch bản: khi người liên hệ mở link, Xác nhận thì lượt phía gửi chạy tiếp (HĐ khoá) [test: e2e/journey-approval/cr124-q5-partner-email.spec.ts » mở link email ⇒ xem HĐ ⇒ Xác nhận ⇒ lượt phía gửi chạy tiếp (HĐ khoá)]
- Kịch bản: khi trả lời đường email thì đúng một lời gọi hàm (số câu SQL cố định) [test: apps/hub-api/src/modules/partners/email.int.test.ts » đường trả lời: số câu SQL cố định (1 lần gọi hàm), không phụ thuộc kích thước]

#### Yêu cầu: Token hết hạn, đã dùng, sai hoặc bị đóng không lộ nội dung; hạn mức và CSRF (nguồn: cr124-q5-email)
Link hết hạn ⇒ 410 chỉ hiện tên công ty gửi; quá 7 ngày hoặc sai ⇒ trang "không hợp lệ"; bên gửi ghi nhận thủ công ⇒ link đóng; quá 30 lần mở/giờ/token hoặc 10 link sai/IP ⇒ 429; POST thiếu/lệch cookie CSRF hoặc cross-site ⇒ 403.
- Kịch bản: khi link quá hạn thì 410 không lộ nội dung và không trả lời được [test: apps/hub-api/src/modules/partners/email.int.test.ts » hết hạn: link quá hạn ⇒ 410 chỉ hiện tên công ty gửi (không nội dung), không trả lời được]
- Kịch bản: khi bên gửi ghi nhận thủ công thì link đóng và người dùng gói không gọi được hàm token [test: apps/hub-api/src/modules/partners/email.int.test.ts » bên GỬI đã ghi nhận thủ công ⇒ link đóng, người dùng gói không gọi được hàm token]
- Kịch bản: khi vượt hạn mức mở hoặc đoán link sai thì 429 kèm Retry-After [test: apps/hub-api/src/modules/partners/email.int.test.ts » quá 30 lần mở/giờ/token ⇒ 429 + Retry-After, 10 link sai/IP ⇒ khoá IP]
- Kịch bản: khi POST thiếu cookie, cookie lệch hoặc cross-site thì 403 và không ghi [test: apps/hub-api/src/modules/partners/email.int.test.ts » CSRF: thiếu cookie, cookie lệch hoặc Sec-Fetch-Site cross-site ⇒ 403 và không ghi]
- Kịch bản: khi có 1 hoặc 3 proxy tin cậy thì IP client là phần tử thứ hops từ cuối X-Forwarded-For và hai khách khác IP không chung xô hạn mức [test: apps/hub-api/src/modules/partners/domain/email-link.rules.test.ts » IP client theo số proxy tin cậy: 1 hop = phần tử cuối, 3 hop = thứ 3 từ cuối (đầu do client tự khai bị bỏ)]
- Kịch bản: khi đối chiếu cùng nguồn thì chỉ so Origin với Host, bỏ qua X-Forwarded-Host [test: apps/hub-api/src/modules/partners/domain/email-link.rules.test.ts » hai khách khác IP qua 3 hop không dùng chung một xô, X-Forwarded-Host bị bỏ qua]

#### Yêu cầu: Cách ly bảng nhật ký email (nguồn: cr124-q5-email)
`hub.partner_email_events` không đọc/ghi thẳng bởi role gói hay scope người dùng; nhật ký của một lần gửi chỉ bên gửi đọc được qua hàm.
- Kịch bản: khi role gói / scope user / tenant khác truy cập thì bị chặn [test: apps/hub-api/src/modules/partners/email.int.test.ts » hub.partner_email_events: role gói và scope user không đọc/ghi thẳng bảng (NFR-01)]
