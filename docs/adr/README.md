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
| 0008 | Thư viện Python cho Agent Runtime (asyncpg, redis-py, claude-agent-sdk, structlog, pydantic-settings, pytest-asyncio, import-linter) | Proposed (Gate H1) |
| 0009 | Hub: Redis client ioredis + toolchain contract (z.toJSONSchema, datamodel-code-generator) | Proposed (Gate H1) |
