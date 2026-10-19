# ADR-0024 · DOCX → Markdown trong module gói: `fflate` + `saxes`, bộ ghi Markdown tự viết

Trạng thái: **Accepted** (2026-10-19, người dùng chốt ở Gate N1; đề xuất backend-lead 2026-10-18) · Liên quan: CR-094, spec [N1](../specs/N1-pack-frame/spec.md) PK-FR-07, PK-NFR-02, Q3; ADR-0001 (pin chính xác), ADR-0021 (parse cho RAG ở N4 — ngoài phạm vi)

## Bối cảnh
Gói `contracts` cần chữ của DOCX dạng Markdown, giữ tiêu đề / danh sách / bảng để chia điều khoản (`reference/mgmt-app-contracts/api/app/contracts/chunk.py` tìm dòng "Điều N"; app gốc dùng Docling Python). Repo chưa có thư viện zip/XML nào (`bun.lock`: không `jszip`, `fflate`, `mammoth`, `saxes`). Yêu cầu cứng: chạy trong `hub-api` (D-01, Bun), không gọi LibreOffice/dịch vụ ngoài; chặn zip bomb (≤ 100 MB giải nén, ≤ 2.000 phần, chặn ≤ 1 s); không tải tài nguyên ngoài; file hỏng ⇒ `DOCX_UNREADABLE`, không 500; mẫu 38,5 KB p95 ≤ 300 ms, 20 MB ≤ 5 s, bộ nhớ đỉnh ≤ 256 MB.

## Lựa chọn
| Phương án | Được | Mất |
|---|---|---|
| A. `mammoth` → HTML → `turndown` (+ plugin bảng GFM) | Thư viện phổ biến, hiểu style tiêu đề/danh sách | README mammoth: đầu ra Markdown **deprecated**, khuyên HTML rồi đổi sang Markdown ⇒ thêm `turndown` + DOM (`domino`); nạp cả zip bằng `jszip`, **không** có giới hạn kích thước giải nén ⇒ phải tự quét central directory trước; README cảnh báo tài liệu độc gây tốn CPU/bộ nhớ, khuyên chạy thread riêng có timeout; ~8+ gói phụ thuộc gián tiếp |
| **B. `fflate` (giải nén) + `saxes` (XML SAX) + bộ ghi Markdown tự viết (~250 dòng)** | `fflate` 0 phụ thuộc, ~8 kB lõi; `filter(file)` thấy `originalSize` **trước** khi giải nén ⇒ bỏ mọi phần trừ `word/document.xml`, `numbering.xml`, `styles.xml`; giải nén luồng cho phép đếm byte thật và dừng khi vượt (không tin `originalSize` khai báo). `saxes` không xử lý entity tự khai trong DTD (chỉ 5 entity chuẩn) ⇒ không "billion laughs", không XXE; nạp từng mảnh `write()` | Tự viết ánh xạ OOXML → Markdown (tiêu đề theo `w:pStyle`/`w:outlineLvl`, danh sách theo `w:numPr`, bảng `w:tbl` → bảng GFM, đậm `w:b`); thiếu các trường hợp hiếm (ô gộp, textbox) ⇒ ghi `warnings` |
| C. Gọi Docling/LibreOffice (tiến trình ngoài) | Chất lượng như app gốc | Trái yêu cầu "không dịch vụ ngoài", image Python/LibreOffice nặng, thêm bước nhảy |

## Quyết định — phương án B
1. Thêm `fflate` và `saxes` vào `apps/hub-api` (pin chính xác theo ADR-0001, chọn bản ≥ 2 tuần tuổi lúc T5g; ghi số bản vào bảng dưới khi cài).
2. Chỉ dùng ở `apps/hub-api/src/modules/packs/kit/adapters/docx/` (lớp 3); lớp 1–2 chỉ thấy port `DocxConverter` (ADR-0023 §2).
3. Chạy trong **Bun Worker** riêng (1 worker, hàng đợi trong RAM, tối đa 2 việc chờ ⇒ việc thứ 3 trả `DOCX_BUSY` 503) để không chặn vòng sự kiện hub-api; timeout 10 s chỉ là lưới an toàn (Luật 4c) — vượt ⇒ `terminate()` worker, trả `DOCX_UNREADABLE`, dựng worker mới.
4. Giới hạn (hằng trong `domain/docx.rules.ts`): số phần zip ≤ 2.000; tổng `originalSize` khai báo ≤ 100 MB; byte giải nén thật ≤ 100 MB (đếm khi giải nén, vượt ⇒ dừng); Markdown ra ≤ 5 MB; có `vbaProject.bin` hoặc `EncryptedPackage` (CFB, không phải zip) ⇒ `DOCX_UNREADABLE`; quan hệ ảnh/link ngoài (`TargetMode="External"`) bị bỏ qua, không tải.

## Hệ quả
- Được: kiểm soát hoàn toàn giới hạn zip bomb và bộ nhớ; ~2 gói nhỏ thay ~10 gói; đầu ra Markdown đúng thứ `chunk.py` cần.
- Mất: tự bảo trì bộ ghi OOXML; chất lượng với DOCX lạ thấp hơn Docling — đo bằng bộ DOCX mẫu ở HD1/HD2; thiếu thì ADR mới.
- Rủi ro: `saxes` không có API Stream Node (chỉ `write()`/`close()`) — đủ vì đầu vào đã giới hạn 100 MB; `fflate` giải nén chậm hơn zlib native ~30% (README fflate) — chấp nhận với ngưỡng PK-NFR-02.

| Gói | Bản | Ghi chú |
|---|---|---|
| `fflate` | (ghi khi T5g cài) | 0 phụ thuộc |
| `saxes` | (ghi khi T5g cài) | phụ thuộc `xmlchars` |

Nguồn: README `github.com/mwilliamson/mammoth.js` (Markdown deprecated, cảnh báo tài liệu độc), README `github.com/101arrowz/fflate` (kích thước, `filter`/`originalSize`, so pako), README `github.com/lddubeau/saxes` (không xử lý entity DTD tự khai).
