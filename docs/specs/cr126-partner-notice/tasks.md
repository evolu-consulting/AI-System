---
id: cr126-partner-notice
lát: cr126-partner-notice
cr: CR-126
làn: nhanh
migration: không
phụ thuộc: cr126-partner-pick-engine (đã gộp)
---
## Plan (ngắn)
Quyết định người dùng 2026-11-09 «Vào app + email báo»: bên nhận B đã trên nền tảng ⇒ vẫn giao vào «Hộp thư đối tác» của B, THÊM lưu email người nhận đã chọn ở `hub.partner_mailbox.to_email` và gửi MỘT thư báo (nút vào hộp thư đối tác trong app, đăng nhập mới trả lời). Kênh email (B chưa trên nền tảng) giữ nguyên.

## Làm
- `partner-send.rules.ts`: `planChannel` nền tảng mang `toEmail` = email đã chọn; `toKeyOf` nền tảng có email gồm cả email (hàm DEFINER `partner_send` đòi cùng `to_email` ở lần trước).
- `partner-send.tool.ts`: nền tảng + có email ⇒ payload thêm `sender_name` (tên pháp lý công khai của A; `hub_rw` không đọc `admin.tenants`), thêm 1 câu `partner_self`; `to_email` đi qua `hub.partner_send` có sẵn.
- Mẫu thư ở GÓI: `domain/partner-notice-mail.rules.ts`, đăng ký qua `PartnerMailboxPort.notice` (kit).
- Hub `partners/`: `adapters/notice.repo.ts` (thuê lô + chốt, tái dùng cột `email_*` của hub 0120) + `notice-dispatch.ts` (`partnerNoticeOnce`, cùng transport email chung ⇒ `HUB_NOTIFY_MODE` tắt thì không gửi, dòng chờ); chạy trong vòng nền cùng `partnerEmailOnce`.

## Không làm / Chạm
Không migration (thuê/thử/lỗi dùng cột sẵn; SQL trực tiếp dưới policy system của bảng). Không e2e. Không đổi đường email. Không có link trả lời không đăng nhập ở kênh nền tảng.

## Test tối thiểu
Unit: `partner-send.rules.test.ts`, `partner-notice-mail.rules.test.ts`. Int: `partner-notice.int.test.ts`.

## Quyết định trong lúc làm
- Không sửa hàm DEFINER `partner_email_claim` (cần migration): claim riêng bằng SQL trực tiếp, lọc `created_at > now() - 31 ngày` để đi theo `partner_mailbox_move_idx`. Nếu số dòng `delivered` lớn, thêm chỉ mục riêng bằng migration ở đợt sau.
- Dòng `held` (B chưa chấp nhận nối) KHÔNG báo; thả sang `sent` thì được báo ở lượt kế.
- Link thư = `<baseUrl>/contracts/partner-inbox` (hộp thư chưa có chọn từng mục theo id).
- Dòng nền tảng cũ (trước lát, `to_email` null) không có thư báo.
- Đổi người nhận giữa các vòng ⇒ khoá khác ⇒ vòng 1 mới (khớp kiểm `prev_id` của DB).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/gui-doi-tac-xac-nhan.md
#### Yêu cầu: Bên nhận đã trên nền tảng vẫn nhận trong Hộp thư đối tác và được báo bằng một email
Khi công ty nhận đã trên nền tảng, lần gửi vẫn vào «Hộp thư đối tác» của họ; email người nhận đã chọn được lưu cùng lần gửi và hệ thống gửi đúng MỘT thư báo («<Công ty gửi> gửi hợp đồng <tên> cần anh/chị xác nhận») có nút vào hộp thư đối tác trong app (đăng nhập mới xem và trả lời; không đính hợp đồng, không link trả lời không cần đăng nhập). Gửi lại sau Trả lại (vòng 2) báo thêm đúng một thư. Công ty nhận chưa trên nền tảng vẫn đi kênh email như cũ.
- Kịch bản: khi gửi cho công ty đã nối thì dòng hộp thư có email người chọn và tên công ty gửi [test: apps/hub-api/src/modules/packs/contracts/partner-notice.int.test.ts » nền tảng ⇒ dòng tới B có to_email = người nhận đã chọn và tên công ty gửi, gửi lại không thêm dòng]
- Kịch bản: khi gửi lại sau Trả lại thì vòng 2 mang email người nhận [test: apps/hub-api/src/modules/packs/contracts/partner-notice.int.test.ts » trả lại rồi gửi lại cùng người nhận ⇒ vòng 2 nối với lần trước và mang to_email]
- Kịch bản: khi bên nhận chưa trên nền tảng thì kênh email giữ nguyên [test: apps/hub-api/src/modules/packs/contracts/partner-notice.int.test.ts » kênh email (bên nhận chưa trên nền tảng) giữ nguyên: to_email = người chọn, không có tên công ty gửi thêm]
- Kịch bản: khi có dòng nền tảng kèm email thì đúng một thư báo link vào app, chạy lại không gửi đôi, vòng 2 thêm đúng một thư [test: apps/hub-api/src/modules/partners/notice.int.test.ts » nền tảng + email đã chọn ⇒ đúng MỘT thư báo link vào app, chạy lại không gửi đôi, vòng 2 thêm đúng một thư]
- Kịch bản: khi dòng không email, kênh email hoặc đang giữ thì không có thư báo nền tảng [test: apps/hub-api/src/modules/partners/notice.int.test.ts » không email / kênh email / lần gửi GIỮ ⇒ không thư báo nền tảng]
- Kịch bản: khi chọn kênh nền tảng thì luật thuần giữ email đã chọn, kênh email không đổi [test: apps/hub-api/src/modules/packs/contracts/domain/partner-send.rules.test.ts » nền tảng ⇒ giữ email người nhận đã chọn (để báo vào app), không email ⇒ toEmail null, khoá gồm cả email]
- Kịch bản: khi dựng thư báo thì chủ đề nghiệp vụ và chỉ một nút vào app [test: apps/hub-api/src/modules/packs/contracts/domain/partner-notice-mail.rules.test.ts » chủ đề «<Công ty A> gửi hợp đồng <tên> cần anh/chị xác nhận», nút dẫn vào hộp thư đối tác, không kèm hợp đồng]

## Việc còn lại
- Chỉ mục riêng cho quét thư báo nếu bảng `partner_mailbox` lớn (migration, đợt sau). Link sâu tới từng mục của hộp thư (UI chưa hỗ trợ).
