# providers/ — provider chạy trong job host (plan-runtime §3)

| File/thư mục | Nội dung |
|---|---|
| `base.py` | interface `Provider`, `ProviderJob` (H2a: `mcp_config_path`), sự kiện (`Progress`/`ToolUse`/`Session`/`RateLimit`/`UsageEv`/`Final`/`Fatal`/`Confirm`), `parse_confirmation` (kết quả tool MCP `CONFIRMATION_REQUIRED`, HUB-FR-95) |
| `keys.py` | khoá provider + môi trường được phép (`is_available`) — nhẹ, process cha dùng lọc `AGENT_RT_PROVIDERS` |
| `registry.py` | `get_provider(key, APP_ENV)` trong job host (`fake-cli` chỉ development/test) |
| `context.py` | khối "Ngữ cảnh trước" từ `history` khi không resume (§6) |
| `claude/` | `claude-sub` qua Claude Agent SDK; MCP Hub (`claude/mcp.py`, file cấu hình 0600 ngoài `work/<job_id>/`, `mcp__hub__*`) |
| `fake/` | `fake-cli` cho test/dev (gọi `/mcp` thật khi job có MCP) |

Không import `config`/`db`/`events`: process con không cầm secret (WRK-BR-02).
