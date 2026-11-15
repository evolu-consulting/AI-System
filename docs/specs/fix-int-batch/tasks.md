---
id: fix-int-batch
lát: fix-int-batch
cr: CR-161
làn: nhanh
migration: không (sửa idempotent hub 0142 tại chỗ)
phụ thuộc:
---
# fix-int-batch — ca int đỏ lượt toàn bộ cuối đợt 20261115-063944-6236-all

## Làm
| Ca đỏ | Loại | Xử lý |
|---|---|---|
| tenant-purge.int ×3, tenant-purge.partner.int ×2 | a | hub.cc_threads / cc_messages (không có tenant_id) chưa khai ⇒ `PurgeRefused`. Khai ở IGNORED_TABLES + `anonymizeChat` (tenant-purge.partner.ts): giữ luồng cho bên còn lại, ẩn danh bên bị xoá, xoá luồng khi bên kia cũng đã xoá |
| hub-h2c / h3a / h3b.int, migrate-hub.int (ca 2: DB có stub cũng cùng nguyên nhân) | a | hub 0142 (CR-147) `CREATE POLICY` không idempotent ⇒ áp lại sau khi gỡ journal vỡ 42710. Thêm `DROP POLICY IF EXISTS` trước mỗi CREATE (hash không đổi vai trò: migrator chỉ so `created_at`) |
| migrate-hub.int (ca DB sạch) | b | danh sách bảng hub thiếu cc_* (0146) và people_profiles (0142) |
| hub-cr127-e1.int | b | hub 0141 (SEC): tệp/chữ ký không của chính người ghi ⇒ `EK422`, không còn 42501 |
| V2-I/partner-ui.int | b | CR-151d: `/partners/contracts` trả `{items,next_offset}` |
| V2-L/company.int ×2 | b | CR-138 thêm `company.has_cover`; mặc định uy tín có thêm ô cooperation/franchise |
| DOC-legal/legal.int | b | PUT /company strict, không nhận `has_cover` (CR-138) ⇒ test bỏ trường khi gửi lại |
| esign-invite.int ×2 | b | CR-146: node ký bắt buộc `provider` ⇒ test truyền `provider: "selfsign"` |
| category-ids (perf), H4b1/boot, M2/concurrency, «(unhandled)» (V2-D/perf ECONNRESET) | c | chạy lại riêng (xem Quyết định) |

## Quyết định trong lúc làm
- Luồng trò chuyện khi xoá công ty A: tin của A giữ chữ nhưng `sender_tenant`→tombstone, `sender_user`→uuid ngẫu nhiên, `sender_name`→«Công ty đã xoá», `files`→[] (cc_files của A bị xoá theo tenant_id). Khoá cặp duy nhất ⇒ nếu bên B đã có luồng (tombstone,B) từ lần xoá trước thì luồng của A bị xoá (không gộp; cùng khuôn anonymizeLinks).
- Chưa làm: chuông của B nhắc tên công ty A (hub.notifications do cc_bell) chưa thay «Công ty đã xoá» (scrubNames chỉ theo tên từ hộp thư HĐ). Ghi cho Opus.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/gui-doi-tac-xoa-cong-ty.md
#### Yêu cầu: Xoá công ty giữ trò chuyện của công ty còn lại, ẩn danh bên bị xoá (nguồn: fix-int-batch)
Công cụ xoá công ty không xoá luồng trò chuyện hai công ty (CR-161) của công ty còn lại: tin của bên bị xoá ở lại với tên «Công ty đã xoá», không còn id người/công ty, không còn tệp đính kèm; đã-đọc và tệp của bên bị xoá bị xoá. Bên kia cũng đã xoá thì luồng bị xoá hẳn.
- Kịch bản: khi xoá công ty A đang có luồng với B thì luồng còn cho B, tin của A ẩn danh, tin của B và đã-đọc của B y nguyên [test: tools/scripts/src/tenant-purge.partner.int.test.ts » CR-161 · trò chuyện]
- Kịch bản: khi xoá nốt B (A đã xoá) thì không còn luồng, tin, đã-đọc [test: tools/scripts/src/tenant-purge.partner.int.test.ts » xoá nốt B]
