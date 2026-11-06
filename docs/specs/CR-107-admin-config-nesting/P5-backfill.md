# P5 · Backfill migration — Làn đầy đủ (Opus)

FR: **ADM-FR-85**. Nguồn: ADR-0033 §4; BA mục "Backfill Group lệch template". backend-lead điền.

## Ràng buộc đã chốt
Ép mọi Group `<pack>-<role>` lệch template về đúng 3 mức chuẩn; muốn khác ⇒ tạo vai tuỳ biến mới. Vì đổi quyền hiệu lực của khách, BẮT BUỘC: (1) dry-run + báo cáo danh sách tenant/Group sẽ đổi; (2) xác nhận thủ công trước khi chạy thật ở prod; (3) audit mỗi thay đổi grant.

## Thiết kế migration
[backend-lead điền] — số migration + `when` journal, luồng dry-run/xác nhận, định dạng audit, idempotency, đối soát.

## AC
| AC | Nội dung |
|---|---|
| P5-AC01 | Dry-run không ghi gì, báo cáo đủ tenant/Group sẽ đổi |
| P5-AC02 | Chạy thật bị từ chối nếu thiếu xác nhận thủ công |
| P5-AC03 | Mỗi grant đổi có một bản ghi audit |
| P5-AC04 | Sau backfill mỗi pack đã bật có đúng 3 vai mặc định khớp chuẩn; chạy lại không đổi gì |
