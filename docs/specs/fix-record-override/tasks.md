# fix-record-override — Hồ sơ duyệt trống khi Toàn quyền duyệt thay

## Delta
- Toàn quyền duyệt THAY một bước (có ý kiến + chữ ký) ⇒ «Hồ sơ duyệt» và lịch sử HĐ có mục của lượt đó (ý kiến, bằng chứng), như người của bước duyệt.
- Không đổi nhãn/màn hình. Không migration, không backfill (chưa có khách thật).

## Việc
- [x] Int đỏ rồi xanh: `contracts/adapters/approval-override-record.int.test.ts` [test: approval-override-record.int.test.ts]
- [x] `engineAct`: engine nhận quyết của lượt duyệt thay ⇒ vẫn chạy `afterOk` (ghi `stage_decided` + `evidence_id`); không ghi override lần 2; engine từ chối ⇒ vẫn bù trừ.

## Quyết định trong lúc làm
- «thay {{who}}»: `on_behalf_of` của bằng chứng chỉ có khi uỷ quyền; Toàn quyền duyệt thay không có người cụ thể được thay (việc giao theo nhóm) ⇒ giữ null, không thêm migration.
