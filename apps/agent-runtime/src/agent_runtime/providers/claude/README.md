# providers/claude — provider `claude-sub` (PY-08)

Chạy Claude Code qua **Claude Agent SDK Python** (`claude-agent-sdk==0.2.163`, ADR-0008) trong job host
(`runtimes/cli/child.py`). Spec: `plan-runtime §3, §4, §13`. FR: WRK-FR-10, 11, 14, 15; WRK-BR-07.

| File | Việc |
|---|---|
| `options.py` | `build_options(job)` → `ClaudeAgentOptions` (§3.1): `cwd`, `tools`=`allowed_tools`, `disallowed_tools` (agent: `KNOWN_TOOLS` CLI 2.1.286 ngoài `tools`; Orchestrator: `["*"]`), `permission_mode="dontAsk"`, hook `PreToolUse` = `make_path_guard` (timeout 10 s, cho `StructuredOutput` khi agent), `setting_sources=[]`, `strict_mcp_config`, `resume`, `max_turns` (agent ≥ 2), `model`, `env` (`ENABLE_CLAUDEAI_MCP_SERVERS=false`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; Orchestrator thêm `SKIP_PROMPT_HISTORY`), `system_prompt` qua `neutralize_mentions`, `output_format` |
| `mapping.py` | message SDK → `ProviderEvent` (§3.2), nhận diện rate limit / logged_out (§3.3), lỗi SDK → `fatal` |
| `provider.py` | `ClaudeProvider.run` — một lượt `ClaudeSDKClient` (`query(neutralize_mentions(prompt))` + `receive_response`); model `usage` = `init.data["model"]`, không có thì khoá `costUSD` lớn nhất của `model_usage` |

Sự kiện: `session` (init, Result) · `tool_use` + `progress` nhãn tĩnh (không đường dẫn) · `rate_limit{status:"rejected", resets_at}` hoặc `{status:"logged_out"}` cho PY-12 · `usage` · `final` (`structured` cho `agent_result`, `text` cho Orchestrator).

Lỗi: `CLINotFoundError` → `UPSTREAM_ERROR/provider_unavailable`; `ProcessError`/`ResultError` khớp quota → `rate_limit` + `ALL_PROVIDERS_EXHAUSTED/quota`, khớp đăng nhập → `ALL_PROVIDERS_EXHAUSTED/provider_unavailable`, khác → `UPSTREAM_ERROR/crash`; `CLIJSONDecodeError` → `UPSTREAM_ERROR/crash`.

Test: `test_*.py` dùng **SDK giả** (monkeypatch `ClaudeSDKClient`), không gọi CLI thật. Smoke thật: HUB-H1-AC-02 ở I2.

## Đã xác minh bằng Claude thật (spike PY-02 + I2, `spikes/i2_verify.py`)
Hook gọi với cả `ClaudeSDKClient`/`query()`; `setting_sources=[]`; session id + resume khác `cwd`; chữ chưa đăng nhập / mất session; CLI đóng gói dùng `~/.claude` (không cần `AGENT_RT_CLI_PATH`); `SKIP_PROMPT_HISTORY`; `@đường/dẫn` không còn bị CLI tự đọc (S1); `StructuredOutput` qua hook (S2); không MCP claude.ai (S3); Orchestrator không tool (S4). **Chưa đo:** chữ hết quota thật + giờ reset trong text (chưa parse), SIGTERM giữa lượt, tác dụng biến tắt telemetry.
