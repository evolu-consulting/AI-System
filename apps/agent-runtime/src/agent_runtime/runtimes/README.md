# runtimes/ — các loại runtime job (plan-runtime §1.1)

| Thư mục | Nội dung |
|---|---|
| `cli/` | `agentic-cli`: job host process con, giám sát, kết quả, session (xem `cli/README.md`) |
| `dify/` | `workflow.async`: gọi Dify thay user, không process con (xem `dify/README.md`) |
| `dispatch.py` | `JobRouter`: chọn host theo `payload.type` (`agent.cli` → `CliJobHost`, `workflow.async` → `DifyJobHost` khi `dify` ∈ `AGENT_RT_PROVIDERS`; lạ → host CLI, `invalid_payload` như H1) |

`llm/`, `python/`: chưa có (mốc sau). Lớp `runtimes` không import `queue` (import-linter).
