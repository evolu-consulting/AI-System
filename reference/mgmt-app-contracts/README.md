# mgmt-app (Sổ Hợp Tác) — mã tham chiếu cho gói Hợp đồng

Bản sao **chỉ để đọc** các phần của `F:\workspace\mgmt-app` (repo `evolu-consulting/so-hop-tac`, commit `b839418`)
cần cho gói Hợp đồng ở GĐ1. Chưa nối vào build, CI hay workspace của monorepo (biome bỏ qua thư mục `reference/`).

| Thư mục | Nguồn | Dùng làm gì ở GĐ1 |
|---|---|---|
| `api/app/contracts/` | trích xuất, kiểm trích dẫn (`verify.py`), nhắc hạn, sourcing | Node "AI đọc hợp đồng" + bước kiểm trích dẫn chung |
| `api/app/ledger/` | nghĩa vụ thanh toán, follow-up | Bảng nghĩa vụ trong Postgres, node nhắc hạn |
| `api/app/companies/`, `api/app/scoring/` | đối tác, điểm uy tín | Dữ liệu đối tác của gói |
| `api/app/assistant/` (mcp_server, tools, actions, cards) | tool MCP và thẻ đề xuất | Tool MCP qua HTTP, cổng xác nhận |
| `api/app/models.py`, `settings.py` | model Pydantic, cấu hình | Đối chiếu khi viết schema Postgres |
| `api/app/seed/` | dữ liệu mẫu (`cks_market.jsonl`) | Seed cho staging |
| `api/tests/test_contract_*.py` | test hợp đồng | Kịch bản test cho flow hợp đồng |
| `web/src/` | UI Vite + React + Tailwind | **Giữ pattern UI cũ** cho vỏ app lớn và gói Hợp đồng |
| `samples/HD-bao-bi-Minh-Phat.docx` | `mgmt-app-samples` | Hợp đồng mẫu cho eval và demo |

Không copy: `.env`, dữ liệu thật trong `data/`, `cm-web/`, phần OpenSearch/Neo4j store (sẽ thay bằng Postgres theo ADR-0016).
