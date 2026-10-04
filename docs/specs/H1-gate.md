# Gate H1 — Hub lõi (TS) + Agent Runtime tối thiểu (Python)

Ngày: 2026-10-04 · Trạng thái: **CHỜ NGƯỜI DÙNG DUYỆT** · Readiness: READY (`H1-hub-core/readiness.md`, 4 lần)

**Không tự duyệt (Luật 2b):** có ADR thư viện mới (ADR-0008, ADR-0009 Proposed). Người dùng đã chốt Q1 (chưa có API key → Orchestrator và agent chạy CLI qua `claude-sub`), chấp nhận mọi mặc định readiness lần 1 (+ lần 2–4 không có câu hỏi mới), trả lời W0 = "chưa" (chưa chuẩn bị WSL2/đăng nhập `claude`).

## 1. Phạm vi (`H1-hub-core/spec.md` §1)
- `apps/hub-api` (TS/Bun/Hono): verify JWT Admin, hội thoại/flow/tin nhắn, SSE đúng contract chat C1 + `Last-Event-ID` (Redis Streams `run:`/`sse:`, CR-030), huỷ, cách ly tenant 404 + RLS `hub_rw`, vòng Orchestrator (mọi tin, CR-025; kết quả agent `done/partial/need_input`; pass-through), quyền agent từ seed.
- `apps/agent-runtime` (Python, WSL2): claim job Postgres `SKIP LOCKED` + khoá toàn cục, slot provider/tenant trong DB, heartbeat/orphan, huỷ ≤ 5 s theo process group (mỗi job một process con, env tường minh), runtime `agentic-cli` qua Claude Agent SDK Python (`claude-sub`), hook chặn đường dẫn, resume session, `fake-cli` cho test, manifest `agent_types`.
- Schema `hub` riêng (`packages/db/migrations-hub/`, không đụng migration/test khoá Admin), contract `@ai/contracts/hub` (zod → JSON Schema → pydantic).
- **Không làm:** Studio, Dify/command/MCP, runtime `llm`/`python`, Codex/Gemini, fallback nhiều provider, quota/chi phí, `/agent-grants`.

## 2. ADR cần duyệt
| ADR | Nội dung |
|---|---|
| **0008** | Thư viện Python: `asyncpg`, `redis`, `claude-agent-sdk` (ghim 0.2.163), `structlog`, `pydantic-settings`; dev `pytest-asyncio`, `import-linter` |
| **0009** | Hub dùng `ioredis` 6.0.0 (đã ghim ở ADR-0001); `z.toJSONSchema` (zod 4, không thêm thư viện); `datamodel-code-generator` (dev Python) sinh pydantic |

## 3. Contract / dữ liệu
`plan.md` §2 (contract hub), §3 + `plan-db.md` (18 bảng, role `hub_rw`/`agent_runtime`, RLS, thứ tự khoá), `plan-errors.md` (câu lỗi vi/en, `runs.locale`). Contract chat C1: chỉ import, không sửa.

## 4. Test (`test-plan.md` + `test-plan-cases.md`)
~181 ca: unit TS ~50, int hub-api ~60, Python ~50, stack 4, perf 4 (không chặn), cộng bộ contract chat đã khoá (`HUB_URL`=hub-api). Mọi test tự động dùng `fake-cli`/SDK giả. DB test riêng `ai_system_h1_test`.

## 5. Rủi ro
- **W0 chưa sẵn sàng:** spike Agent SDK (PY-02) và smoke CLI thật (HUB-H1-AC-02) `blocked`, dời task I2 cuối H1; các phần phụ thuộc spike code theo dự phòng, xác minh lại sau.
- Orchestrator chạy CLI ⇒ mỗi tin chậm thêm vài giây (chấp nhận đến khi có API key).
- Combine với Chat: `/auth/*` admin-api có thể lệch contract chat (K-A1…A7); typecheck toàn repo đỏ do code dở của Chat — `done:h1` lọc theo package Hub.
- Thấp readiness lần 4 (#51–#53) qc làm ở bước viết test.

## 6. Thứ tự BUILD sau duyệt
C1/D1/PY-01 → B0 (stub chữ ký) → qc viết test QW-R → QW-A1 → QW-A2 → QW-P → QW-S (đỏ đúng lý do, DB riêng) → Q2 khoá → B2–B10 ∥ PY-03–PY-13 (một task/lần gọi, model theo cột Rủi ro) → I1 `done:h1` → reviewer (≤ 2 vòng) → docs → W0 (người dùng) → I2 chạy CLI thật. Trên `main`, không push.
