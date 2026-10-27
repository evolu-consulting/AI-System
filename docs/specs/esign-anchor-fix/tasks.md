# esign-anchor-fix — 2 lỗi Thấp từ review esign-anchor

Trạng thái gộp: chưa gộp

| Làn | Phạm vi |
|---|---|
| Nhanh (Luật 0b) | xem trước vị trí ký tách converter + cache chữ trích; chặn ký tự điều khiển trong cụm |

## Quyết định
- (9) Xem trước (`GET /contracts/:id/esign/placement`, quyền read) dùng converter/worker RIÊNG (`previewPdf`, maxPending 1); lúc gửi dùng
  converter riêng (maxPending 2). Xem trước bận (`PDF_BUSY`) ⇒ `placement: "unknown"` (UI "chưa xác định (sẽ tự chọn khi gửi)").
- Chữ trích cache trong bộ nhớ theo `(tenant, file_id)` (tệp HĐ bất biến — phiên bản mới = file_id mới), FIFO trần 200; chỉ lưu kết quả
  cuối (chữ / scan / hỏng); bận hoặc lỗi tải FileBox KHÔNG lưu. Không ghi vào `source_text` (tránh ghi DB từ đường đọc).
- (10) `Phrase`: `.regex(/^[^\p{Cc}]+$/u)` ⇒ \u0000 / ký tự điều khiển ⇒ 400 (trước: jsonb 500).
- Contract: `ESignPlacement` thêm `"unknown"`.

## Test
- unit `application/esign-anchor.usecase.test.ts` (4): bận ⇒ unknown, không chạm converter gửi; cache (5 lần xem trước + gửi = 1 lần
  tải/đọc); bận không cache; schema chặn \u0000/\u0007.
- int `tests/acceptance/esign-anchor/esign-anchor-fix.int.test.ts` (2): PUT \u0000 ⇒ 400 không ghi; xem trước PDF không source_text.
  Chạy cùng `esign-anchor.int.test.ts`: 5 pass.

## Delta
- Sửa: `esign-anchor.usecase.ts`, `esign.mount.ts`, `packages/contracts/.../esign-anchor.ts`, `EsignSendDialog.tsx`, i18n `esign-anchor.*.json`.
- Mới: 2 file test trên.
