# providers/fake/ — provider giả `fake-cli` (plan-runtime-fake §7)

| File | Nội dung |
|---|---|
| `provider.py` | `FakeProvider`: chạy chỉ thị, phát sự kiện như provider thật, gọi hook sandbox |
| `directives.py` | phân tích `#fake:*` + khối `<message>` của Orchestrator; H2a: `#fake:args=<json>` (`tool_args`), `is_agree` + `redelegate_message` (tin "Đồng ý" → delegate lại theo tin user trước trong `<history>`) |
| `mcp_call.py` | H2a: `#fake:tool=<key>` gọi `/mcp` Hub thật (`initialize` → `tools/call`, token đọc từ `mcp_config_path`) khi `mcp__hub__<key>` ∈ `payload.mcp.tools`, `#fake:mcp-list`; `CONFIRMATION_REQUIRED` → `Confirm`; không MCP → nghĩa H1 |
| `stream.py` | H2b (`plan-runtime` §6): `#fake:stream[=n]` (chỉ khi `payload.stream` ∧ không thử lại — JSON cuối cắt `n` đoạn qua `StreamScanner` ⇒ `Delta`, 50 ms/đoạn), `stream-order=text-first`, `stream-diverge`, `stream-badjson`, `answer-len=<n>` |
| `sessions.py` | session giả (`remember`/`recall`/`lost-session`) trong `<WORK_DIR>/.fake-sessions/` |
| `state.py` | bộ đếm `#fake:badjson=<n>` theo `run_id` (file, ghi nguyên tử) |

Mock MCP cho test: `tests/support/mcp_mock.py` (khoá). H2b (PY-04): `#fake:turns=<n>` (với `#fake:usage`: n `UsageEv` cộng dồn trước `sleep`), `#fake:is-error=<rate|auth|refused|error>` (`Final.is_error` chữ cố định, không `RateLimit`, usage `{in:10, out:0}` trừ khi có `#fake:usage`; chỉ `refused`/giá trị lạ kèm `stop_reason="refusal"`, `error` = lỗi provider không tín hiệu — TC-8). "Đồng ý": Orchestrator chỉ delegate lại khi `<steps>` rỗng (TD #47 đã đóng), tin trước `@<key> …` (đúng một tag) ⇒ delegate `<key>`; agent nhận câu đồng ý không chỉ thị ⇒ chạy lại tin user trước trong `payload.history` (bỏ tag đầu).

Chỉ nạp khi `APP_ENV` ∈ {development, test}; production + `fake-cli` → exit 2.
