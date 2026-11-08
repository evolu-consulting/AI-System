---
id: cr125-fix-int-db
lát: cr125-fix-int-db
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa các ca int đỏ của đợt cuối CR-125 (log qc 20261108-160017-3396-int).

## Làm
1. `rollbackJournalFrom` (test-db.ts): áp lại 0068 trên DB đã có flow mẫu 0121 (trigger, không khe, đã xuất bản) vi phạm CHECK bản chặt 0068 ⇒ 23514. Hub 0126 KHÔNG liên quan (chỉ ghi `tenant_flow_settings`). Chỉ là hạ tầng test; prod không áp lại 0068.
2. `hub-rls.int.test.ts`: thêm 3 bảng partner (0117/0120, policy system) + `platform_settings` (0115, đọc hub_rw/hub_ro). Đã kiểm RLS bật + policy đúng.
3. DF-02 / M-04: trần stage/step đã chủ ý nới 10 → 50 ở CR-122 p22 (hub 0115) ⇒ dời biên ca test sang 51/50.
4. `tenant-purge.rules.ts`: EXTRA_TABLES thêm partner_email_events, partner_mailbox, partner_links (thứ tự xoá theo FK tự tính).
5. `rls-packs-v2.ts`: probe partner_sends/partner_inbox/partner_settings (+ truncate trong reset).

## Không làm / Chạm
Không đổi migration. Không đụng DLC.

## Test tối thiểu
evotest int đúng các file đỏ (-Dirty).

## Quyết định trong lúc làm
Xoá tenant: thư liên công ty tenant gửi HOẶC nhận đều bị xoá (cả hai chiều).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa test/fixture/hạ tầng test; công cụ tenant-purge chỉ khai thêm bảng partner vào kế hoạch xoá, trước đó từ chối chạy)

## Việc còn lại
