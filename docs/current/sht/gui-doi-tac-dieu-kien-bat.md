# gui doi tac dieu kien bat

> **CR-127 (2026-11-11) — phần Thư viện/khe/sao chép/mẫu/máy duyệt cũ trong file này ĐÃ THAY THẾ:** xem [engine/quy-trinh-cr127.md](../engine/quy-trinh-cr127.md). Giữ làm lịch sử; chỗ mâu thuẫn thì file CR-127 thắng.

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Platform bật/tắt Đối tác xác nhận hợp đồng từ giao diện, kèm danh sách điều kiện (nguồn: cr125-ux-s7-partner-enable)
Công ty › Ứng dụng có thẻ «Đối tác xác nhận hợp đồng»: công tắc + mỗi điều kiện (Sổ Hợp Tác, tính năng, kênh hệ thống, hồ sơ pháp lý, cho phép tìm thấy, quy trình nhận, nhóm xác nhận, quy trình gửi) có trạng thái, lý do, ai làm; nền tảng làm hộ được thì có nút «Làm bước này».
- Kịch bản: khi nền tảng bật/tắt thì tính năng được cấp/thu hồi đúng công ty, có audit, danh sách đổi theo [test: apps/admin-api/src/modules/partner-confirm/partner-confirm.int.test.ts » platform bật/tắt qua đúng service entitlement: danh sách đổi theo, audit grant/revoke đúng công ty, công ty khác nguyên trạng]
- Kịch bản: khi thiếu điều kiện thì mỗi dòng nêu ai làm và nút làm hộ nếu có [test: packages/contracts/src/modules/partner-confirm.test.ts » chưa cấp tính năng ⇒ tắt, nêu nút bật và AI làm (nền tảng)]
- Kịch bản: khi Hub không trả lời thì các mục của Hub «chưa rõ», không coi là sẵn sàng [test: packages/contracts/src/modules/partner-confirm.test.ts » Hub không trả lời ⇒ mục của Hub 'chưa rõ', chưa coi là sẵn sàng]

#### Yêu cầu: Quyền cấp tính năng Đối tác xác nhận chỉ thuộc quản trị nền tảng (nguồn: cr125-ux-s7-partner-enable)
Quản trị công ty xem được điều kiện của công ty mình (công ty khác 404) nhưng không cấp/thu hồi được.
- Kịch bản: khi quản trị công ty gọi PUT thì 403 và không có entitlement hay audit mới [test: apps/admin-api/src/modules/partner-confirm/partner-confirm.int.test.ts » quản trị công ty KHÔNG cấp được: PUT ⇒ 403 (kể cả công ty của mình), không entitlement, không audit, công ty khác cũng không]
- Kịch bản: khi quản trị công ty xem thì chỉ công ty mình [test: apps/admin-api/src/modules/partner-confirm/partner-confirm.int.test.ts » quản trị công ty XEM được công ty mình (GET 200), công ty khác ⇒ 404]

#### Yêu cầu: Hub báo kênh, quy trình nhận/gửi và nhóm xác nhận của công ty (nguồn: cr125-ux-s7-partner-enable)
- Kịch bản: khi công ty chưa có gì thì Hub trả mẫu nhận để gán và nhóm thiếu [test: apps/hub-api/src/modules/processes/library/partner-confirm.int.test.ts » công ty trắng: có mẫu nhận để gán, chưa có flow, nhóm phong-kinh-doanh chưa có]
- Kịch bản: khi quản trị công ty khác hỏi thì 404 [test: apps/hub-api/src/modules/processes/library/partner-confirm.int.test.ts » quyền: quản trị công ty khác hỏi công ty X ⇒ 404 (không lộ), quản trị chính công ty ⇒ 200]

#### Yêu cầu: Cài đặt của công ty cho thấy Đối tác xác nhận đang bật hay tắt và điều kiện còn thiếu (nguồn: cr125-ux-s7-partner-enable)
Cài đặt (Sổ Hợp Tác) hiện trạng thái thật, điều kiện, ai phải làm; không có công tắc ẩn.

