# ADR-0014 · Nạp nguồn vào KH (packs) và công cụ code-graph

Trạng thái: **Proposed (Đề xuất)** — chưa duyệt; trình Gate mốc K2 · Ngày: 2026-10-12, sửa 2026-10-13 · CR-066, CR-069 · Kế thừa: WRK-FR-27, ADR-0007, ADR-0012

## Bối cảnh
Giai đoạn 2 của KnowledgeHub (HUB-FR-135). Khảo sát KH v6.4: `/codegraph/import` thuộc bề mặt "người" (khoá chung, không phân project) — **không** dùng cho tích hợp đa tenant (ADR-0012 §1); KH chưa có route `/v1` cho code-graph; KH **không parse PDF/DOCX**. Bề mặt `/v1/{ns}/packs` nạp được text/markdown/code.

## Quyết định (dự kiến, CR-069)
1. **K2 chỉ nạp text/markdown/code** qua `/v1/{ns}/packs` (capability `packs`), từ snapshot nguồn đã lọc (loại `.env*`, khoá, `.git`; WRK-FR-27). Chỉ nguồn bật "cho phép nạp vào KH"; Hub lưu project KH + SHA đã nạp (ADM-FR-70).
2. **PDF/DOCX:** báo lỗi theo file "định dạng chưa hỗ trợ"; Hub không trích chữ lại, không gửi file gốc. Làm lại khi KH hỗ trợ parse.
3. **Code-graph (graphify/gitnexus, `/codegraph/import`) hoãn** tới khi KH có route `/v1`. ADR giữ **Proposed**. Khi làm: chạy như chương trình trên Runtime (WRK-FR-30), không qua agent LLM, không Bash cho agent (HUB-BR-39); không dùng khoá chung bề mặt người.
4. **License:** kiểm license graphify/gitnexus trước khi dùng thương mại (chặn phần code-graph, không chặn K2 packs).
5. Credentials KH: Hub giữ, dùng cơ chế ADR-0012 §1; không vào thư mục job.
6. Nếu bước nạp cần container thì phần đó sau P-c (ADR-0011).

## Hệ quả
- K2 thu hẹp: không thêm công cụ ngoài vào Runtime ở giai đoạn này.
- Lỗi theo file báo ngược lên Hub → màn Nguồn + DM hệ thống.
