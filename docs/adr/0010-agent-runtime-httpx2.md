# ADR-0010 · HTTP client cho Agent Runtime: httpx2 (H2a)

Trạng thái: **Accepted** (Gate H2a, 2026-10-05) · Ngày: 2026-10-05 · Spec: `docs/specs/H2a-dify-command/plan-runtime.md` §8 · Kế thừa: ADR-0007, ADR-0008

## Bối cảnh
H2a cho Agent Runtime (Python, WSL2) ba việc gọi HTTP: (1) job `workflow.async` gọi Dify `response_mode=streaming` (SSE), API stop, retry 2 s/8 s (WRK-FR-06/07); (2) lấy app-key qua endpoint nội bộ của Hub bằng token job (spec-decisions Q5); (3) `fake-cli` gọi MCP `/mcp` của Hub (JSON-RPC qua HTTP) trong test. ADR-0008 chưa có HTTP client. Test cần giả lập SSE không cần server thật (unit).

Số liệu lấy từ `apps/agent-runtime/uv.lock` và gói đã cài trong `.venv` (2026-10-05).

## Lựa chọn so sánh
| # | Lựa chọn | Đặc điểm | Gói thêm vào lock | Ghi chú |
|---|---|---|---|---|
| A | **httpx2 2.13.1** (BSD-3-Clause, `pydantic/httpx2`, Python ≥ 3.10, wheel 95,6 KB) | `AsyncClient` stream, timeout tách connect/read, **`EventSource` SSE có sẵn** (`httpx2/_sse.py`, gốc httpx-sse MIT), **`MockTransport`** cho unit | **0** — đã có bắc cầu: `claude-agent-sdk 0.2.163` → `mcp 2.3.0` → `httpx2` (+ `httpcore2`, `anyio`, `truststore`) | Gói mới (thế hệ sau httpx), API có thể đổi giữa bản lớn; cùng phiên bản `mcp` dùng ⇒ nâng cùng SDK |
| B | httpx 0.28 + httpx-sse | API gần như A | +2 gói trực tiếp (+ `httpcore` riêng) — hai ngăn xếp HTTP song song với `httpx2` của `mcp` | Không lợi gì hơn A |
| C | aiohttp 3.x | client/server async, phổ biến | + aiohttp và nhiều phụ thuộc (multidict, yarl, frozenlist, aiosignal…; có phần mở rộng C) | SSE phải tự parse; mock cần server thật hoặc thư viện mock riêng |
| D | stdlib (`asyncio.open_connection` tự viết HTTP/1.1) | không gói | 0 | Phải tự làm chunked, TLS, keep-alive, SSE — rủi ro lỗi, ngược CONVENTIONS ("không tự viết thứ thư viện đã có") |

Không đo hiệu năng: tải v1 ≤ 5 job `workflow.async` đồng thời (WRK-NFR-05), mỗi job một kết nối stream — chênh lệch thư viện không quyết định.

## Quyết định (đề xuất)
**A.** Thêm `httpx2>=2.13,<3` vào `dependencies` của `apps/agent-runtime/pyproject.toml` (khai báo trực tiếp thứ đang dùng bắc cầu), `uv lock` không đổi bản. Dùng `httpx2.AsyncClient` + `EventSource`; unit test dùng `MockTransport`; int test dùng server stdlib trong `tests/support/` (không thêm thư viện mock). Không thêm `mcp` làm phụ thuộc trực tiếp (`fake-cli` gọi JSON-RPC tối thiểu bằng httpx2).

## Hệ quả
- Nâng `claude-agent-sdk` (task riêng + spike, ADR-0008) phải kiểm khoảng `httpx2` mà `mcp` yêu cầu vẫn trong `<3`.
- `log.py` đặt logger `httpx2`, `httpcore2` mức `WARNING` (không log URL/header ở DEBUG — R17).
- `CONVENTIONS.md` §9 "Thư viện" thêm `httpx2` vào danh sách đã duyệt khi ADR Accepted (docs-architect).
