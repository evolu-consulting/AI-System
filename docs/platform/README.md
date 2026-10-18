# Evolu Platform — gộp AI-System và mgmt-app

Repo này là bản clone của AI-System (nhánh `platform/gd0`) làm lõi cho nền tảng mới. Gói nghiệp vụ lấy từ mgmt-app
(Sổ Hợp Tác); mã tham chiếu ở `reference/mgmt-app-contracts/`.

- Tài liệu kiến trúc đầy đủ (bản 10): https://claude.ai/artifact/DkAC8zo2AGrnnD4cobUmya — **khi lệch, ADR trong repo đúng.**
- Kế hoạch GĐ0: [`GD0-plan.md`](GD0-plan.md)
- Spike engine chạy bền: [`spike-engine.md`](spike-engine.md)
- Intake gói hợp đồng (phạm vi GĐ1 mới): [`intake-hd.md`](intake-hd.md)
- ADR mới: `docs/adr/0016`–`0022`; 0016, 0018, 0021 **Accepted** (2026-10-18), 0019, 0020, 0022 còn Proposed

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
| UI | Giữ pattern UI cũ của mgmt-app (React + Tailwind, build Rsbuild theo ADR-0001, không Vite) và bảng màu chung với admin-web |
| GĐ1 (sửa 2026-10-18, CR-094) | Hai luồng song song: lõi dùng chung N1–N7 ∥ app mẫu mgmt-app đủ tính năng HD1–HD10; chuyển khách thật. Chi tiết: [`intake-hd.md`](intake-hd.md) |
| GĐ1 ∥ GĐ2 | Kéo lên GĐ1: dịch vụ tri thức (ADR-0021), định danh chung (ADR-0018), hạ tầng chịu lỗi (ADR-0020); SSO OIDC vẫn GĐ2 |
| App mẫu | mgmt-app là app mẫu đầu tiên trên lõi, đủ tính năng hiện có, trình diễn các flow |
| AI của gói | Agent Claude trong Hub, không qua Dify (Dify chỉ giữ vai ADR-0022 cho phần đang có) |
| Trợ lý chat | Một trợ lý chung trong Agent Hub; gói chỉ thêm bộ tool hợp đồng (MCP) + nhúng khung chat |

## Quy trình

Repo giữ nguyên luật làm việc của AI-System (`CLAUDE.md`): Intake (Luật 0) và Cửa sẵn sàng (Luật 1) áp dụng trước khi
viết code cho GĐ1. GĐ0 chỉ gồm tài liệu (ADR, plan, spike plan).
