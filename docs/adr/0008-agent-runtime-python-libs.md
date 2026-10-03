# ADR-0008 · Thư viện Python cho Agent Runtime (H1)

Trạng thái: **Proposed** (Gate H1) · Ngày: 2026-10-04 · Spec: `docs/specs/H1-hub-core/plan-runtime.md` · Kế thừa: ADR-0007 #11 (uv, ruff, pyright, pytest, pydantic đã duyệt)

## Bối cảnh
`apps/agent-runtime` (Python 3.12, WSL2 Ubuntu) cần: hàng đợi Postgres (`SKIP LOCKED`, `LISTEN job_enqueued/job_cancel`), ghi Redis Streams, chạy Claude Code qua Claude Agent SDK Python (WRK-FR-10), log JSON có `job_id/run_id/tenant_id` (WRK-NFR-04), đọc env có kiểu, test async, kiểm chiều import (CONVENTIONS §9). Chỉ đề xuất cái thực sự cần; không thêm `psutil`, `fakeredis`, ORM.

Phiên bản tra PyPI ngày 2026-10-04 (`https://pypi.org/pypi/<tên>/json`).

## Lựa chọn so sánh

| # | Việc | Lựa chọn A | Lựa chọn B | Số đo / nguồn | Chọn |
|---|---|---|---|---|---|
| 1 | Driver Postgres async | **asyncpg 0.31** (Apache-2.0, wheel cp312 manylinux) — `Connection.add_listener()` cho LISTEN | psycopg 3.3 async — `conn.notifies()` | asyncpg: "on average, 5x faster than psycopg3" (README, bench MagicStack/pgbench 2023-06, https://github.com/MagicStack/asyncpg). Cả hai hỗ trợ LISTEN; tải Runtime nhỏ (≤ vài chục query/giây) nên tốc độ không quyết định | **A** — API LISTEN gọn (callback), pool có sẵn, ít phụ thuộc C ngoài wheel. Rủi ro: LISTEN phải giữ **một kết nối riêng** ngoài pool (ghi ở plan §2) |
| 2 | Redis | **redis-py 8.1** (`redis.asyncio`, MIT) | coredis | redis-py là client chính thức Redis Inc., có `XADD/EXPIRE/pipeline`; coredis ít người dùng hơn | **A** |
| 3 | Chạy Claude Code | **claude-agent-sdk 0.2.163** (MIT; wheel manylinux x86_64 ~103 MB, **đóng gói sẵn CLI**; phụ thuộc `anyio`, `jsonschema`, `mcp`) | Gọi thẳng `claude -p --output-format stream-json` và tự parse | BA bắt buộc SDK (WRK-FR-10). SDK cho hook `PreToolUse` gọi lại vào Python (cần cho WRK-BR-07), `RateLimitEvent`, `ResultMessage.usage/session_id`, `output_format` JSON Schema — tự làm sẽ phải chép lại giao thức control của CLI (docs: https://code.claude.com/docs/en/agent-sdk/python) | **A**. Rủi ro: SDK thay đổi nhanh → **ghim** bản chính xác trong `uv.lock`, nâng bản qua task riêng có chạy lại spike (PY-02) |
| 4 | Log JSON | **structlog 26.1** (MIT/Apache) — `contextvars` gắn `job_id/run_id/tenant_id` cho mọi dòng | stdlib `logging` + python-json-logger 4.2 | structlog: bind theo context không cần truyền logger; python-json-logger chỉ format, phải tự làm `LoggerAdapter`/filter | **A** |
| 5 | Đọc env có kiểu | **pydantic-settings 2.15** | `os.environ` + model pydantic tự viết | Gói nhỏ, cùng hệ pydantic đã duyệt; B thêm ~40 dòng tự viết lặp lại | **A** |
| 6 | Test async | **pytest-asyncio 1.4** (`asyncio_mode=auto`) | plugin pytest của `anyio` (có sẵn vì SDK phụ thuộc anyio) | A là mặc định CONVENTIONS §9 nêu, tài liệu nhiều; B không thêm gói nhưng phụ thuộc bắc cầu | **A**. Không dùng song song B (tránh hai event-loop fixture) |
| 7 | Chiều import | **import-linter 2.15** (BSD-2) — contract `layers` + `forbidden` | ruff `flake8-tidy-imports` (`banned-api`) | ruff chỉ cấm theo tên module toàn cục, không diễn đạt "process con `runtimes/cli/child` không được import `db`, `events`, `config`" | **A** |

Không chọn: `psutil` (dùng `/proc/<pid>/stat` để kiểm process group — Linux-only đã chốt), `fakeredis` (int test dùng Redis thật trong Docker), `tenacity` (Runtime không retry `agent.cli`, WRK-BR-04), ORM (ADR-0007 #9: SQL thuần).

## Quyết định (đề xuất)
Thêm vào `apps/agent-runtime/pyproject.toml`: runtime `asyncpg`, `redis`, `claude-agent-sdk`, `structlog`, `pydantic-settings`; dev `pytest-asyncio`, `import-linter`. Mọi bản ghim trong `uv.lock`, cài bằng `uv sync --frozen`.

## Hệ quả
- Gói SDK ~103 MB/wheel (gồm CLI) → máy Worker cần mạng lúc `uv sync`; CI chỉ cần khi chạy smoke `HUB_LIVE=1` (test/CI dùng `fake-cli`, vẫn cài SDK để pyright kiểm kiểu).
- `CONVENTIONS.md` §9 "Thư viện" chuyển các gói trên từ "dự kiến" sang "đã duyệt" khi ADR Accepted (docs-architect).
- Điểm chưa xác minh của SDK (process group, env, `tools=[]`, `setting_sources=[]`, resume khác `cwd`) kiểm ở task spike PY-02 trước khi code provider.
