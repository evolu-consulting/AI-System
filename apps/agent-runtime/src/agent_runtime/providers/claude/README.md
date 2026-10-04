# providers/claude — provider `claude-sub` (PY-08)

Chạy Claude Code qua **Claude Agent SDK Python** (`claude-agent-sdk==0.2.163`, ADR-0008) trong job host
(`runtimes/cli/child.py`). Spec: `plan-runtime §3, §4, §13`. FR: WRK-FR-10, 11, 14, 15; WRK-BR-07.

| File | Việc |
|---|---|
| `options.py` | `build_options(job)` → `ClaudeAgentOptions` (§3.1): `cwd`, `tools`=`allowed_tools`, `disallowed_tools`, `permission_mode="dontAsk"`, hook `PreToolUse` = `make_path_guard` (timeout 10 s), `setting_sources=[]`, `resume`, `max_turns`, `model`, `env`, `output_format` |
| `mapping.py` | message SDK → `ProviderEvent` (§3.2), nhận diện rate limit / logged_out (§3.3), lỗi SDK → `fatal` |
| `provider.py` | `ClaudeProvider.run` — một lượt `ClaudeSDKClient` (`query` + `receive_response`) |

Sự kiện: `session` (init, Result) · `tool_use` + `progress` nhãn tĩnh (không đường dẫn) · `rate_limit{status:"rejected", resets_at}` hoặc `{status:"logged_out"}` cho PY-12 · `usage` · `final` (`structured` cho `agent_result`, `text` cho Orchestrator).

Lỗi: `CLINotFoundError` → `UPSTREAM_ERROR/provider_unavailable`; `ProcessError`/`ResultError` khớp quota → `rate_limit` + `ALL_PROVIDERS_EXHAUSTED/quota`, khớp đăng nhập → `ALL_PROVIDERS_EXHAUSTED/provider_unavailable`, khác → `UPSTREAM_ERROR/crash`; `CLIJSONDecodeError` → `UPSTREAM_ERROR/crash`.

Test: `test_*.py` dùng **SDK giả** (monkeypatch `ClaudeSDKClient`), không gọi CLI thật. Smoke thật: HUB-H1-AC-02 ở I2.

## Xác minh lại sau W0+PY-02 (I2)
- hook với `ClaudeSDKClient` thực sự gọi `path_guard` (input `tool_input` của Read/Grep/Glob)
- `tools=[]` = không tool; `disallowed_tools` danh sách tên đủ (thay `["*"]`); `setting_sources=[]`
- `SystemMessage(init).data["session_id"]`, `ResultMessage.session_id`, resume khác `cwd`
- chữ lỗi hết quota / chưa đăng nhập (`RATE_RE`, `AUTH_RE`), giờ reset trong text (chưa parse)
- `output_format` schema phẳng + bóc JSON trong `result`
- CLI đóng gói dùng `~/.claude` hay cần `AGENT_RT_CLI_PATH` (`ProviderJob.cli_path`, runner chưa điền)
- `CLAUDE_CODE_SKIP_PROMPT_HISTORY` có tác dụng
