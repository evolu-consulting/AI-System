# ADR-0041 · Thêm `@napi-rs/canvas` để dựng ảnh trang đầu PDF cho email Mời ký (CR-125 x12)

Trạng thái: **Accepted** (điều phối chốt theo Luật 2b, 2026-11-08). Liên quan: ADR-0039 (`pdf-lib`), ADR-0024/0028 (đọc PDF bằng `unpdf`), FLOW2-FR-25.

## Bối cảnh
Email "Mời ký số" gửi người ký công ty cần ảnh trang 1 của hợp đồng (xem nhanh, không đính PDF). Cần biến trang PDF thành JPEG ở máy chủ, một lần mỗi phiên bản hợp đồng.
`unpdf` (đã dùng) chỉ đọc chữ/đếm trang; vẽ trang ra ảnh cần một canvas — `unpdf.renderPageAsImage` nhận canvas qua `canvasImport`, và khai báo `@napi-rs/canvas` là peer tuỳ chọn.

## Quyết định
Dùng **`@napi-rs/canvas` 1.1.0** (ghim chính xác, `apps/hub-api`) đúng một chỗ: `packs/contracts/adapters/page-thumb.ts` — trang 1 → PNG → thu về rộng ≤ 560 px → JPEG chất lượng 70 (< 120 KB).

Phương án đã cân nhắc:
- **`pdftoppm`/`mutool`/Ghostscript** (tiến trình ngoài): thêm gói hệ điều hành vào image, thêm tiến trình con chạy dữ liệu khách ⇒ bề mặt tấn công và vận hành lớn hơn.
- **`pdfjs-dist` + `canvas`/`skia-canvas`** trực tiếp: phải tự viết cầu nối; `unpdf` đã bọc sẵn pdf.js đúng cách cho Bun/serverless.
- **Chụp ảnh bằng trình duyệt headless**: nặng, cần Chromium trong image prod.
- **Không ảnh (chỉ thẻ chữ)**: vẫn là hành vi dự phòng khi không dựng được.

## Đặc điểm
- **Native** (Rust + Skia), phát hành kèm **bản dựng sẵn** theo nền tảng qua `optionalDependencies` (`@napi-rs/canvas-linux-x64-gnu`, `-linux-x64-musl`, `-linux-arm64-*`, `-darwin-*`, `-win32-*`). Không biên dịch lúc cài, không cần gói hệ thống.
- **Hạ cấp êm:** `page-thumb.ts` nạp bằng `import()` lúc dùng và bọc `try/catch` — thiếu/hỏng binary, PDF hỏng/mã hoá, ảnh > 120 KB ⇒ trả `null` ⇒ email bỏ ảnh, vẫn có thẻ tóm tắt và nút. Không bao giờ chặn bước gửi ký.
- **Cache theo instance, có chặn bộ nhớ:** ảnh nhớ trong bộ nhớ theo `(tenant, files.id)` — tệp bất biến (phiên bản mới = tệp mới) nên không cần vô hiệu hoá; tối đa **200 mục** (đẩy mục cũ nhất), mỗi mục ≤ ~160 KB base64 ⇒ trần ~32 MB/instance; thất bại nhớ 10 phút để không dựng lại liên tục. Nhiều instance ⇒ mỗi instance dựng tối đa một lần/tệp. Cài đặt công ty "Kèm ảnh trang đầu trong email mời ký" (mặc định bật) tắt ⇒ không dựng.
- **Bảo mật:** chỉ trang 1 dưới dạng ảnh, nhúng CID trong email; không đính PDF, không điều khoản dạng chữ. PDF ≤ 25 MB, chỉ đọc tệp của đúng tenant (org khớp).

## Tác động Docker/prod
- Image `app` (`deploy/prod-sohoptac2/Dockerfile`, `oven/bun:1.3.14` = **Debian glibc**) chạy `bun install --frozen-lockfile`: Bun chọn `@napi-rs/canvas-linux-x64-gnu` (lockfile đã liệt kê đủ các biến thể; biến thể `-musl` không dùng trên glibc). Không đổi Dockerfile.
- Kiểm: `page-thumb.test.ts` (dựng JPEG thật từ PDF) **xanh trên máy chủ evotest** (cùng nền `oven/bun:1.3.14` Linux x64) — binary dựng sẵn nạp được. Nếu sau này đổi sang base Alpine thì Bun chọn `-musl`, đã có trong `bun.lock`.
- Kích thước: thêm một gói native ~10–20 MB mỗi nền tảng được cài (chỉ nền tảng khớp).
- Rủi ro còn lại: nâng Bun/đổi base image mà thư viện không nạp được ⇒ chỉ mất ảnh (hạ cấp êm), không mất email; `ops-watch` chưa có check riêng cho việc này (việc dở).
