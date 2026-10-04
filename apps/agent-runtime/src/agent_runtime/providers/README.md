# providers/ — provider chạy trong job host (plan-runtime §3)

| File/thư mục | Nội dung |
|---|---|
| `base.py` | interface `Provider`, `ProviderJob`, sự kiện (`Progress`/`ToolUse`/`Session`/`RateLimit`/`UsageEv`/`Final`/`Fatal`) |
| `keys.py` | khoá provider + môi trường được phép (`is_available`) — nhẹ, process cha dùng lọc `AGENT_RT_PROVIDERS` |
| `registry.py` | `get_provider(key, APP_ENV)` trong job host (`fake-cli` chỉ development/test) |
| `context.py` | khối "Ngữ cảnh trước" từ `history` khi không resume (§6) |
| `claude/` | `claude-sub` qua Claude Agent SDK |
| `fake/` | `fake-cli` cho test/dev |

Không import `config`/`db`/`events`: process con không cầm secret (WRK-BR-02).
