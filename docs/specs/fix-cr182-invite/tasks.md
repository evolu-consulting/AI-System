---
id: fix-cr182-invite
lát: fix-cr182-invite
cr: CR-182
làn: nhanh
migration: không
phụ thuộc: cr182-partner-api
---
## Plan (ngắn)
Lỗi CAO trên bản test: giám đốc ký xong nhưng đối tác không nhận thư mời, bước Ký ghi «Chờ … ký», không ai biết vì sao.

## Chẩn đoán (đọc DB + log bản test, không sửa dữ liệu)
- HĐ `c1810000-…-172611181439`: ô A đã ký (`signed_by` = demo-owner), bản ký seq 2 có `run_id`; ô B (`partner`, `thomas.tran@example.invalid`) chưa ký; lượt chạy `waiting_timer` ở stage «Chờ ký xong» (chờ `esign.completed`).
- Đường «vai» KHÔNG lỗi: link ĐÃ được tạo (`contracts.partner_sign_links`, tạo đúng lúc Lưu 07:43:35) nhưng `sent_at` NULL. `HUB_NOTIFY_MODE=live`; liên hệ đối tác seed dùng miền dành riêng `.invalid` ⇒ transport thông báo trả `skip` (không đụng SMTP) ⇒ `sendMail` trả false mà KHÔNG ghi log và không báo ai ⇒ HĐ chờ đối tác trong im lặng.
- «Đang duyệt» và «Chờ … ký» là hành vi đúng của đợt 2 (bước Ký chỉ xong khi Bên B ký đủ); phần chữ trên màn hình (chưa nói «Chờ đối tác ký») thuộc lát web.

## Làm
- [x] `sendMail`: thư không đi ⇒ `warn partner-sign-mail-undelivered` {link_id, code, skip, permanent} (+ link khi bản dev/test và địa chỉ bị bỏ qua).
- [x] `ensureLink`: có transport mà thư không đi ⇒ chuông cho người tải lên «Chưa gửi được thư mời ký» (bấm «Gửi lại link ký» sau khi sửa email).
- [x] Int: thư bị bỏ qua ⇒ link tạo, log lý do, chuông, gửi lại được.

## Quyết định trong lúc làm
- HĐ đang kẹt trên bản test: link cũ chỉ lưu băm nên không lấy lại được token; sửa email liên hệ rồi «Gửi lại link ký» (thu hồi link cũ, gửi mới). Tự phục hồi `recover` KHÔNG áp dụng (bước không kẹt do lỗi thả, mà đang chờ đối tác đúng thiết kế). Không tự gửi lại khi mở trang vì thư lỗi vĩnh viễn sẽ lặp thu hồi/tạo link mỗi lần xem.
- Dữ liệu seed: liên hệ đối tác UAT cần email nhận được thật (hoặc lấy link từ log/chuông) — thuộc lát `cr182-seed`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Mời đối tác ký bằng link riêng khi công ty ký xong
Khi thư mời không gửi được (địa chỉ không nhận được, miền dành riêng, SMTP từ chối) hệ thống vẫn giữ link, ghi log lý do và báo người tải lên bằng chuông «Chưa gửi được thư mời ký» để sửa email rồi gửi lại.
- Kịch bản: khi thư mời bị bỏ qua thì ghi log lý do, báo người tải lên và gửi lại được [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-sign.int.test.ts » thư mời không đi được (miền dành riêng) ⇒ link vẫn được tạo nhưng KHÔNG im lặng: ghi log lý do + link, chuông cho người tải lên, gửi lại được]
