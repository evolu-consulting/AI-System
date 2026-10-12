# ADR-0012 · KnowledgeHub (KH) làm RAG ngoài — Hub làm proxy

Trạng thái: **Proposed (Đề xuất)** — chưa duyệt; trình Gate mốc K1 (thêm dịch vụ ngoài) · Ngày: 2026-10-12 · CR-062, CR-066 · Kế thừa: HUB-BR-12/14/15/30/31

## Bối cảnh
Hub cần RAG (tri thức theo agent, ghi lại tóm tắt stage). KH là dịch vụ RAG tự host của dự án ai-sdlc (`D:\AI\ai-sdlc-rowan\POC\KnowledgeHub`). Hub không tự dựng vector store/embedding. HUB-BR-12 hiện chỉ cho agent gọi workflow Dify; HUB-BR-30 cấm secret vào thư mục job.

## Lựa chọn
| # | Phương án | Nhận xét |
|---|---|---|
| A | Agent gọi thẳng KH (khoá trong job) | Loại: lộ khoá, agent egress ra ngoài (vi phạm HUB-BR-30) |
| B | Bọc KH thành workflow Dify | Giữ HUB-BR-12 nhưng thêm một tầng, mất kiểm soát tenant ở Hub |
| C | **Hub làm proxy: tool `kh_query` qua `/mcp` của Hub, token job** | Chọn: khoá chỉ ở Hub, Hub kiểm tenant/project trước khi gọi |

## Quyết định (dự kiến)
1. **Proxy (C):** `kh_query` do Hub cung cấp qua `/mcp`; **ngoại lệ có chủ đích của HUB-BR-12** (ghi tại HUB-BR-12/36). Khoá KH chỉ ở Hub (secret loại mới, chỉ ghi — cần Secrets H4b), không vào job (HUB-BR-30); agent không egress tới KH.
2. **Cách ly:** mỗi project KH gắn đúng một tenant (hoặc cờ "dùng chung nền tảng" do `platform_admin`, chỉ dữ liệu không thuộc tenant); Hub chỉ hỏi/ghi project của tenant đang chạy run; tenant khác ⇒ 404 (HUB-BR-35).
3. **Dữ liệu ra ngoài:** URL KH nằm trong allowlist, TLS bắt buộc (trừ localhost dev); tính năng tắt mặc định, `tenant_admin` bật theo công ty (HUB-BR-37).
4. **Ghi:** Hub (chương trình, 0 token) ghi `## Tóm tắt` sau gate Đạt (HUB-FR-133). Kết quả truy vấn là dữ liệu, không phải lệnh (HUB-BR-31).
5. **Degrade:** KH sập/không trả lời ⇒ stage chạy tiếp không có tri thức, cảnh báo vào output + audit, không chặn run (HUB-FR-134).
6. **Phiên bản API KH tối thiểu:** *<chưa xác định — điền khi viết spec K1 sau khi đọc API KH>*; Hub kiểm lúc "Kiểm tra kết nối".
7. **Dev/test:** dùng **mock KH**; không thêm KH vào docker-compose.
8. **Ngoài phạm vi ai-system:** thay đổi phía KH (parse PDF/DOCX, embedder bge-m3 thay bge-small-en, báo lỗi theo file) do dự án KH làm.

## Hệ quả
- Thêm một dịch vụ ngoài (HTTP client tới KH; thư viện mới nếu có sẽ ghi ở spec K1 và trình Gate).
- Hub thành điểm phải chịu tải truy vấn KH của mọi agent: cần trần số lần/kích thước kết quả (chốt ở spec K1).
- Giai đoạn 2 (nạp nguồn): ADR-0014.
