---
id: cr125-fix-int-db
lát: cr125-fix-int-db
cr: CR-125
làn: nhanh
migration: admin 0040
phụ thuộc:
---
## Plan (ngắn)
Sửa các ca int đỏ của đợt cuối CR-125 (log qc 20261108-160017-3396-int).

## Làm
1. `rollbackJournalFrom` (test-db.ts): áp lại 0068 trên DB đã có flow mẫu 0121 (trigger, không khe, đã xuất bản) vi phạm CHECK bản chặt 0068 ⇒ 23514. Hub 0126 KHÔNG liên quan (chỉ ghi `tenant_flow_settings`). Chỉ là hạ tầng test; prod không áp lại 0068.
2. `hub-rls.int.test.ts`: thêm 3 bảng partner (0117/0120, policy system) + `platform_settings` (0115, đọc hub_rw/hub_ro). Đã kiểm RLS bật + policy đúng.
3. DF-02 / M-04: trần stage/step đã chủ ý nới 10 → 50 ở CR-122 p22 (hub 0115) ⇒ dời biên ca test sang 51/50.
4. `tenant-purge.partner.ts` (+ IGNORED_TABLES trong rules): ẩn danh/xoá hộp thư đối tác theo quyết định giữ lịch sử.
5. `rls-packs-v2.ts`: probe partner_sends/partner_inbox/partner_settings (+ truncate trong reset).

## Không làm / Chạm
Không đổi migration. Không đụng DLC.

## Test tối thiểu
evotest int đúng các file đỏ (-Dirty).

## Quyết định trong lúc làm
Xoá tenant (người dùng chốt 2026-11-08): KHÔNG xoá thư/liên kết hai bên; ẩn danh bên bị xoá bằng id tombstone (không đổi cấu trúc bảng ⇒ không migration), xoá dòng khi cả hai bên đã xoá. Lời mời nối chưa chấp nhận và lần gửi chưa giao thì xoá.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/gui-doi-tac-xoa-cong-ty.md
#### Yêu cầu: Xoá công ty giữ lịch sử của công ty còn lại, ẩn danh bên bị xoá
Khi `tenant-purge` xoá một công ty, hộp thư/liên kết/nhật ký email đối tác (hub.partner_mailbox, partner_links, partner_email_events) mà công ty là MỘT bên KHÔNG bị xoá: id của bên bị xoá đổi thành id giả (tombstone), tên/MST/bản chia sẻ/tệp/lý do/bằng chứng/email của nó bị xoá sạch; bản sao phía công ty còn lại (contracts.partner_inbox, partner_sends) đổi tên thành «Công ty đã xoá» (màn hình dịch qua khoá i18n `contracts.partner.deletedCompany`). Dòng chỉ bị xoá khi không còn bên nào giữ lịch sử: bên kia cũng đã xoá, kênh email/ghi tay (bên kia không phải công ty), lần gửi chưa tới tay bên kia (held, sent), lời mời nối chưa chấp nhận. Tên bên bị xoá còn trong dữ liệu khác của công ty còn lại (tiêu đề HĐ nhận, lịch sử HĐ, chuông) cũng được thay; admin.audit_log không sửa. Lần gửi chưa giao mà bên kia đã có bản sao thì giữ (ẩn danh) để bản sao còn hộp thư hợp lệ. Id tombstone bị chặn làm tenant thật bằng CHECK admin 0040. Không đổi cấu trúc bảng đối tác.
- Kịch bản: khi xoá A thì B vẫn thấy luồng thư với tên «Công ty đã xoá» và không còn dữ liệu của A; xoá nốt B thì hết dòng [test: tools/scripts/src/tenant-purge.partner.int.test.ts » xoá A giữ lịch sử của B và ẩn danh A thành «Công ty đã xoá»]
- Kịch bản: khi xoá A thì dữ liệu khác của B (tiêu đề, lịch sử HĐ, chuông, audit) không còn tên A và mọi bản sao của B còn trỏ hộp thư tồn tại [test: tools/scripts/src/tenant-purge.partner.int.test.ts » xoá A giữ lịch sử của B và ẩn danh A thành «Công ty đã xoá»]
- Kịch bản: khi chèn tenant mang id tombstone thì bị CHECK chặn [test: tools/scripts/src/tenant-purge.partner.int.test.ts » id tombstone không dùng được làm tenant thật (CHECK admin 0040)]
- Kịch bản: khi bên gửi/nhận đã bị xoá thì thẻ hiện khoá i18n thay vì chuỗi lưu [test: apps/workspace-web/src/features/partner-inbox/lib/partner-view.test.ts » bên gửi đã bị xoá ⇒ tên hiện bằng khoá i18n «Công ty đã xoá», không phải chuỗi lưu]

## Việc còn lại
