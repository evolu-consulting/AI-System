# gui doi tac xoa cong ty

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Xoá công ty giữ lịch sử của công ty còn lại, ẩn danh bên bị xoá (nguồn: cr125-fix-int-db)
Khi `tenant-purge` xoá một công ty, hộp thư/liên kết/nhật ký email đối tác (hub.partner_mailbox, partner_links, partner_email_events) mà công ty là MỘT bên KHÔNG bị xoá: id của bên bị xoá đổi thành id giả (tombstone), tên/MST/bản chia sẻ/tệp/lý do/bằng chứng/email của nó bị xoá sạch; bản sao phía công ty còn lại (contracts.partner_inbox, partner_sends) đổi tên thành «Công ty đã xoá» (màn hình dịch qua khoá i18n `contracts.partner.deletedCompany`). Dòng chỉ bị xoá khi không còn bên nào giữ lịch sử: bên kia cũng đã xoá, kênh email/ghi tay (bên kia không phải công ty), lần gửi chưa tới tay bên kia (held, sent), lời mời nối chưa chấp nhận. Tên bên bị xoá còn trong dữ liệu khác của công ty còn lại (tiêu đề HĐ nhận, lịch sử HĐ, chuông) cũng được thay; admin.audit_log không sửa. Lần gửi chưa giao mà bên kia đã có bản sao thì giữ (ẩn danh) để bản sao còn hộp thư hợp lệ. Id tombstone bị chặn làm tenant thật bằng CHECK admin 0040. Không đổi cấu trúc bảng đối tác.
- Kịch bản: khi xoá A thì B vẫn thấy luồng thư với tên «Công ty đã xoá» và không còn dữ liệu của A; xoá nốt B thì hết dòng [test: tools/scripts/src/tenant-purge.partner.int.test.ts » xoá A giữ lịch sử của B và ẩn danh A thành «Công ty đã xoá»]
- Kịch bản: khi xoá A thì dữ liệu khác của B (tiêu đề, lịch sử HĐ, chuông, audit) không còn tên A và mọi bản sao của B còn trỏ hộp thư tồn tại [test: tools/scripts/src/tenant-purge.partner.int.test.ts » xoá A giữ lịch sử của B và ẩn danh A thành «Công ty đã xoá»]
- Kịch bản: khi chèn tenant mang id tombstone thì bị CHECK chặn [test: tools/scripts/src/tenant-purge.partner.int.test.ts » id tombstone không dùng được làm tenant thật (CHECK admin 0040)]
- Kịch bản: khi bên gửi/nhận đã bị xoá thì thẻ hiện khoá i18n thay vì chuỗi lưu [test: apps/workspace-web/src/features/partner-inbox/lib/partner-view.test.ts » bên gửi đã bị xoá ⇒ tên hiện bằng khoá i18n «Công ty đã xoá», không phải chuỗi lưu]

