# ADR-0014 · Công cụ code-graph (graphify/gitnexus) chạy như chương trình trên Runtime

Trạng thái: **Proposed (Đề xuất)** — chưa duyệt; trình Gate mốc K2 (thêm công cụ ngoài) · Ngày: 2026-10-12 · CR-066 · Kế thừa: WRK-FR-27, ADR-0007, ADR-0012

## Bối cảnh
Giai đoạn 2 của KnowledgeHub (HUB-FR-135): nạp nguồn mã vào KH qua `/codegraph/import`. Cần dựng đồ thị mã (graphify/gitnexus) từ snapshot nguồn đã lọc. Không được cho agent LLM chạy công cụ này (tốn token, cần Bash).

## Lựa chọn
| # | Phương án | Nhận xét |
|---|---|---|
| A | Agent LLM chạy công cụ bằng Bash | Loại: tốn token, mở Bash ngoài container (HUB-BR-33) |
| B | KH tự clone repo và dựng graph | Cần khoá git ở KH; ngoài phạm vi ai-system |
| C | **Runtime chạy graphify/gitnexus như chương trình + adapter đẩy vào KH** | Chọn: 0 token, tái dùng snapshot đã lọc bí mật (WRK-FR-27) |

## Quyết định (dự kiến)
1. Runtime chạy công cụ **như chương trình** (WRK-FR-30), đầu vào là snapshot đã lọc (loại `.env*`, khoá, `.git`), không qua agent, không Bash cho agent.
2. Chỉ nguồn bật "cho phép nạp vào KH"; Hub lưu project KH + SHA đã nạp (ADM-FR-70). Tài liệu gửi file gốc cho KH parse.
3. **License:** kiểm license gitnexus và graphify **trước khi dùng thương mại** (chưa kiểm — chặn BUILD K2 tới khi có kết quả); chọn một trong hai hoặc cả hai theo kết quả.
4. Cách cấp khoá KH cho adapter chốt ở spec K2 (khoá không vào thư mục job; nghiêng về Hub giữ khoá — ADR-0012).
5. Nếu công cụ cần chạy trong container thì K2 sau P-c (dùng hạ tầng ADR-0011).

## Hệ quả
- Runtime thêm phụ thuộc công cụ ngoài (Node/Python tuỳ công cụ) — liệt kê ở spec K2 và trình Gate.
- Lỗi theo file phải được báo ngược lên Hub → màn Nguồn + DM hệ thống.
