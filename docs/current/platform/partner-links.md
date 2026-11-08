# Nối đối tác một lần (CR-124 FLOW4-FR-06)

Cập nhật: 2026-11-08 · Nguồn: CR-124/125.

## CR-124/125 · Delta gộp 2026-11-08 (đợt cr124-cr125)

#### Yêu cầu: Nối đối tác một lần (CR-124 FLOW4-FR-06) (nguồn: cr124-q2-directory)
Lần gửi đầu từ A tới B tạo lời mời nối (`hub.partner_link_request`, B phải đang bật danh bạ); chỉ B chấp nhận (`partner_link_accept`) hoặc chặn (`partner_link_block`); sau khi chấp nhận, A gửi qua nền tảng không hỏi lại; B chặn thì A không gửi được và thấy trạng thái bị chặn (`partner_links_mine`).
- Kịch bản: khi A xin nối B chưa bật danh bạ hoặc chưa được chấp nhận thì không gửi được [test: apps/hub-api/src/modules/partners/links.int.test.ts » request: cần B bật danh bạ, gọi lại không đổi, chưa chấp nhận thì chưa gửi được]
- Kịch bản: khi công ty không phải bên nhận chấp nhận hoặc chặn thì lỗi 42501 và không đổi dữ liệu [test: apps/hub-api/src/modules/partners/links.int.test.ts » accept/block CHỈ bên nhận, sai bên hoặc không có lời mời ⇒ 42501 và không đổi gì]
- Kịch bản: khi B chặn A thì A thấy bị chặn và không gửi được, B bỏ chặn thì gửi lại được, mỗi bên chỉ thấy dòng của mình [test: apps/hub-api/src/modules/partners/links.int.test.ts » block: B chặn A ⇒ A không gửi được, request trả blocked, B bỏ chặn bằng accept, mine thấy đúng phía]
