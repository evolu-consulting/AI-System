---
id: cr125-x12-sign-email-preview
lát: cr125-x12-sign-email-preview
cr: CR-125
làn: đầy đủ nhẹ (dữ liệu hợp đồng đi ra email + migration hub/gói; không RLS mới) — Opus soát diff dữ liệu/PDF sau
migration: hub 0125 (when 1806900700000) · gói contracts 0089 (when 1807000100000)
phụ thuộc: q5 (hub 0120, `EmailMessage.html`), CR-125 m4 (bước Ký số)
---
## Plan (ngắn)
Email "Mời ký số" gửi người ký công ty đúng lúc tới lượt (cùng chỗ phát chuông) đi qua đường thông báo chung (tùy chọn email, thử lại, ngôn ngữ người dùng): chuông mang thêm `data`
(thẻ tóm tắt + ảnh trang 1) lưu ở `hub.notifications.data`; bộ gửi email dựng thư giàu từ chính dòng đó. Không PDF, không điều khoản, không token.

## Làm
- hub 0125: `hub.notifications.data jsonb` (≤ 256 KB) + `notify.enqueue` nhận `data`. Contract `NotifyInput.data`, cổng gói, `dispatch.repo` trả `data`.
- notify (module thông báo): `domain/sign-invite-mail.rules.ts` (tiêu đề "Mời ký: <HĐ> · <đối tác>", thẻ: tên+số HĐ, đối tác, giá trị, hiệu lực, người yêu cầu + ngày, hạn ký; ảnh CID; một nút "Xem hợp đồng và ký";
  chân thư "Thư gửi bởi <người> (<công ty>) qua hệ thống"; vi/en), `emailOf` rẽ nhánh khi `kind='contract.esign'` + có `data`; `EmailMessage.inline` + SMTP đính ảnh nhúng.
- gói contracts: `adapters/page-thumb.ts` (unpdf + `@napi-rs/canvas`: trang 1 → JPEG rộng ≤ 560 px, lỗi ⇒ null), `application/esign-invite.ts` (dựng chuông + thẻ + ảnh, cache theo tệp, tắt theo cài đặt), `esign.repo.inviteCard`
  (MỘT câu SQL), nối ở `esign.mount` (đường cũ `esign-flow`) và `intake.mount` (bước Ký số của flow). Link sâu `/contracts/c/<id>#esign-panel` (đăng nhập xong mở đúng thẻ ký).
- Cài đặt công ty "Kèm ảnh trang đầu trong email mời ký" (mặc định BẬT): gói 0089 `approval_settings.esign_invite_thumbnail`, `PUT /esign/settings {invite_thumbnail}`, ô tick ở Cài đặt › Ký số (workspace-web), i18n vi/en.

## Không làm / Chạm
Không đính PDF; không gửi điều khoản; không trang công khai/token (q5 là của đối tác ngoài, đây là người dùng nội bộ có đăng nhập); không DLC; không canvas/admin-web.
Thêm dependency `@napi-rs/canvas` 1.1.0 (hub-api; `bun.lock` đổi) — native, có bản dựng sẵn win/linux; thiếu/hỏng ⇒ bỏ ảnh, giữ thẻ.

## Test tối thiểu
unit: `sign-invite-mail.rules.test.ts`, `esign-invite.test.ts`, `page-thumb.test.ts`; int (evotest, một lần): `adapters/esign-invite.int.test.ts` (+ chạy lại `esign-node.int.test.ts`, `dispatch-skip.int.test.ts`).

## Quyết định trong lúc làm
- Email đi qua đường thông báo (hàng đợi + tuỳ chọn email của người dùng) thay vì gửi trực tiếp: một nguồn câu chữ cho chuông và email, có thử lại/idempotency của N3; người đã tắt email vẫn nhận chuông.
- Ảnh dựng ở phía gói (có FileBox), nhét base64 (~20–60 KB) vào `data`; cache theo `(tenant, files.id)` trong bộ nhớ (tệp bất biến theo phiên bản; thất bại nhớ 10 phút). Nhiều instance ⇒ mỗi instance tối đa một lần/tệp.
- "Người yêu cầu" = chủ HĐ; thời điểm = lúc tạo phong bì; hạn ký = phong bì `due_h` (vắng ⇒ không dòng).
- Bước Ký số của flow gửi cho MỌI người ký công ty đã chọn: mỗi người một chuông + một email (ảnh dùng chung nhờ cache).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/email-moi-ky-so.md
#### Yêu cầu: Email Mời ký có thẻ tóm tắt hợp đồng và ảnh trang đầu, chỉ tới người ký
Tới lượt người ký công ty, hệ thống gửi đúng một email tiếng Việt (hoặc theo ngôn ngữ người ký) tiêu đề "Mời ký: <tên HĐ> · <đối tác>", có thẻ tóm tắt, ảnh trang 1, một nút "Xem hợp đồng và ký" dẫn tới thẻ ký trên trang hợp đồng (sau đăng nhập) và dòng người gửi; không đính PDF, không điều khoản; người không phải người ký không nhận.
- Kịch bản: khi tới lượt người ký thì chỉ người ký nhận một email có link sâu, trường thẻ và ảnh nhúng [test: apps/hub-api/src/modules/notify/esign-invite.int.test.ts » tới lượt người ký ⇒ MỘT email tới đúng người ký, có link sâu, thẻ tóm tắt và ảnh nhúng, người khác không nhận]
- Kịch bản: khi dựng thư thì có đủ trường thẻ, một nút, chân thư, ảnh CID và thoát HTML [test: apps/hub-api/src/modules/notify/domain/sign-invite-mail.rules.test.ts » thẻ có đủ trường, một nút, chân thư, ảnh nhúng CID, văn bản dự phòng có link]
- Kịch bản: khi không có ảnh hoặc dữ liệu sai dạng thì vẫn có thẻ hoặc dùng thư văn bản thường [test: apps/hub-api/src/modules/notify/domain/sign-invite-mail.rules.test.ts » dữ liệu sai dạng ⇒ null (dùng thư văn bản thường), ảnh base64 sai bị bỏ]
#### Yêu cầu: Ảnh trang đầu dựng một lần mỗi phiên bản hợp đồng và tắt được theo công ty
Ảnh trang 1 dựng ở máy chủ một lần cho mỗi tệp (phiên bản) rồi nhớ; lỗi dựng ⇒ bỏ ảnh giữ thẻ; cài đặt công ty "Kèm ảnh trang đầu trong email mời ký" (mặc định bật) tắt ⇒ không ảnh và không dựng.
- Kịch bản: khi nhiều người ký hoặc gửi lại cùng tệp thì chỉ dựng ảnh một lần [test: apps/hub-api/src/modules/packs/contracts/application/esign-invite.test.ts » perf: nhiều người ký / gửi lại cùng tệp ⇒ dựng ảnh đúng MỘT lần]
- Kịch bản: khi công ty tắt cài đặt thì email không ảnh và không dựng [test: apps/hub-api/src/modules/notify/esign-invite.int.test.ts » công ty tắt 'Kèm ảnh trang đầu' ⇒ email vẫn có thẻ, KHÔNG ảnh và không dựng]
- Kịch bản: khi PDF hợp lệ thì ảnh là JPEG ≤ 560 px dưới 120 KB, PDF hỏng thì null [test: apps/hub-api/src/modules/packs/contracts/adapters/page-thumb.test.ts » PDF hợp lệ ⇒ JPEG rộng ≤ 560 px, nhỏ hơn 120 KB]
