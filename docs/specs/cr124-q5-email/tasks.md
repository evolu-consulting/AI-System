---
id: cr124-q5-email
lát: cr124-q5-email
cr: CR-124
làn: đầy đủ (token/auth công khai, hạn mức, đường ghi hộp thư liên công ty) — Opus soát diff bảo mật sau
migration: hub 0120 (when 1806900100000); gói contracts: không
phụ thuộc: q1 (hub 0117), q3 (hub 0119 + contracts 0085/0086)
---
## Plan (ngắn)
Đường email của hộp thư liên công ty (spec CR-124 §8). Bộ gửi nền lấy dòng `channel='email'` chưa gửi → sinh token 256-bit (chỉ lưu BĂM) → gửi thư tiếng Việt qua
transport email chung của thông báo → trang công khai `/partner-reply/:token` (hub-api, HTML dựng ở máy chủ, không script) cho xem PDF + ba nút → trả lời ghi qua
`hub.partner_email_reply` → `hub.partner_reply_apply` (CÙNG một nơi chuyển `replied` với `hub.partner_reply` của đường nền tảng/thủ công) → bộ chuyển q3 phát `partner.<kết quả>` + `signalEvent`.

## Làm
- hub 0120: cột gửi email (`email_attempts/lease/sent_at/error`) + bảng nhật ký `hub.partner_email_events` (RLS chỉ scope system) + `partner_reply_apply` (nội bộ, một nơi) +
  `partner_reply` giao lại cho `apply` (hành vi không đổi) + `partner_email_claim/view/reply/history` (DEFINER, search_path cố định, REVOKE PUBLIC, kiểm scope/tenant).
- hub-api `partners/`: `domain/email-link.rules.ts` (token, băm, link, IP /24, form, mẫu thư), `adapters/email.repo.ts` (SQL cố định), `email-dispatch.ts` (bộ gửi),
  `adapters/partner-public.routes.ts` + `public-page.view.ts` (trang công khai), `adapters/window-limit.ts` (hạn mức Redis, rơi về trong tiến trình), `partners.public.mount.ts`.
- Gắn: `app.ts` (trang công khai TRƯỚC JWT, giấu token khỏi log request), `app.notify.ts` (vòng gửi email dùng transport thông báo), `PartnerMailboxPort.pdf` (gói Hợp đồng lấy PDF
  đúng một tệp của tenant gửi), `EmailMessage.html` (tuỳ chọn) cho thư có nút, nginx chat-web chuyển `/partner-reply/`.

## Không làm / Chạm
Không chép PDF sang FileBox của B (bên nhận email xem qua link); không UI workspace-web/admin-web (q4); không esign (m4); không DLC; không bật `HUB_PARTNER_MAILBOX` mặc định.
Sửa e2e dùng chung: `_ja-stack.ts` (thêm công ty `q5` + bật `HUB_PARTNER_MAILBOX` cho stack e2e) + `playwright.journey.config.ts` (testMatch thêm spec) — cần qc ghi lại `tests/.lock`.

## Test tối thiểu
unit `partners/domain/email-link.rules.test.ts`; int (evotest, một lần) `partners/email.int.test.ts` (+ chạy lại `mailbox.int.test.ts`, `mailbox-port.int.test.ts` vì `partner_reply` đổi thân);
e2e một lần `journey-approval/cr124-q5-partner-email.spec.ts`.

## Quyết định trong lúc làm
- Token do APP sinh (`crypto.getRandomValues` 32 byte, base64url 43 ký tự) và băm SHA-256 ở app; DB chỉ nhận băm. Tra theo băm qua chỉ mục duy nhất `token_hash` (băm không đảo được
  ⇒ so khớp chỉ mục không lộ thời gian có ích; không so chuỗi token).
- Mỗi lần gửi/vòng = một dòng = một token; "một lần mỗi vòng": trả lời xong link chỉ XEM 7 ngày; hết hạn trả lời còn 7 ngày hiện "liên hệ <công ty gửi>" (không nội dung); sau đó như link sai.
- Hạn mức (Redis cửa sổ cố định): mở 30/giờ/token · PDF 60/giờ/token · trả lời 10/giờ/token · 60 yêu cầu/phút/IP · 10 link sai/10 phút/IP ⇒ 429 + Retry-After. IP lấy phần CUỐI `X-Forwarded-For`.
- CSRF: cookie đôi (HttpOnly, SameSite=Strict, theo token) + `Sec-Fetch-Site`/`Origin`; PRG 303 sau POST. CSP `default-src 'none'` + `style-src 'unsafe-inline'` (không script), `frame-ancestors 'none'`.
- Băm PDF ghi lúc gửi thư (đọc PDF qua cổng gói); trang chỉ phát PDF nếu băm còn khớp. PDF thiếu/không phải PDF ⇒ KHÔNG gửi thư (không link chết), thử lại theo bậc thang.
- `email_sent_at`/trạng thái `delivered` ⇒ bộ chuyển q3 không đụng dòng email (chỉ lấy `channel='platform'`).
- Chưa làm (việc dở): nhắc trước 1 ngày/hết hạn tự động (nhánh Hết hạn của node), "Báo lạm dụng" trong thư, hạn mức 5 lần gửi lại/HĐ/ngày + 200 email đối tác/công ty/ngày (cấu hình nền tảng), hiện nhật ký
  ở thẻ HĐ bên gửi (hàm `partner_email_history` đã có, UI = q4).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/doi-tac-tra-loi-qua-email.md
#### Yêu cầu: Gửi thư tiếng Việt cho bên nhận chưa dùng nền tảng với link riêng có token băm
Dòng hộp thư kênh email được bộ gửi lấy theo lô cố định số câu SQL, sinh token ngẫu nhiên 256-bit chỉ lưu băm, gửi thư tiếng Việt (nút Xem hợp đồng và trả lời, hạn trả lời, ghi rõ không phải chữ ký số) qua transport thông báo; chạy lại không gửi đôi.
- Kịch bản: khi bộ gửi chạy thì thư có link riêng, DB chỉ giữ băm token và băm PDF, chạy lại không gửi đôi [test: apps/hub-api/src/modules/partners/email.int.test.ts » gửi một thư tiếng Việt có link, DB chỉ giữ băm token (không bản rõ), chạy lại không gửi đôi]
- Kịch bản: khi lô 2 dòng hay 40 dòng thì số câu SQL bằng nhau [test: apps/hub-api/src/modules/partners/email.int.test.ts » perf: số câu SQL của bộ gửi cố định (2 dòng = 40 dòng)]
- Kịch bản: khi dựng thư thì chữ nghiệp vụ, HTML thoát ký tự, trường chia sẻ chỉ bốn khoá cho phép [test: apps/hub-api/src/modules/partners/domain/email-link.rules.test.ts » tiếng Việt nghiệp vụ, có link, lý do lần trước, HTML thoát ký tự]
#### Yêu cầu: Trang công khai xem đúng một hợp đồng và trả lời một lần, cùng đường ghi với nền tảng
Link mở không cần đăng nhập, chỉ hiện bản chia sẻ + PDF của đúng lần gửi; ba nút Xác nhận / Trả lại sửa (lý do) / Từ chối (lý do) cùng họ tên + chức vụ; ghi qua `hub.partner_email_reply` → `partner_reply_apply`; bộ chuyển phát `partner.<kết quả>` vào tenant gửi đúng một lần; dùng lại link không ghi đôi; nhật ký ghi IP rút gọn, tên, chức vụ, băm PDF.
- Kịch bản: khi mở link rồi Xác nhận thì dòng hộp thư replied nguồn email, tenant gửi nhận partner.confirmed một lần và nhật ký đủ [test: apps/hub-api/src/modules/partners/email.int.test.ts » mở link: đúng một hợp đồng + PDF, Xác nhận ⇒ partner.confirmed vào tenant GỬI, gửi lại không phát đôi]
- Kịch bản: khi Trả lại sửa thiếu lý do hoặc thiếu họ tên thì 422 và không ghi gì [test: apps/hub-api/src/modules/partners/email.int.test.ts » Trả lại sửa cần lý do, thiếu họ tên bị chặn (422) và không ghi gì]
- Kịch bản: khi người liên hệ mở link, Xác nhận thì lượt phía gửi chạy tiếp (HĐ khoá) [test: e2e/journey-approval/cr124-q5-partner-email.spec.ts » mở link email ⇒ xem HĐ ⇒ Xác nhận ⇒ lượt phía gửi chạy tiếp (HĐ khoá)]
- Kịch bản: khi trả lời đường email thì đúng một lời gọi hàm (số câu SQL cố định) [test: apps/hub-api/src/modules/partners/email.int.test.ts » đường trả lời: số câu SQL cố định (1 lần gọi hàm), không phụ thuộc kích thước]
#### Yêu cầu: Token hết hạn, đã dùng, sai hoặc bị đóng không lộ nội dung; hạn mức và CSRF
Link hết hạn ⇒ 410 chỉ hiện tên công ty gửi; quá 7 ngày hoặc sai ⇒ trang "không hợp lệ"; bên gửi ghi nhận thủ công ⇒ link đóng; quá 30 lần mở/giờ/token hoặc 10 link sai/IP ⇒ 429; POST thiếu/lệch cookie CSRF hoặc cross-site ⇒ 403.
- Kịch bản: khi link quá hạn thì 410 không lộ nội dung và không trả lời được [test: apps/hub-api/src/modules/partners/email.int.test.ts » hết hạn: link quá hạn ⇒ 410 chỉ hiện tên công ty gửi (không nội dung), không trả lời được]
- Kịch bản: khi bên gửi ghi nhận thủ công thì link đóng và người dùng gói không gọi được hàm token [test: apps/hub-api/src/modules/partners/email.int.test.ts » bên GỬI đã ghi nhận thủ công ⇒ link đóng, người dùng gói không gọi được hàm token]
- Kịch bản: khi vượt hạn mức mở hoặc đoán link sai thì 429 kèm Retry-After [test: apps/hub-api/src/modules/partners/email.int.test.ts » quá 30 lần mở/giờ/token ⇒ 429 + Retry-After, 10 link sai/IP ⇒ khoá IP]
- Kịch bản: khi POST thiếu cookie, cookie lệch hoặc cross-site thì 403 và không ghi [test: apps/hub-api/src/modules/partners/email.int.test.ts » CSRF: thiếu cookie, cookie lệch hoặc Sec-Fetch-Site cross-site ⇒ 403 và không ghi]
- Kịch bản: khi lấy IP và so cùng nguồn thì dùng phần cuối X-Forwarded-For và Sec-Fetch-Site/Origin [test: apps/hub-api/src/modules/partners/domain/email-link.rules.test.ts » IP rút gọn /24 và lấy IP cuối XFF (đầu do client tự khai)]
#### Yêu cầu: Cách ly bảng nhật ký email
`hub.partner_email_events` không đọc/ghi thẳng bởi role gói hay scope người dùng; nhật ký của một lần gửi chỉ bên gửi đọc được qua hàm.
- Kịch bản: khi role gói / scope user / tenant khác truy cập thì bị chặn [test: apps/hub-api/src/modules/partners/email.int.test.ts » hub.partner_email_events: role gói và scope user không đọc/ghi thẳng bảng (NFR-01)]
