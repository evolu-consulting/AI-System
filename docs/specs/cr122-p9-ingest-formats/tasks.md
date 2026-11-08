---
id: cr122-p9-ingest-formats
lát: cr122-p9-ingest-formats
cr: CR-122
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
FLOW2-FR-27: đọc hợp đồng mọi định dạng. (1) PDF scan không dừng ở `PDF_NEEDS_OCR`: tệp đi thẳng AI đọc bằng thị giác (PDF gốc, Messages API nhận `document`). (2) Nhiều ảnh JPG/PNG ⇒ một PDF. (3) DOCX đã lấy chữ sẵn (tải lên ⇒ `DocxConverter` ⇒ `source_text`). (4) Lý do lỗi nghiệp vụ trên trang rà soát. (5) Tải lên đã phát `contract.uploaded` (A1) từ `persist`. (6) Trần 50 trang (người dùng chốt): TRÊN 50 trang từ chối ngay lúc tải lên.

## Làm
- `lib/ai-client`: `attachments` (PDF/ảnh) qua `AiClient` → provider Anthropic (khối document/image) và Claude CLI gói (thư mục tạm + công cụ `Read` duy nhất). Giữ chỗ token tính thêm theo tệp.
- `source-file-text.ts`: scan ⇒ `text:null + pages`; `ai-transport.ts` đính tệp từ FileBox. Trần `CONTRACTS_SCAN_MAX_PAGES` (mặc định 50), `CONTRACTS_SCAN_MAX_MB` (20); tệp đã lưu từ trước vượt trần ⇒ `PDF_TOO_LARGE`, không gọi AI.
- Tải lên: `adapters/pdf-pages.ts` đếm trang (pdf.js, chỉ đọc cấu trúc) TRƯỚC quota/FileBox/HĐ nháp; > trần ⇒ 422 `FILE_TOO_MANY_PAGES` `{pages, limit}`. Nhiều ảnh (`upload.routes.ts`, nhiều `file`) > trần ⇒ cùng lỗi trước khi giải mã; ≤ trần ⇒ `images-pdf.rules.ts` ghép một PDF. HEIC/WEBP báo tên định dạng ("Chưa hỗ trợ HEIC, hãy chụp JPG").
- UI: câu "Tệp có N trang, vượt giới hạn M trang…" ở chỗ báo lỗi tải lên (`list-upload-error.ts`, `contracts.list.upload.tooManyPages`); câu lý do ở khối "Không đọc được hợp đồng này" (`contracts.review.failReason.*`).

### Bảng "định dạng → cách đọc" (thứ tự xử lý một tệp)
| Định dạng | Cách đọc |
|---|---|
| PDF có lớp chữ | `unpdf` lấy chữ ⇒ gửi AI như văn bản (đường cũ) |
| PDF scan (không chữ) | gửi thẳng PDF cho AI (khối `document`), ≤ 50 trang |
| JPG, PNG | ảnh gửi thẳng AI; nhiều ảnh ⇒ ghép một PDF bằng `pdf-lib` rồi đọc như PDF scan |
| WEBP, GIF | model nhận trực tiếp (`image/webp`, `image/gif` trong `anthropic.provider.ts`) ⇒ gửi thẳng như ảnh, không chuyển đổi; không ghép nhiều ảnh (chỉ JPG/PNG) |
| DOCX | `DocxConverter` (đọc `word/document.xml`) ⇒ chữ (đường cũ) |
| md, txt, csv, tsv, json | UTF-8 ⇒ chữ |
| html, xml | bỏ thẻ/script/style ⇒ chữ |
| rtf | bỏ lệnh điều khiển ⇒ chữ |
| xlsx, pptx, odt | `fflate` giải nén, gom chữ trong `sharedStrings`/`slideN`/`content.xml` ⇒ chữ |
| HEIC, TIFF, BMP, doc/xls/ppt cũ | model KHÔNG nhận ⇒ từ chối lúc tải lên, KHÔNG lưu: "Định dạng HEIC chưa đọc được — hãy lưu sang PDF hoặc JPG, hoặc nhập tay." |
| Định dạng lạ khác | như dòng trên, nêu đuôi tệp |
Mọi loại: > 50 trang hoặc > 20 MiB ⇒ từ chối. Không đọc được chữ (tệp rỗng/zip không chữ) ⇒ lưu, `extract_failed`, trang rà soát nêu lý do + "Nhập tay".

## Không làm / Chạm
- Không đụng engine, flow, e2e, DLC. Không migration. Thư viện mới duy nhất: `pdf-lib` 1.17.1 (người dùng duyệt 2026-11-06, ADR-0039): thay bộ đọc JPEG/PNG tự viết, thuần JS, không native. Không thêm `sharp`.
- HEIC chưa đọc được (model không nhận, cần bộ giải mã): báo rõ thay vì im lặng.

## Test tối thiểu
- Unit: `contracts/adapters/ingest-formats.test.ts` (phân loại, ghép ảnh, 3 ảnh ⇒ 1 PDF lưu FileBox, 72 trang ⇒ 422, bộ đếm trang, khối đính kèm AI), `contracts/application/extraction-pdf.test.ts` (scan ⇒ agent kèm tệp, 50 trang đọc hết, 72 trang cũ ⇒ PDF_TOO_LARGE), `kit/adapters/pdf/pdf.test.ts` (scan trả `pages`). DOCX: `kit/adapters/docx/convert.test.ts` có sẵn.

## Quyết định trong lúc làm
- Luồng flow dùng AI client chung (không phải Agent Hub/Dify); trước lát này `aiTransport` từ chối mọi tệp (`AGENT_UNAVAILABLE`) nên ảnh/scan chưa bao giờ đọc được ở chế độ này.
- DOCX không đổi: đã lấy chữ ở tải lên bằng `DocxConverter` (đọc `word/document.xml`).
- `contract.uploaded` đã đúng ở `persist` (A1); `contract.submitted` chỉ phát khi mở lượt duyệt sau khi AI đọc xong.
- Đếm trang chạy trong tiến trình hub-api (không qua Worker): pdf.js chỉ đọc xref/cây trang, tệp ≤ 20 MiB.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Đọc hợp đồng scan và ảnh bằng AI (FLOW2-FR-27)
PDF không có lớp chữ và ảnh JPG/PNG được gửi thẳng cho AI đọc bằng thị giác thay vì dừng ở "cần OCR". Tệp từ 50 trang trở xuống được đọc hết (giới hạn cấu hình được).
- Kịch bản: khi PDF scan thì agent được gọi kèm tệp và hợp đồng sang "Chờ rà soát", không còn PDF_NEEDS_OCR [test: apps/hub-api/src/modules/packs/contracts/application/extraction-pdf.test.ts » CR-122 p9 · PDF scan ⇒ KHÔNG còn PDF_NEEDS_OCR: agent được gọi kèm TỆP (không văn bản) ⇒ needs_review]
- Kịch bản: khi PDF scan đúng 50 trang thì đọc hết [test: apps/hub-api/src/modules/packs/contracts/application/extraction-pdf.test.ts » CR-122 p9 · PDF scan 50 trang (đúng trần) ⇒ đọc hết]

#### Yêu cầu: Từ chối tệp quá số trang ngay khi tải lên (FLOW2-FR-27)
Tệp PDF (hoặc nhiều ảnh ghép lại) trên 50 trang bị từ chối ngay lúc tải lên bằng 422 `FILE_TOO_MANY_PAGES` kèm `{pages, limit}`: không lưu FileBox, không tạo hợp đồng nháp, không gọi AI. Chỗ chọn tệp hiện "Tệp có 72 trang, vượt giới hạn 50 trang. Hãy tách thành tệp ngắn hơn (ví dụ tách phụ lục) rồi tải lại."
- Kịch bản: khi tải PDF 72 trang thì 422 và không chạm quota, FileBox hay hợp đồng [test: apps/hub-api/src/modules/packs/contracts/adapters/ingest-formats.test.ts » PDF 72 trang (trần 50) ⇒ 422 FILE_TOO_MANY_PAGES {pages, limit}, KHÔNG quota/FileBox/HĐ]
- Kịch bản: khi hợp đồng cũ đã lưu quá trần thì báo quá lớn, không gọi AI [test: apps/hub-api/src/modules/packs/contracts/application/extraction-pdf.test.ts » CR-122 p9 · PDF scan 72 trang đã lưu từ trước (trần 50) ⇒ extract_failed PDF_TOO_LARGE, agent KHÔNG được gọi]

#### Yêu cầu: Tải nhiều ảnh chụp trang cho một hợp đồng (FLOW2-FR-27)
Tải lên được nhiều ảnh JPG/PNG cho MỘT hợp đồng; máy chủ ghép thành một PDF để lưu rồi đọc như PDF scan. Ghép nhiều ảnh chỉ nhận JPG/PNG; HEIC báo rõ "Định dạng HEIC chưa đọc được — hãy lưu sang PDF hoặc JPG".
- Kịch bản: khi tải 3 ảnh thì lưu 1 PDF vào FileBox và hợp đồng đọc như PDF [test: apps/hub-api/src/modules/packs/contracts/adapters/ingest-formats.test.ts » PDF ghép đi qua tải lên: FileBox nhận đúng 1 tệp PDF, hàng HĐ mime pdf, trích được xếp lượt]
- Kịch bản: khi tải 3 ảnh qua route multipart thật thì chỉ một PDF được lưu FileBox [test: tests/acceptance/HD1/ingest-formats.int.test.ts » 3 ảnh PNG ⇒ 201, MỘT PDF lưu FileBox (1 lần post), 1 hợp đồng mime pdf đang 'extracting']
- Kịch bản: khi tải ảnh HEIC thì báo chưa đọc được HEIC [test: apps/hub-api/src/modules/packs/contracts/adapters/ingest-formats.test.ts » HEIC ⇒ FILE_TYPE kèm format=heic (không chạm FileBox)]

#### Yêu cầu: Đường dự phòng đọc định dạng khác (FLOW2-FR-27)
Định dạng chưa có đường riêng vẫn được đọc theo bảng "định dạng → cách đọc": ảnh model nhận (WEBP, GIF) gửi thẳng; tệp chữ và zip-office lấy chữ; định dạng còn lại báo rõ "Định dạng X chưa đọc được — hãy lưu sang PDF hoặc JPG" kèm gợi ý nhập tay.
- Kịch bản: khi tải WEBP/GIF thì gửi thẳng AI như ảnh [test: apps/hub-api/src/modules/packs/contracts/adapters/ingest-fallback.test.ts » WEBP/GIF được nhận ra và nằm trong danh sách MIME đính kèm]
- Kịch bản: khi tải tệp chữ (txt, csv, html, rtf, json) thì lấy chữ [test: apps/hub-api/src/modules/packs/contracts/adapters/ingest-fallback.test.ts » txt/csv/json nhận theo đuôi + UTF-8]
- Kịch bản: khi tải xlsx/pptx/odt thì lấy chữ trong các XML [test: apps/hub-api/src/modules/packs/contracts/adapters/ingest-fallback.test.ts » nhận ra theo tên phần và lấy chữ]
- Kịch bản: khi tải HEIC/TIFF/BMP thì báo chưa đọc được kèm tên định dạng [test: apps/hub-api/src/modules/packs/contracts/adapters/ingest-fallback.test.ts » HEIC/TIFF/BMP/doc cũ ⇒ có tên định dạng để báo 'chưa đọc được — hãy lưu sang PDF hoặc JPG']

#### Yêu cầu: Lý do không đọc được hợp đồng
Khối "Không đọc được hợp đồng này" nêu lý do nghiệp vụ (tệp hỏng / quá lớn / định dạng chưa hỗ trợ / hết lượt AI) kèm gợi ý "Nhập tay".
- Kịch bản: khi lượt đọc lỗi PDF_TOO_LARGE thì trang rà soát nói tệp quá lớn và gợi ý Nhập tay [test: thủ công — chỉ đổi câu chữ hiển thị theo mã lỗi (ReviewParts.tsx FAIL_REASON)]

## Việc còn lại
- HEIC: cần bộ giải mã (không thêm thư viện native); hiện báo rõ.
- Thử với tệp scan thật + AI thật (CLI gói chưa kiểm trực tiếp lệnh `Read`; chưa dựng uat-stack).
