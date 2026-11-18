---
id: cr182-partner-api
lát: cr182-partner-api
cr: CR-182
làn: nhanh
migration: pack-contracts 0123
phụ thuộc: s8-sign-api, s9-sign-flow, s10-sign-record (đợt 1)
---
## Plan (ngắn)
«Đối tác ký qua link riêng» (BR-C5, decisions.md §1 R5). Bên A ký đủ mà HĐ còn chỗ ký Bên B ⇒ tạo link (token chỉ lưu băm) + email «Mời ký» tới liên hệ đối tác đầu tiên có email; trang công khai (không JWT, khuôn CR-150) cho đối tác tạo chữ ký nhanh, ký, từ chối; đủ ô Bên B ⇒ thả bước Ký (HĐ «Đã ký»). Chỉ backend + zod; web công khai `/ky/<token>` là lát `cr182-partner-web`.

## Làm
- [x] Migration `0123_cr182_partner_sign_links.sql`: `contracts.partner_sign_links` + `contracts.partner_quick_signatures` (`packs.secure_table`); nới `sign_versions.signed_by` NULL (+ `signer_contact_id`, `signer_label`), `sign_marks.user_signature_id` NULL (+ `quick_signature_id`), ràng buộc `sign_fields_signed_ck` một chiều; 4 hàm DEFINER theo BĂM token (`partner_sign_link_open/quick_put/quick_get/finish`, `search_path` cố định, REVOKE PUBLIC, GRANT `contracts_rw`).
- [x] Zod `packages/contracts/src/pack-contracts/partner-sign.ts` (+ `partner_link` trong `SignSessionOut`).
- [x] Luật thuần `domain/partner-sign.rules.ts` (token/băm, hạn, trạng thái, `canResendLink`, `partnerMarksIssue`, thư mời/đã ký) + test.
- [x] `adapters/partner-sign.repo.ts`, `application/partner-sign.usecase.ts` + `partner-sign-save.ts` + `partner-sign-mail.ts` + `partner-sign.deps.ts`; `partner-sign.mount.ts` (resend, trạng thái, cổng công khai, nghe NOTIFY).
- [x] Hub: cổng `kit/application/partner-sign.ports.ts` (+ sổ `partnerSignPort`/`partnerSignMailer`), route công khai `partners/adapters/partner-sign.routes.ts` (`/sign-link/:token…`), mount ở `app.notify.ts`, giấu token ở `request-span.ts`, nginx + edge (`/sign-link/`, log giấu token cho `/sign-link`, `/ky`).
- [x] Luồng: `ondocCounts` thêm ô Bên B; `ondocDone` đòi Bên B ký đủ; `fireIfDone` (Lưu) + `signWaitReady` (NOTIFY `contracts_partner_sign_start`) ⇒ mời đối tác; đối tác ký đủ ⇒ `signFlowHooks.completed`.
- [ ] Hồ sơ duyệt chưa in TÊN đối tác ở dòng «Người ký» (hiện chỉ có chữ ký, `signed_by` rỗng) — việc nhỏ của lát sau.

## Không làm / Chạm
Không web. Không thêm tệp đính kèm vào email (transport thông báo chưa có phần đính kèm) — thư «đã ký» gửi đối tác nhắc mở lại link mời để xem/tải bản đã ký (link `signed` còn xem được kể cả quá hạn). Chạm lõi bước Ký (`sign-flow.engine.ts`, `sign-turn.rules.ts`, `packs.sign-doc.ts`) + bản ký (`sign-versions.repo.ts`) ⇒ soát Opus; route công khai + migration ⇒ soát Opus.

## Test tối thiểu
- unit: `bun test apps/hub-api/src/modules/packs/contracts/domain/partner-sign.rules.test.ts` (+ `sign-turn.rules.test.ts`).
- int evotest: `partner-sign.int.test.ts` (9 ca), `sign-flow.int.test.ts`, `sign-save.int.test.ts`, `sign-on-doc.int.test.ts` (hồi quy bản ký/engine).

## Quyết định trong lúc làm
- Route công khai nằm ở hub `partners/` (hạn mức, CSRF, hash token, kiểm PNG) và gọi gói qua cổng `partnerSignPort` (gói không import module hub); tra link bằng tx scope tenant NIL chỉ để gọi hàm DEFINER, rồi mọi đọc/ghi sau đó dùng `uow.system(tenant của link)`.
- CSRF của API JSON: cookie `psc` (httpOnly, Strict, path riêng token) đặt ở GET; GET trả `csrf` trong thân; POST gửi header `x-sign-csrf` = cookie (+ cùng nguồn). Không phụ thuộc `HUB_PARTNER_MAILBOX`.
- Bước «Đối tác ký» không thêm stage mới: là phần của bước Ký `ondoc` — bước chỉ xong khi Bên A đủ VÀ không còn ô Bên B mở (`ondocDone`). Bên A đủ lúc Lưu ⇒ `fireIfDone` mời; Bên A đủ từ bước duyệt (Q8) ⇒ `signWaitReady` giữ bước + `pg_notify`, bộ nghe mời (không poll). Đối tác ký đủ ⇒ chốt link CAS trong cùng tx bản ký ⇒ sau COMMIT thả `esign.completed`; Hồ sơ duyệt lập theo đường DONE sẵn có (s10).
- Hạn link = hạn của bước nếu truyền vào, hiện mặc định 7 ngày (lõi chưa đưa hạn bước ra cho gói).
- Đối tác ký đủ khi mọi ô Bên B (mọi tệp cần ký) đã ký; được tự đặt thêm dấu (cả giáp lai) nhưng không bắt buộc. Một lần Lưu = một tệp (`file_id` trong thân).
- Từ chối: chốt link + chuông kèm lý do, KHÔNG dừng lượt chạy; người tải lên bấm «Gửi lại link ký» (thu hồi link cũ, tạo link mới). Liên hệ chưa có email ⇒ chuông «Chưa mời được đối tác ký».
- Chữ ký nhanh in màu xanh, dòng dưới = «Đối tác: <tên liên hệ> · ngày · giờ»; bản ký `signed_by` NULL + `signer_contact_id`; `sign_marks.signer_id` = id liên hệ.
- Test cũ `sign-flow.int.test.ts › D3/C4` (Q6: ô Bên B không chặn) đổi theo đợt 2: còn ô Bên B ⇒ mời đối tác, chưa thả bước.
- `HUB_NOTIFY_MODE=off` ⇒ không có transport ⇒ link ghi ra log `partner-sign-mail-off` (khuôn CR-150) để kiểm.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Mời đối tác ký bằng link riêng khi công ty ký xong
Khi bên A đã ký đủ và hợp đồng còn chỗ ký của Bên B, hệ thống tạo link riêng có hạn (mặc định 7 ngày) và gửi email «Mời ký» tới liên hệ đầu tiên của đối tác có email: tên công ty bên A, tên hợp đồng, số tệp, số chỗ ký, hạn, link `<APP_URL>/ky/<token>`. Link chỉ lưu dạng băm. Gọi lại không gửi trùng. Khi thông báo tắt (`HUB_NOTIFY_MODE=off`) link được ghi ra log để kiểm.
- Kịch bản: khi bên A ký đủ thì tạo link và gửi thư mời có đủ thông tin, DB chỉ giữ băm, gọi lại không gửi trùng [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-sign.int.test.ts » mời ký: mail có tên công ty, tên HĐ, số tệp, số chỗ, hạn, link /ky/<token>, DB chỉ giữ băm, gọi lại không gửi trùng]
- Kịch bản: khi thông báo tắt thì vẫn tạo link và không lỗi [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-sign.int.test.ts » HUB_NOTIFY_MODE=off: không có transport ⇒ vẫn tạo link (ghi ra log), không ném]
- Kịch bản: khi tính hạn, trạng thái và token thì luật thuần cho đúng kết quả [test: apps/hub-api/src/modules/packs/contracts/domain/partner-sign.rules.test.ts » hạn = hạn của bước nếu còn ở tương lai, ngược lại mặc định 7 ngày]
- Kịch bản: khi dựng thư mời thì có tên công ty, số tệp, số chỗ, hạn và link, không chèn được dòng tiêu đề [test: apps/hub-api/src/modules/packs/contracts/domain/partner-sign.rules.test.ts » ghi tên công ty A, tên HĐ, số tệp, số chỗ ký, hạn (giờ VN) và link, chặn xuống dòng trong tiêu đề]

#### Yêu cầu: Link ký của đối tác chỉ mở được đúng hợp đồng và tệp được gửi
Link sai hoặc sai dạng trả 404; hết hạn hoặc đã thu hồi trả 410. Trang chỉ cho xem các tệp cần ký và chỗ ký của Bên B; tệp khác của hợp đồng không mở được (404). Vượt số lần mở trên một link trả 429. POST cần CSRF kép và cùng nguồn.
- Kịch bản: khi dùng token sai, hết hạn hoặc đã thu hồi thì được 404 hoặc 410 [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-sign.int.test.ts » token sai / sai dạng ⇒ 404, hết hạn ⇒ 410, đã thu hồi ⇒ 410]
- Kịch bản: khi mở tệp kèm không được gửi thì 404, chỉ thấy ô của Bên B [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-sign.int.test.ts » link chỉ đọc đúng HĐ và tệp được gửi (tệp kèm không gửi ⇒ 404), không mở được bản huỷ]
- Kịch bản: khi mở quá số lần cho phép thì 429 kèm Retry-After [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-sign.int.test.ts » giới hạn tần suất: vượt số lần mở trên một token ⇒ 429 + Retry-After]
- Kịch bản: khi POST thiếu CSRF hoặc khác nguồn thì 403 [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-sign.int.test.ts » POST không có CSRF / khác nguồn ⇒ 403]

#### Yêu cầu: Đối tác ký bằng chữ ký nhanh, máy chủ in, không nhận ảnh lúc Lưu
Lần đầu đối tác tạo chữ ký nhanh (gõ tên hoặc vẽ, PNG ≤ 200 KB, kiểm magic và kích thước ảnh). Lưu chỉ gửi vị trí: máy chủ in chữ ký nhanh của link, ghi bản mới với người ký là liên hệ đối tác («Đối tác: <tên liên hệ>»), không có tài khoản. Ô của Bên A bị từ chối (403); gửi kèm ảnh bị từ chối (400); chưa có chữ ký nhanh thì 400. Được tự đặt thêm dấu. Ký đủ ô Bên B thì chốt link, hợp đồng «Đã ký», báo người tải lên (chuông) và gửi thư cho đối tác. Ký lại sau khi xong trả 409, xem vẫn được.
- Kịch bản: khi đối tác ký đủ thì hợp đồng hoàn tất, bản ký ghi đúng người, ký lại bị 409 và vẫn xem được [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-sign.int.test.ts » ký: chưa có chữ ký nhanh ⇒ 400, ô Bên A ⇒ 403, có ảnh ⇒ 400, PNG hỏng ⇒ 422, rồi ký ô Bên B + tự đặt thêm ⇒ HĐ hoàn tất, ký lại ⇒ 409, GET vẫn xem được]
- Kịch bản: khi chọn dấu của đối tác thì chỉ ô Bên B chưa ký của đúng tệp được vào ô, dấu tự đặt thêm được [test: apps/hub-api/src/modules/packs/contracts/domain/partner-sign.rules.test.ts » ô Bên A / ô tệp khác / ô đã ký ⇒ forbidden, ô Bên B chưa ký của đúng tệp + tự đặt thêm ⇒ ok]
- Kịch bản: khi bước Ký xét xong thì cần cả Bên A và Bên B ký đủ, Bên A đủ mà còn ô Bên B thì mời đối tác và chưa thả bước [test: apps/hub-api/src/modules/packs/sign-flow.int.test.ts » D3/C4 + CR-182 · bước Ký ondoc xong khi đủ ô Bên A VÀ ô Bên B đã ký: Bên A đủ mà còn ô Bên B ⇒ mời đối tác ký, chưa thả bước]

#### Yêu cầu: Đối tác từ chối ký và công ty gửi lại link
Đối tác từ chối phải ghi lý do; link chốt «từ chối», người tải lên nhận chuông kèm lý do; từ chối hoặc ký lại sau đó trả 409. Người tải lên hoặc quản trị bấm «Gửi lại link ký»: link cũ bị thu hồi (410), link mới được gửi; người khác bị từ chối. Phiên ký và trang hợp đồng thấy trạng thái link: đã gửi lúc, mở lúc, hạn, đã ký hoặc từ chối.
- Kịch bản: khi đối tác từ chối thì ghi lý do và báo người tải lên [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-sign.int.test.ts » từ chối: ghi lý do, báo người tải lên kèm lý do, từ chối/ký lại ⇒ 409, thiếu lý do ⇒ 400]
- Kịch bản: khi gửi lại thì link cũ hết dùng, người không phải người tải lên hay quản trị bị từ chối, trạng thái link hiện đủ [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-sign.int.test.ts » gửi lại: chỉ người tải lên/quản trị, link cũ ⇒ 410, link mới mở được, trạng thái link hiện đã gửi/mở/hạn]
- Kịch bản: khi xét ai được gửi lại thì chỉ người tải lên hoặc quản trị [test: apps/hub-api/src/modules/packs/contracts/domain/partner-sign.rules.test.ts » gửi lại: người tải lên hoặc quản trị, người khác không]

## Việc còn lại
- Web công khai `/ky/<token>` + «Gửi lại link ký» ở trang HĐ (lát `cr182-partner-web`); seed demo (lát `cr182-seed`); in tên đối tác ở dòng «Người ký» của Hồ sơ duyệt.
