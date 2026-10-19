# ADR-0028 · PDF → văn bản (lớp chữ) bằng `unpdf` trong Bun Worker

Trạng thái: **Accepted** (2026-10-20). Người dùng duyệt trong chat, điều phối chuyển lại nguyên văn: "đồng ý thêm unpdf để đọc PDF, và tôi nói set /goal làm cho xong, nếu có câu hỏi thì làm như recommend đi mà". Chính người dùng cài gói (`unpdf@1.8.1`, `apps/hub-api`). Liên quan: R1 (`docs/specs/R1-rag/tasks.md`), ADR-0024 (DOCX), ADR-0021 (tri thức), ADR-0001 (pin chính xác).

## Bối cảnh
Phần lớn hợp đồng ở mgmt-app là PDF. App gốc đọc PDF bằng docling + pypdfium2 (Python, `api/app/ingest/parse.py`): PDF có lớp chữ thì lấy chữ; PDF scan (trang trung vị < 50 ký tự) thì nhờ Claude chép lại hoặc OCR docling. Repo chưa có thư viện PDF nào. Yêu cầu giống ADR-0024: chạy trong `hub-api` (Bun), không dịch vụ ngoài, không tải tài nguyên ngoài, có giới hạn kích thước, không chặn vòng sự kiện.

## Lựa chọn
| Phương án | Được | Mất |
|---|---|---|
| **A. `unpdf` (bản đóng gói pdf.js cho server)** | 0 phụ thuộc (pdf.js gói sẵn, ~1,7 MB `pdfjs.mjs`), chạy được trên Bun/Node, API `extractText` theo trang | Gói lớn; pdf.js là bộ phân tích phức tạp ⇒ phải chạy trong worker có lưới thời gian |
| B. Tự viết bộ đọc PDF trên `fflate` | Không thêm gói | Phải tự xử lý ToUnicode CMap / font CID (bắt buộc cho tiếng Việt). Rủi ro sai chữ cao |
| C. Gọi docling/pypdfium2 (tiến trình Python) | Giống app gốc | Trái yêu cầu "không dịch vụ ngoài", image nặng |

## Quyết định: phương án A
1. `unpdf` **1.8.1** (phát hành 2026-08-13, cũ hơn 2 tuần; 1.9.x mới hơn bị loại), pin chính xác ở `apps/hub-api/package.json`.
2. Chỉ dùng ở `apps/hub-api/src/modules/packs/kit/adapters/pdf/` (lớp 3). Lớp 1–2 chỉ thấy port `PdfConverter` (`kit/domain/pdf.rules.ts`). Gói hợp đồng dùng lại được sau.
3. Chạy trong **một Bun Worker**, hàng đợi trong RAM như DOCX: tối đa 2 việc (đang chạy + chờ), mỗi tenant tối đa 1 việc chờ ⇒ `PDF_BUSY`. Lưới an toàn 30 s, vượt thì `terminate()` và trả `PDF_UNREADABLE`.
4. Giới hạn: đầu vào ≤ 20 MiB (chặn trước worker ⇒ `PDF_TOO_LARGE`), ≤ 500 trang (kiểm `numPages` trước khi trích chữ), chữ ra ≤ 5 triệu ký tự (cắt + cảnh báo `truncated`). pdf.js chạy với `useSystemFonts: false`, `disableFontFace: true`, `useWorkerFetch: false`, `enableXfa: false`; không đặt `standardFontDataUrl` (không tải gì).
5. **PDF scan** (trang trung vị < 50 ký tự, luật `is_scanned` của mgmt-app) ⇒ `PDF_NEEDS_OCR`. **OCR nằm ngoài phạm vi.** Bước tiếp theo nếu cần là Claude chép lại như mgmt-app, viết ADR riêng.

## Hệ quả
- Được: nạp được hợp đồng PDF có lớp chữ. PDF hỏng hoặc lạ không làm sập hub-api.
- Mất: bundle hub-api thêm ~2,2 MB. Chất lượng thứ tự chữ phụ thuộc pdf.js (bảng nhiều cột có thể bị trộn dòng).
- Nợ: `PdfQueue` và `DocxQueue` cùng hình, nên gộp thành hàng đợi worker chung (TECH-DEBT).
