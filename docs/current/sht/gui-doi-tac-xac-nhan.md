# Node «Gửi đối tác xác nhận» tạo lần gửi và tự chọn kênh

Cập nhật: 2026-11-08 · Nguồn: CR-124/125.

## CR-124/125 · Delta gộp 2026-11-08 (đợt cr124-cr125)

#### Yêu cầu: Node «Gửi đối tác xác nhận» tạo lần gửi và tự chọn kênh (nguồn: cr124-q3-partner-send)
Một node, tool gửi chạy trong tx của tenant gửi, tạo đúng một lần gửi mở cho mỗi HĐ; công ty nhận đã nối ⇒ kênh nền tảng, không thì email (có email) hoặc ghi nhận thủ công.
- Kịch bản: khi đối tác trên nền tảng đã nối thì lần gửi đi kênh nền tảng và gọi lại không gửi đôi [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » đã nối ⇒ kênh nền tảng]
- Kịch bản: khi đối tác chưa trên nền tảng thì có email ⇒ email, không email ⇒ thủ công [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » công ty chưa trên nền tảng + có email ⇒ email]
- Kịch bản: khi chọn kênh theo trạng thái nối thì luật thuần cho đúng kênh và lý do [test: apps/hub-api/src/modules/packs/contracts/domain/partner-send.rules.test.ts » đã nối ⇒ nền tảng]

#### Yêu cầu: Bên nhận có bản ghi riêng và mức quan trọng do bên nhận quyết (nguồn: cr124-q3-partner-send)
Bộ chuyển mở tx trong scope tenant nhận, tạo HĐ nhận `source='partner_inbox'` + `contract.received` cùng tx; mức cuối = max(gợi ý bên gửi, luật theo giá trị); chạy lại không đôi.
- Kịch bản: khi bộ chuyển chạy thì B có HĐ nhận riêng và sự kiện, A không có dòng nào của B, chạy lại không tạo thêm [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » bộ chuyển tạo HĐ nhận riêng của B + contract.received]
- Kịch bản: khi nhận lô bất kỳ cỡ thì đúng 4 câu SQL [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-inbox.repo.test.ts » 1 dòng và 100 dòng đều đúng 4 câu]

#### Yêu cầu: Kết thúc flow nhận tự thành câu trả lời; kết quả quay về node chờ (nguồn: cr124-q3-partner-send)
Kết thúc của flow nhận (Đồng ý / Trả lại / Từ chối) gọi `hub.partner_reply`; bộ chuyển đóng lần gửi và bắn `partner.<kết quả>` cho node chờ đúng một lần.
- Kịch bản: khi flow nhận kết thúc Trả lại thì lần gửi đóng và node chờ nhận `partner.returned` một lần [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » Kết thúc flow nhận = Trả lại ⇒ lần gửi đóng + tín hiệu partner.returned đúng một lần]
- Kịch bản: khi A gửi lại sau Trả lại thì vòng 2 mang lý do lần trước và không tạo lời mời nối mới [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » gửi lại sau Trả lại ⇒ vòng 2]

#### Yêu cầu: Khai báo node và sổ module đủ binding (nguồn: cr124-q3-partner-send)
Node có 4 đầu ra khớp stage chờ; sổ module không báo thiếu binding/tool/cổng/sự kiện.
- Kịch bản: khi đọc khai báo node thì 4 đầu ra khớp stage chờ và cổng cấu hình hợp lệ [test: packages/contracts/src/modules/contracts/partner-send/node.test.ts » đầu ra: mỗi khoá `on` là sự kiện của stage chờ hoặc timeout]
- Kịch bản: khi đủ binding thì sổ module không lỗi, thiếu thì báo đúng mã [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.mount.test.ts » đủ binding (tool + node + facts/outcome) ⇒ 0 lỗi module cho node gửi đối tác]

#### Yêu cầu: Cách ly tenant cho bảng mới (nguồn: cr124-q3-partner-send)
`contracts.partner_sends` và `contracts.partner_inbox` chỉ thấy trong tenant của mình; gói không đọc thẳng hộp thư.
- Kịch bản: khi tenant B đọc `partner_sends` của A thì 0 dòng [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » partner_sends: tenant B không thấy lần gửi của A]
- Kịch bản: khi tenant A đọc `partner_inbox` của B hoặc lấy thư của B thì 0 dòng [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » partner_inbox: tenant A không thấy HĐ nhận của B]
