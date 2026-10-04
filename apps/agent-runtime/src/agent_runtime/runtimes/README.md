# runtimes/ — các loại runtime job (plan-runtime §1.1)

| Thư mục | Nội dung |
|---|---|
| `cli/` | `agentic-cli`: job host process con, giám sát, kết quả, session (xem `cli/README.md`) |
| `dify/` | `workflow.async`: gọi Dify thay user, không process con (xem `dify/README.md`) |

`llm/`, `python/`: chưa có (mốc sau). Lớp `runtimes` không import `queue` (import-linter).
