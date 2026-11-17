---
id: fix-cr181-save
lát: fix-cr181-save
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s12-sign-modes
---
## Plan (ngắn)
Lưu chữ ký gửi `marks: []` ⇒ 400. Sửa nguồn danh sách mục: chủ màn (`SignBody`) giữ state, hook chỉ tính thao tác.

## Làm
- [x] `hooks/use-sign-items.ts`: `applyOp` thuần (tính từ bản mới nhất, ghi ref, rồi `onChange`); hook điều khiển từ ngoài, không còn tác dụng phụ trong hàm cập nhật state
- [x] `pages/SignBody.tsx`: items là state của màn; `doSign` không gửi khi không có mark; nút Lưu khoá (chế độ ký) khi chưa có chữ ký (`saveDisabled`)
- [x] Test `sign-save-flow.test.ts` (kéo từ khay, Bấm để ký, Chép sang mọi trang, rỗng)

## Không làm / Chạm
Chạm `SignWorkspace`, `SignTopBar`, `types.ts` (prop `saveDisabled`).

## Test tối thiểu
`bun test apps/workspace-web/src/features/doc-sign` xanh; `tsc --noEmit` workspace-web sạch.

## Quyết định trong lúc làm
- Nguyên nhân gốc nghi: `onChange` (ghi ref + `setDirty`) chạy BÊN TRONG hàm cập nhật state của hook ⇒ chạy lúc render/không xác định thời điểm, nên Lưu có thể đọc danh sách cũ. Chuyển sang state do chủ màn giữ để loại cả lớp lỗi. Chưa có DOM trong bun test nên test đi qua `applyOp` (hàm hook gọi), cần e2e xác nhận.
- Mục bị lọc khi dựng body vẫn là `kind: mark` + `status: editable` (đúng với cả ba đường đặt).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Lưu chữ ký không gửi danh sách rỗng
Chữ ký đã đặt (kéo từ khay, bấm ô, chép sang mọi trang) luôn có trong body Lưu; chưa có chữ ký thì nút Lưu khoá.
- Kịch bản: khi kéo chữ ký từ khay rồi Lưu thì body có một dấu free [test: apps/workspace-web/src/features/doc-sign/sign-save-flow.test.ts » kéo từ khay ⇒ body có 1 mark free]
- Kịch bản: khi bấm ô của mình rồi Lưu thì body có dấu field kèm field_id [test: apps/workspace-web/src/features/doc-sign/sign-save-flow.test.ts » «Bấm để ký» ⇒ body có mark field, giữ field_id]
- Kịch bản: khi chép sang mọi trang rồi Lưu thì body có dấu initials [test: apps/workspace-web/src/features/doc-sign/sign-save-flow.test.ts » «Chép sang mọi trang» ⇒ body có initials ngoài chữ ký gốc]
- Kịch bản: khi chưa đặt chữ ký thì không có dấu nào để gửi [test: apps/workspace-web/src/features/doc-sign/sign-save-flow.test.ts » chưa đặt gì ⇒ không có mark (nút Lưu phải khoá, không gửi)]
