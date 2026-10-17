# Evolu Platform — gộp AI-System và mgmt-app

Repo này là bản clone của AI-System (nhánh `platform/gd0`) làm lõi cho nền tảng mới. Gói nghiệp vụ lấy từ mgmt-app
(Sổ Hợp Tác); mã tham chiếu ở `reference/mgmt-app-contracts/`.

- Tài liệu kiến trúc đầy đủ (bản 10): https://claude.ai/artifact/DkAC8zo2AGrnnD4cobUmya — **khi lệch, ADR trong repo đúng.**
- Kế hoạch GĐ0: [`GD0-plan.md`](GD0-plan.md)
- Spike engine chạy bền: [`spike-engine.md`](spike-engine.md)
- ADR mới: `docs/adr/0016`–`0022` (Proposed, chờ Gate GĐ0)

## Quyết định đã chốt với người dùng (2026-10-17)

| Chủ đề | Quyết định |
|---|---|
| Lõi | AI-System (Hub, MCP, RLS, audit, hàng đợi job) giữ nguyên |
| Workflow | Engine của AI-System, mở rộng tối thiểu ở GĐ1; canvas đầy đủ ở GĐ3 |
| Dify | Hybrid tạm: Dify là công cụ AI Hub gọi, theo bảy quy tắc (ADR-0022) |
| AI runtime | Claude CLI / Agent SDK, đăng nhập subscription; đổi sang API key bằng cấu hình (ADR-0019) |
| Dữ liệu | Postgres là nguồn chuẩn; OpenSearch chỉ là chỉ mục (ADR-0016) |
| File | FileBox là kho file chung (ADR-0015, cần bổ sung org theo tenant) |
| Tri thức | Một dịch vụ tri thức từ pipeline RAG của mgmt-app (ADR-0021) |
| SDLC / DLC | Chỉ lập plan, chưa build |
| UI | Giữ pattern UI cũ của mgmt-app (Vite + React + Tailwind) và bảng màu chung với admin-web |
| GĐ1 | Một khách, một flow (duyệt hợp đồng) |

## Quy trình

Repo giữ nguyên luật làm việc của AI-System (`CLAUDE.md`): Intake (Luật 0) và Cửa sẵn sàng (Luật 1) áp dụng trước khi
viết code cho GĐ1. GĐ0 chỉ gồm tài liệu (ADR, plan, spike plan).
