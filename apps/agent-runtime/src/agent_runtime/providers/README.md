# providers/ — provider chạy trong job host (plan-runtime §3)

| File/thư mục | Nội dung |
|---|---|
| `base.py` | interface `Provider`, `ProviderJob` (H2a: `mcp_config_path`), sự kiện (`Progress`/`ToolUse`/`Session`/`RateLimit`/`UsageEv`/`Final`/`Fatal`/`Confirm`; H2b `Delta`, `Final.stop_reason`), `parse_confirmation` (kết quả tool MCP `CONFIRMATION_REQUIRED`, HUB-FR-95) |
| `keys.py` | khoá provider + môi trường được phép (`is_available`) — nhẹ, process cha dùng lọc `AGENT_RT_PROVIDERS` |
| `registry.py` | `get_provider(key, APP_ENV)` trong job host (`fake-cli` chỉ development/test) |
| `context.py` | khối "Ngữ cảnh trước" từ `history` khi không resume (§6) |
| `stream_scan.py` | H2b (WRK-FR-03): `StreamScanner` thuần — đọc JSON kết quả tăng dần, phát chữ khoá `text` cấp 1 khi vai cho phép (Orchestrator `decision=answer`, agent `status ∈ {done, partial}`); dùng chung `claude` và `fake` |
| `patterns.py` | H2b: mẫu chữ RATE/AUTH một nguồn (thuần, không SDK) cho `claude/mapping.py` và cha `runtimes/cli/refusal.py` (F4) |
| `claude/` | `claude-sub` qua Claude Agent SDK; MCP Hub (`claude/mcp.py`, file cấu hình 0600 ngoài `work/<job_id>/`, `mcp__hub__*`) |
| `fake/` | `fake-cli` cho test/dev (gọi `/mcp` thật khi job có MCP) |

Không import `config`/`db`/`events`: process con không cầm secret (WRK-BR-02).
