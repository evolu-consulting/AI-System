---
id: cr194-txt-view
lát: cr194-txt-view
cr: CR-194
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Thêm loại xem "text" vào hộp xem chung (FilePreview) — một chỗ cho mọi màn dùng hộp. Client đọc blob (đã tải qua route có kiểm quyền) ⇒ chữ, không server đổi.

## Làm
- [x] `viewer-kind.ts`: "text" cho text/plain, csv, markdown; đuôi .txt/.csv/.md/.log khi mime chung chung.
- [x] `text-head.ts` (≤ 1 MB đầu, UTF-8) + `TextPane.tsx` (`<pre>` chỉ text node) + i18n `contracts.fview.textTruncated` VI/EN.
- [x] Test: unit viewer-kind, text-head; e2e `e2e/cr149/txt-preview.spec.ts` (viết, chưa chạy).

## Không làm / Chạm
Không đụng server (client đọc blob nên `?inline=1` chỉ ảnh/PDF giữ nguyên), không PostCard/files.service, không mở thêm loại tải lên.

## Test tối thiểu
unit file sửa + tsc workspace-web.

## Quyết định trong lúc làm
- Đọc bằng blob → text trên client, không HTML ⇒ không cần route text/plain inline.
- Tệp > 1 MB: hiện 1 MB đầu + ghi chú; nút «Tải về» có sẵn trong hộp.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/xem-tep.md
#### Yêu cầu: Xem tệp văn bản thuần trong hộp «Xem»
Tệp .txt/.csv/.md/.log mở được trong hộp «Xem»: hiện chữ, giữ xuống dòng, cuộn, phông đơn cách; chỉ 1 MB đầu, lớn hơn thì có ghi chú và nút «Tải về».
- Kịch bản: khi mở tệp .txt thì thấy chữ nguyên văn, thẻ HTML không được dựng [test: e2e/cr149/txt-preview.spec.ts » Xem tệp .txt trong hộp: hiện chữ, giữ xuống dòng, có Tải về]
- Kịch bản: khi tệp > 1 MB thì chỉ đọc 1 MB đầu và báo cắt [test: apps/workspace-web/src/components/shared/file-viewer/text-head.test.ts » tệp > 1 MB: chỉ lấy 1 MB đầu, truncated = true, không sinh ký tự lỗi ở đuôi]
- Kịch bản: khi chọn kiểu xem theo mime/đuôi thì văn bản ⇒ text, HTML vẫn tải về [test: apps/workspace-web/src/components/shared/file-viewer/viewer-kind.test.ts » text/plain, csv, markdown và đuôi .txt/.csv/.md/.log ⇒ text, HTML vẫn là other]

## Việc còn lại
Chạy e2e txt-preview cuối đợt.
