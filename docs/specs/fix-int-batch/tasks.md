---
id: fix-int-batch
lát: fix-int-batch
cr: CR-161
làn: nhanh
migration: không mới (sửa idempotent hub 0142, 0146 tại chỗ)
phụ thuộc:
---
# fix-int-batch — ca int đỏ lượt toàn bộ cuối đợt 20261115-063944-6236-all

## Làm
| Ca đỏ | Loại | Xử lý |
|---|---|---|
| tenant-purge.int ×3, tenant-purge.partner.int ×2 | a | hub.cc_threads / cc_messages (không có tenant_id) chưa khai ⇒ `PurgeRefused`. Khai ở IGNORED_TABLES + `anonymizeChat` (tenant-purge.partner.ts): giữ luồng cho bên còn lại, ẩn danh bên bị xoá, xoá luồng khi bên kia cũng đã xoá |
| hub-h2c / h3a / h3b.int, migrate-hub.int (ca 2: DB có stub cũng cùng nguyên nhân) | a | hub 0142 (CR-147) `CREATE POLICY` không idempotent ⇒ áp lại sau khi gỡ journal vỡ 42710. Thêm `DROP POLICY IF EXISTS` trước mỗi CREATE (hash không đổi vai trò: migrator chỉ so `created_at`). Lần chạy lại lộ thêm: hub 0146 `CREATE OR REPLACE cc_file_get/cc_files_sweep` vỡ 42P13 khi DB đã có 0148 (đổi kiểu trả về) ⇒ thêm `DROP FUNCTION IF EXISTS` trước (no-op trên DB đã áp) |
| migrate-hub.int (ca DB sạch) | b | danh sách bảng hub thiếu cc_* (0146) và people_profiles (0142) |
| hub-cr127-e1.int | b | hub 0141 (SEC): tệp/chữ ký không của chính người ghi ⇒ `EK422`, không còn 42501 |
| V2-I/partner-ui.int | b | CR-151d: `/partners/contracts` trả `{items,next_offset}` |
| V2-L/company.int ×2 | b | CR-138 thêm `company.has_cover`; mặc định uy tín có thêm ô cooperation/franchise |
| DOC-legal/legal.int | b | PUT /company strict, không nhận `has_cover` (CR-138) ⇒ test bỏ trường khi gửi lại |
| esign-invite.int ×2 | b | CR-146: node ký bắt buộc `provider` ⇒ test truyền `provider: "selfsign"` |
| category-ids (perf), H4b1/boot, M2/concurrency, «(unhandled)» (V2-D/perf ECONNRESET) | c | chạy lại riêng trên evotest ⇒ xanh (lượt 1, 94 pass) ⇒ chập chờn/tải máy, không sửa |
| K2/readers.int («due_soon» thay «overdue», thấy trong int-s1.log, không nằm trong 24 đỏ mới) | d | hành vi theo ngày chạy, không thuộc đợt này; chưa chạy lại, ngoài phạm vi |

## Quyết định trong lúc làm
- Luồng trò chuyện khi xoá công ty A (tenant-purge.partner.ts `anonymizeChat`): tin của A giữ chữ, `sender_tenant`/`sender_user` → tombstone (một id cố định), `sender_name` → «Công ty đã xoá», `files` → []. cc_files/cc_reads của A xoá theo tenant_id.
- Khoá cặp duy nhất: bên kia đã có luồng (tombstone, B) từ lần xoá trước ⇒ GỘP luồng (A,B) vào đó (tin/tệp dời seq theo `last_seq` đích, đã-đọc của B dời theo, last_seq cộng dồn) rồi xoá luồng cũ — B không mất lịch sử. Bên kia cũng đã xoá ⇒ xoá luồng.
- Tệp trong kho: id FileBox ở `cc_files.box_file_id` (khớp `_file_id`) đã được `tenantFileIds` đọc trước khi xoá ⇒ xoá ở FileBox như phần dọn có sẵn; chạy thử chỉ đếm. Thêm test chứng minh (không cần đổi code).
- Chuông `cc.*` của công ty khác có tên/tên pháp lý của A ⇒ «Công ty đã xoá», link về `/contracts/partners` (bỏ party=/tenant=).
- hub 0146 `DROP FUNCTION IF EXISTS cc_file_get/cc_files_sweep` chỉ chạy lại: trên DB sạch là no-op; quyền cấp ở 0147/0148 (hub_rw, contracts_rw có điều kiện) và pack 0117. migrate-hub.int (DB sạch) nay kiểm hub_rw có EXECUTE, PUBLIC không.
- hub 0142 đã áp ở stg-test ⇒ thêm hash cũ vào `ACCEPTED_EDITS` (migrate-guard.ts).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/gui-doi-tac-xoa-cong-ty.md
#### Yêu cầu: Xoá công ty giữ trò chuyện của công ty còn lại, ẩn danh bên bị xoá (nguồn: fix-int-batch)
Công cụ xoá công ty không xoá luồng trò chuyện hai công ty (CR-161) của công ty còn lại: tin của bên bị xoá ở lại với tên «Công ty đã xoá», không còn id người/công ty, không còn tệp đính kèm; đã-đọc và tệp (cả ở FileBox) của bên bị xoá bị xoá; chuông của bên kia nhắc tên bên bị xoá đổi thành «Công ty đã xoá». Bên kia đã có luồng (tombstone, bên kia) từ lần xoá trước thì luồng được gộp vào đó, không mất tin. Bên kia cũng đã xoá thì luồng bị xoá hẳn.
- Kịch bản: khi xoá công ty A đang có luồng với B thì luồng còn cho B, tin của A ẩn danh, tin của B và đã-đọc của B y nguyên [test: tools/scripts/src/tenant-purge.partner.int.test.ts » CR-161 · trò chuyện]
- Kịch bản: khi xoá nốt B (A đã xoá) thì không còn luồng, tin, đã-đọc [test: tools/scripts/src/tenant-purge.partner.int.test.ts » xoá nốt B]
- Kịch bản: khi bên kia đã có luồng với công ty đã xoá khác thì luồng mới gộp vào đó, tin/tệp/đã-đọc của bên kia còn đủ, seq nối tiếp [test: tools/scripts/src/tenant-purge.partner.int.test.ts » GỘP luồng]
- Kịch bản: khi xoá công ty thì id FileBox của tệp trò chuyện của nó bị xoá ở kho, tệp của công ty khác không [test: tools/scripts/src/tenant-purge.partner.int.test.ts » tệp trò chuyện của A]
- Kịch bản: khi xoá công ty thì chuông cc.* của bên kia nhắc tên nó thành «Công ty đã xoá» [test: tools/scripts/src/tenant-purge.partner.int.test.ts » chuông cc.*]
