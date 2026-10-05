# providers/fake/ — provider giả `fake-cli` (plan-runtime-fake §7)

| File | Nội dung |
|---|---|
| `provider.py` | `FakeProvider`: chạy chỉ thị, phát sự kiện như provider thật, gọi hook sandbox |
| `directives.py` | phân tích `#fake:*` + khối `<message>` của Orchestrator; H2a: `#fake:args=<json>` (`tool_args`), `is_agree` + `redelegate_message` (tin "Đồng ý" → delegate lại theo tin user trước trong `<history>`) |
| `mcp_call.py` | H2a: `#fake:tool=<key>` gọi `/mcp` Hub thật (`initialize` → `tools/call`, token đọc từ `mcp_config_path`) khi `mcp__hub__<key>` ∈ `payload.mcp.tools`, `#fake:mcp-list`; `CONFIRMATION_REQUIRED` → `Confirm`; không MCP → nghĩa H1 |
| `sessions.py` | session giả (`remember`/`recall`/`lost-session`) trong `<WORK_DIR>/.fake-sessions/` |
| `state.py` | bộ đếm `#fake:badjson=<n>` theo `run_id` (file, ghi nguyên tử) |

Mock MCP cho test: `tests/support/mcp_mock.py` (khoá). Hạn chế đã biết: sau "Đồng ý", Orchestrator giả delegate lại ở **mọi** bước của run (smoke H2a F3, TECH-DEBT).

Chỉ nạp khi `APP_ENV` ∈ {development, test}; production + `fake-cli` → exit 2.
