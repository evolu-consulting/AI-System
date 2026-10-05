# providers/claude — provider `claude-sub` (PY-08)

Chạy Claude Code qua **Claude Agent SDK Python** (`claude-agent-sdk==0.2.163`, ADR-0008) trong job host
(`runtimes/cli/child.py`). Spec: `plan-runtime §3, §4, §13`. FR: WRK-FR-10, 11, 14, 15; WRK-BR-07.

| File | Việc |
|---|---|
| `options.py` | `build_options(job)` → `ClaudeAgentOptions` (§3.1): `cwd`, `tools`=`allowed_tools`, `disallowed_tools` (agent: `KNOWN_TOOLS` CLI 2.1.286 ngoài `tools`; Orchestrator: `["*"]`), `permission_mode="dontAsk"`, hook `PreToolUse` = `make_path_guard` (timeout 10 s, cho `StructuredOutput` khi agent), `setting_sources=[]`, `strict_mcp_config`, `resume`, `max_turns` (agent ≥ 2), `model`, `env` (`ENABLE_CLAUDEAI_MCP_SERVERS=false`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; Orchestrator thêm `SKIP_PROMPT_HISTORY`), `system_prompt` qua `neutralize_mentions`, `output_format`; H2b: `include_partial_messages=True` mọi job, `CLAUDE_ENV` đặt `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING=1` (`FGTS_ENV`, smoke F1 — `CLI_QUIET_ENV` tắt GrowthBook ⇒ không thì input `StructuredOutput` dồn cục cuối; biến không công khai, nâng CLI chạy lại `spikes/stream_fgts_spike.py`, TECH-DEBT #53) |
| `mapping.py` | message SDK → `ProviderEvent` (§3.2), nhận diện rate limit / logged_out (§3.3), lỗi SDK → `fatal` |
| `mcp.py` | MCP Hub cho agent (H2a §4.2): file `AGENT_RT_WORK_DIR/.mcp/<job_id>.json` 0600 (token claim, không qua argv); `.mcp` phải là thư mục thật (`lstat`, không symlink) của uid Runtime, quyền khác 0700 → `chmod 0o700`; lỗi giữa lúc ghi → xoá file dở; `remove_config` sau mỗi lần chạy |
| `partial.py` | H2b (WRK-FR-03/17): `PartialStream` — `StreamEvent` (`include_partial_messages`) → `Delta` (khối `text` của Orchestrator / `tool_use StructuredOutput` của agent, chọn theo `content_block_start`, xong ở `content_block_stop`) + usage cộng dồn F5 + `stop_reason` cuối (F4, TC-8) |
| `usage_acc.py` | H2b F5: `UsageAcc` — usage theo message (`message_start` rồi `message_delta` cùng id: bản sau thay; huỷ = cận dưới) |
| `provider.py` | `ClaudeProvider.run` — một lượt `ClaudeSDKClient` (`query(neutralize_mentions(prompt))` + `receive_response`); model `usage` = `init.data["model"]`, không có thì khoá `costUSD` lớn nhất của `model_usage` |

Sự kiện: `session` (init, Result) · `tool_use` + `progress` nhãn tĩnh (không đường dẫn) · `rate_limit{status:"rejected", resets_at}` hoặc `{status:"logged_out"}` cho PY-12 · `usage` · `final` (`structured` cho `agent_result`, `text` cho Orchestrator).

Lỗi: `CLINotFoundError` → `UPSTREAM_ERROR/provider_unavailable`; `ProcessError`/`ResultError` khớp quota → `rate_limit` + `ALL_PROVIDERS_EXHAUSTED/quota`, khớp đăng nhập → `ALL_PROVIDERS_EXHAUSTED/provider_unavailable`, khác → `UPSTREAM_ERROR/crash`; `CLIJSONDecodeError` → `UPSTREAM_ERROR/crash`.

Test: `test_*.py` dùng **SDK giả** (monkeypatch `ClaudeSDKClient`), không gọi CLI thật. Smoke thật: HUB-H1-AC-02 ở I2.

## Đã xác minh bằng Claude thật (spike PY-02 + I2, `spikes/i2_verify.py`)
Hook gọi với cả `ClaudeSDKClient`/`query()`; `setting_sources=[]`; session id + resume khác `cwd`; chữ chưa đăng nhập / mất session; CLI đóng gói dùng `~/.claude` (không cần `AGENT_RT_CLI_PATH`); `SKIP_PROMPT_HISTORY`; `@đường/dẫn` không còn bị CLI tự đọc (S1); `StructuredOutput` qua hook (S2); không MCP claude.ai (S3); Orchestrator không tool (S4). **Chưa đo:** chữ hết quota thật + giờ reset trong text (chưa parse), SIGTERM giữa lượt, tác dụng biến tắt telemetry.
