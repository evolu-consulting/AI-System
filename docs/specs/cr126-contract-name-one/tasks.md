---
id: cr126-contract-name-one
lát: cr126-contract-name-one
cr: CR-126
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Rà mọi chỗ hiển thị tên HĐ trong gói contracts: chuyển sang `contractNameSql`/`contractLabelSql`/`contractCodeSql`.

## Làm
Rà bằng Grep + `bun run check:contract-name` (sạch): các chỗ trong danh sách báo cáo (context-label, esign-flow/sweep, activity, mywork, intake.tools, rep.sql, transactions-read, manage, appendix, business, followups, ledger-read, service-customers, todo) đã dùng hàm chung từ CR-121 Q-4; không còn `c.title` thô hay biểu thức tự viết. Gỡ ghi chú "Lệch code" đã cũ trong `docs/current/sht/duyet-ky-so.md`.

## Không làm / Chạm
Để nguyên có chủ đích: `contract_delete_log.title` (hàm SQL trong migration 0035/0046 ghi tên file; sửa cần migration, ngoài lát); cột `title` dùng làm tên file (upload-contract.repo); bí danh con `k/d/x/f.title` đã là kết quả `contractNameSql` của truy vấn trong. Gate `check:contract-name` đã chặn `c|pc|fc.title` thô và `fields->'title'` tự viết, không cần mở rộng.

## Test tối thiểu
`contract-name.int.test.ts` (int), `check-contract-name.test.ts` (unit).

## Quyết định trong lúc làm
Không đổi code: mã đã đúng; lát chỉ sửa docs.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-09 (đợt cr126-wave)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Tên HĐ một nguồn
Mọi nơi hiển thị tên HĐ dùng `contractNameSql`; bỏ ghi chú lệch code đã được xử lý.
- Kịch bản: khi hiển thị tên HĐ ở danh sách, Việc của tôi, nhật ký, nhãn thì ra trường "Tên hợp đồng" [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-name.int.test.ts » danh sách + chi tiết HĐ trả tên thật, sắp xếp theo tên thật (không theo tên file)]

## Việc còn lại
`contract_delete_log.title` ghi tên HĐ thật (cần migration sửa hàm xoá HĐ).
