# providers/fake/ — provider giả `fake-cli` (plan-runtime-fake §7)

| File | Nội dung |
|---|---|
| `provider.py` | `FakeProvider`: chạy chỉ thị, phát sự kiện như provider thật, gọi hook sandbox |
| `directives.py` | phân tích `#fake:*` + khối `<message>` của Orchestrator |
| `sessions.py` | session giả (`remember`/`recall`/`lost-session`) trong `<WORK_DIR>/.fake-sessions/` |
| `state.py` | bộ đếm `#fake:badjson=<n>` theo `run_id` (file, ghi nguyên tử) |

Chỉ nạp khi `APP_ENV` ∈ {development, test}; production + `fake-cli` → exit 2.
