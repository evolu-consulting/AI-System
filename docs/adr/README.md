# ADR

Mỗi quyết định kiến trúc một file `NNNN-<slug>.md`: Trạng thái (Proposed / Accepted / Superseded by NNNN) · Bối cảnh · Lựa chọn so sánh (kèm số đo nếu có) · Quyết định · Hệ quả. ADR Proposed được duyệt cùng Gate của mốc (xem `../WORKFLOW.md`).

| # | Tên | Trạng thái |
|---|---|---|
| 0001 | Stack nền | Accepted |
| 0003 | Driver Postgres (postgres.js) và bản TypeScript (6.0.3) | Accepted |
| 0004 | Thư viện web M1: toast (sonner) và resolver form (@hookform/resolvers) | Accepted (Gate M1, 2026-10-01) |
| 0005 | Thư viện M4: nodemailer, qrcode, yaml; TOTP tự viết; biểu đồ Admin không recharts | Accepted (2026-10-03) |
| 0006 | Render markdown + highlight code cho Chat App (react-markdown, remark-gfm, highlight.js core) | Accepted (Gate C1, 2026-10-04) |
| 0007 | Hub TypeScript, Agent Runtime Python (queue Postgres, sự kiện Redis Streams) | Accepted (người dùng, 2026-10-04) |
| 0008 | Thư viện Python cho Agent Runtime (asyncpg, redis-py, claude-agent-sdk, structlog, pydantic-settings, pytest-asyncio, import-linter) | Accepted (Gate H1, 2026-10-04) |
| 0009 | Hub: Redis client ioredis + toolchain contract (z.toJSONSchema, datamodel-code-generator) | Accepted (Gate H1, 2026-10-04) |
| 0010 | Agent Runtime: HTTP client httpx2 (Dify SSE, endpoint nội bộ Hub, MCP cho fake-cli) | Accepted (Gate H2a, 2026-10-05) |
| 0011 | Sandbox ghi + thực thi + container cô lập cho job tự-sửa (P-c, CR-061) | Proposed (chưa chốt, quyết lúc BUILD P-c; có phần "Bổ sung (CR-065)") |
| 0012 | KnowledgeHub làm RAG ngoài — Hub làm proxy (CR-062) | Proposed (trình Gate K1) |
| 0013 | Canvas quy trình admin-web: `@xyflow/react` (CR-063) | Accepted (Gate P-b2, 2026-10-12) |
| 0014 | Công cụ code-graph (graphify/gitnexus) chạy như chương trình trên Runtime (CR-066) | Proposed (trình Gate K2) |
| 0015 | FileBox — lưu file ngoài (driver Storage `filebox`) | Accepted (Gate FB1, 2026-10-15) |
| 0016 | Postgres là nguồn chuẩn cho dữ liệu giao dịch của gói | Accepted (2026-10-18, CR-094) |
| 0017 | Engine quy trình chạy bền cho flow nghiệp vụ dài ngày | Accepted (2026-10-17; (a), điều kiện sửa #190 ở P-d T9) |
| 0018 | Một nguồn định danh, SSO theo tenant | Accepted (2026-10-18, CR-094) |
| 0019 | AI runtime: CLI subscription, đổi API key bằng cấu hình | Proposed (Gate GĐ0 platform) |
| 0020 | Hạ tầng production | Proposed (Gate GĐ0 platform) |
| 0021 | Một dịch vụ tri thức thay hai RAG | Accepted (2026-10-18, CR-094; lịch kéo lên GĐ1 lát N4) |
| 0022 | Hybrid tạm: Dify là công cụ AI do Hub gọi | Proposed (Gate GĐ0 platform) |
| 0023 | Clean Architecture bốn lớp, lớp 1–2 chỉ dùng thư viện có sẵn; chuyển dần theo module (CR-088…091) | Accepted (người dùng, 2026-10-17) |
| 0024 | DOCX → Markdown trong module gói: fflate + saxes (N1, CR-094) | Accepted (Gate N1, 2026-10-19) |
| 0029 | AI client chung của Hub gọi Claude bằng `@anthropic-ai/sdk` 0.135.0 (usage + trần theo tenant, M3-decouple) | Accepted (người dùng, 2026-10-20) |
| 0030 | Duyệt hợp đồng chạy trên process engine, đảo một phần M3-decouple (cờ `CONTRACTS_APPROVAL_ENGINE`, `HUB_PROCESS_ENGINE`) | Accepted (người dùng, 2026-10-23) |
| 0032 | Delta kiểu OpenSpec + bộ kiểm `openspec:check/pending/archive`, không dùng CLI OpenSpec | Accepted (người dùng, 2026-10-28) |
