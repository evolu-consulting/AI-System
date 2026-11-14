---
id: cr149-file-preview
cr: CR-149
lane: Sonnet (hộp «Xem» dùng chung; không migration, không đổi quyền, không đổi server)
---
# CR-149 · Xem trước tệp trong hộp: ảnh, PDF (pdf.js), Word .docx (docx-preview)

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tai-lieu-kem.md
#### Yêu cầu: Một khối «Tài liệu kèm» cho mọi tệp ngoài file chính
Mỗi dòng (tệp gắn vào HĐ và tệp kèm bước duyệt) có MỘT nút «Xem» mở hộp xem chung: tên tệp, cỡ, lúc tải lên, «Tải về»; ảnh hiện ảnh, PDF cuộn trang + phóng to/thu nhỏ, Word .docx hiện nội dung; loại khác (Excel, .doc cũ, SVG/HTML…) hiện tên + «Tải về». File hợp đồng chính («Xem hợp đồng gốc») và hồ sơ duyệt (CR-144) dùng cùng bộ hiển thị. pdf.js và docx-preview chỉ nạp khi mở hộp (chunk `viewer-*`); worker pdf.js đóng gói cục bộ, không CDN.
- Kịch bản: khi chọn kiểu xem thì chỉ ảnh raster, PDF, .docx xem được; SVG/HTML/.doc/Excel là loại khác; mime chung chung thì dựa đuôi tên [test: apps/workspace-web/src/components/shared/file-viewer/viewer-kind.test.ts » chỉ ảnh raster, PDF và docx xem được]
- Kịch bản: khi hồ sơ duyệt hiện tệp thì ảnh/PDF đi qua bộ hiển thị chung, tệp lạ chỉ có «Tải về» [test: apps/workspace-web/src/features/contract-approval/components/EvidenceView.test.tsx » hộp Xem hiện người duyệt và chữ ký ngay, ảnh, PDF và tệp lạ]
- Kịch bản: chunk viewer-* có trần riêng, bundle đầu không tăng [test: apps/workspace-web/scripts/check-bundle.test.ts » CR-149: chunk viewer-* (pdf.js/docx) được 520 KB]
- Kịch bản: e2e bấm «Xem» mở PDF (trang + phóng to) và DOCX (chữ trong tệp) [test: thủ công — e2e/cr149/file-preview.spec.ts viết sẵn, chạy một lần cuối đợt]

### MODIFIED sht/duyet-ky-so.md
Hộp «Xem» hồ sơ duyệt: PDF dựng bằng pdf.js (không còn khung iframe), thêm Word .docx; giữ `?inline=1` + CSP sandbox của CR-144 (bytes vẫn lấy qua route có kiểm quyền, Bearer, không route mới).

## Tasks
- [x] thêm `pdfjs-dist@6.4.299`, `docx-preview@0.4.1` (người dùng đồng ý; ≥ 2 tuần tuổi, ghim đúng phiên bản)
- [x] `components/shared/file-viewer/*` (viewer-kind, FilePreview, PdfPane, DocxPane, FileViewerDialog)
- [x] EvidenceView/EvidenceDialog dùng bộ chung; bỏ `lib/evidence-kind`
- [x] «Tài liệu kèm»: «Xem» cho tệp HĐ + tệp bước; «Xem hợp đồng gốc» dùng FilePreview
- [x] chunk `viewer-pdf`/`viewer-docx` + trần 520 KB ở check-bundle
- [x] e2e `e2e/cr149/file-preview.spec.ts` (viết, chưa chạy)

## Quyết định trong lúc làm
- Không đổi server: .docx lấy bytes bằng đúng đường đang dùng (link FileBox ngắn hạn / `?inline=1` / `/attachments/:id/content`), không mở route đọc mới.
- Bỏ nút «Tải về» riêng ở dòng «Tài liệu kèm»: «Tải về» nằm trong hộp (một control cho một khái niệm).
- Người tải lên không hiện ở «Tài liệu kèm» vì contract chỉ có `added_by` (uuid) — chỉ hiện lúc tải.
- Hộp xem nạp lười từ ContractFilesPanel để chunk chi tiết HĐ không vượt 53 KB.
- Bundle đầu 146,2 KB (trần 162); viewer-pdf 486 KB gz, viewer-docx 47 KB gz (chỉ tải khi mở PDF/Word).
