# ADR-0039 · Thêm `pdf-lib` để ghép ảnh chụp trang thành PDF (CR-122 p9)

Trạng thái: **Accepted** (người dùng duyệt, 2026-11-06). Liên quan: ADR-0024/0028 (đọc tệp), FLOW2-FR-27.

## Bối cảnh
Người dùng tải hợp đồng đã ký dạng nhiều ảnh chụp trang (JPG/PNG). Server phải ghép một PDF để lưu và đọc như PDF scan. Bộ đọc JPEG/PNG tự viết (giải nén zlib, bỏ lọc dòng, SMask) dài, phức tạp và dễ sai.

## Quyết định
Dùng **`pdf-lib` 1.17.1** (ghim chính xác, `apps/hub-api`): `embedJpg`/`embedPng`, mỗi ảnh một trang, cỡ trang = cỡ ảnh. Thuần JavaScript, không thư viện native, không mạng. Chỉ dùng ở `contracts/domain/images-pdf.rules.ts`.

## Hệ quả
- Giữ chặn PNG khai cỡ > 40 triệu điểm trước khi giải mã; ≤ 50 ảnh (trần trang, cấu hình `CONTRACTS_SCAN_MAX_PAGES`).
- `pdf-lib` ít cập nhật (bản cuối 2021) nhưng ổn định; chỉ ghi PDF mới, không đọc PDF không tin cậy (đếm trang dùng `unpdf`).
- WEBP/GIF không cần ghép: model nhận thẳng như ảnh đơn. HEIC không nhận, báo rõ "chưa đọc được".
