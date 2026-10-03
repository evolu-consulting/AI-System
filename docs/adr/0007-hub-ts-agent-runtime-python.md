# ADR-0007 · Hub TypeScript, Agent Runtime Python

Trạng thái: **Accepted** (người dùng, 2026-10-04) · Ngày: 2026-10-04 · CR: CR-028 · Sửa một phần: ADR-0001 (dòng "Ngôn ngữ", "Runtime API: Worker Node LTS", "Queue: BullMQ ở Worker")

## Bối cảnh
ADR-0001 chốt TypeScript toàn monorepo, Worker chạy Agent SDK TypeScript và BullMQ. Người dùng muốn agent nội bộ (và Agent SDK, Codex, Gemini CLI) viết bằng Python, dễ thêm loại agent mới mà không đụng Hub. Hub vẫn cần dùng lại code TypeScript của Admin (luật quyền, giải mã secret, JWT, contract zod).

## Lựa chọn so sánh

| | 1. Toàn TS | 2. Toàn Python (Hub + Runtime) + API snapshot config từ Admin | 3. Hub TS + Agent Runtime Python |
|---|---|---|---|
| Việc phía Admin | Không | Phải làm API snapshot config + cơ chế đẩy thay đổi | Không (Hub vẫn đọc schema `admin` bằng Drizzle) |
| Logic quyền, secret, JWT | Dùng lại `access.rules.ts`, `secret-crypto.ts` | Viết lại bằng Python, hai bản dễ lệch (rủi ro cách ly tenant) | Dùng lại nguyên, chỉ ở Hub |
| Contract giữa hai phần | zod một ngôn ngữ | Admin–Hub bằng API (JSON Schema) | zod → JSON Schema → pydantic, CI kiểm khớp |
| Lượng code Python | 0 | Rất nhiều (cả Hub, Studio API) | Chỉ Agent Runtime |
| Thêm agent/CLI mới | Đổi code TS | Thêm class Python | Thêm class Python, deploy lại Agent Runtime |
| Hệ sinh thái agent (Agent SDK, thư viện AI) | Có (TS) | Có (Python) | Có (Python) |

## Quyết định
Chọn **3**.

| # | Nội dung |
|---|---|
| 1 | Hub giữ TypeScript/Bun: auth, tính quyền, quota, conversation/flow/SSE, vòng lặp Orchestrator (gọi model của Orchestrator), trace, Command Runner → Dify (sync), MCP tools, Studio API. Runtime `dify-workflow`/`dify-agent` chạy trong Hub. **Agent Runtime** (`apps/agent-runtime`, Python, chạy trong WSL2 Ubuntu theo CR-029) = Worker: chạy mọi agent `llm`, `agentic-cli` (Claude Agent SDK Python, Codex, Gemini CLI) và runtime mới `python` |
| 2 | Không có API config Admin↔Hub mới; Admin không phải làm gì thêm |
| 3 | `AgentRunner.run(task, signal) → AsyncIterable<RunEvent>` trong Hub; v1 = tạo job + đọc Redis Stream. Thêm runtime/CLI chỉ đụng Agent Runtime |
| 4 | Hàng đợi Postgres: `hub.jobs` + `SELECT … FOR UPDATE SKIP LOCKED`; `NOTIFY job_enqueued` đánh thức Agent Runtime. Bỏ Redis queue/BullMQ. Slot provider (`max_concurrency`) và slot tenant (`max_concurrent_sub`) đếm từ job `running` trong cùng transaction lấy job (advisory lock theo provider). Bỏ `sub_slots:<tenant_id>` |
| 5 | Sự kiện run qua Redis Streams: Agent Runtime `XADD run:<run_id>` (TTL ~24 giờ); Hub `XREAD`; `id` SSE = id stream ⇒ `Last-Event-ID` đúng khi nhiều instance Hub. Huỷ: Hub ghi `jobs.cancel_requested_at` + `NOTIFY job_cancel` |
| 6 | Payload job, sự kiện run, kết quả agent (`done\|partial\|need_input`) định nghĩa bằng zod (package Hub) → JSON Schema → sinh pydantic; CI kiểm hai bên khớp |
| 7 | Khi khởi động Agent Runtime ghi `hub.agent_types` (key, runtime, mô tả, JSON Schema tham số, version); Studio đọc để dựng form tạo agent. Agent nội bộ mới = thêm class Python + deploy lại, không sửa TS |
| 8 | Agent `python` chạy trong process con không mang secret (như WRK-BR-02), giao tiếp qua interface, chỉ nhận thứ được cấp |
| 9 | Drizzle (`packages/db`) vẫn quản schema `hub`. Python dùng SQL thuần cho `jobs`, `usage_logs`, `cli_sessions`, `provider_state`, `agent_types`; test tích hợp kiểm cột khớp |
| 10 | Playground / Test agent / dry-run của Studio chạy agent qua cùng đường job (ưu tiên cao), không mở API riêng sang Python |
| 11 | Tooling Python chỉ cho `apps/agent-runtime`: `uv`, `ruff`, `pyright` strict, `pytest`. Quy tắc cỡ file/hàm tương đương CONVENTIONS (file ≤ 400 dòng, hàm ≤ 50 dòng) |

## Hệ quả
- Repo hai ngôn ngữ. ADR-0001 không còn "TypeScript toàn bộ" cho Agent Runtime; Admin, Hub, Chat vẫn TS.
- Đã bổ sung chuẩn Python: xem `docs/CONVENTIONS.md` §9.
- Thêm bước CI: xuất JSON Schema từ zod, sinh pydantic, so khớp; chạy `ruff`, `pyright`, `pytest` cho `apps/agent-runtime`.
- Phụ thuộc mới (Python: Agent SDK, driver Postgres, redis-py, pydantic) chốt ở ADR/plan của mốc H1.
- Hub cần module `AgentRunner`, đọc Redis Streams và `hub.agent_types`; Gateway phía Hub chỉ phục vụ Orchestrator, Agent Runtime có bản Python của Gateway cho agent `llm` (cùng profile/fallback/ghi usage).
- Chat/Admin: không đổi.
