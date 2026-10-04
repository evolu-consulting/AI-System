# spikes — thử nghiệm ngoài package (không vào `src/`, không vào test)

`sdk_spike.py` — PY-02: Claude Agent SDK thật trong WSL2. Kết quả: `docs/specs/H1-hub-core/spike-py02.md`.

```bash
# trong WSL, user worker (đã `claude` login); venv ngoài repo
cd /mnt/d/AI/ai-system/apps/agent-runtime
UV_PROJECT_ENVIRONMENT=$HOME/.venvs/agent-runtime uv sync --frozen
# env sạch giống job host (sandbox/env.py) + setsid để quan sát process group
env -i HOME=$HOME PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 TMPDIR=/tmp \
  setsid -w $HOME/.venvs/agent-runtime/bin/python spikes/sdk_spike.py <ca...>
```

Ca: `tools-list` (HOME rỗng, không tốn API) · `lost-session` (không tốn API) · `client-tools` ·
`query-hook` · `no-tools` · `control-claude-md` · `structured` · `resume` (sau `structured`) · `at-file`.
Không đối số = chạy hết (≈ 7 lượt gọi model). Dữ liệu giả ở `/tmp/spike*`; JSON từng ca ở `/tmp/spike/out/`.

`i2_verify.py` — I2 sau PY-02: chạy **đúng** `build_options`/`neutralize_mentions` của `src/` với Claude
thật. Ca: `prod-at-file` (S1 mọi biến thể `@` + S3/S4/S6/S9, 1 lượt) · `prod-structured` (S2/S7, 1 lượt) ·
`prod-orch` (Orchestrator `["*"]`, HOME rỗng, không tốn API). Cùng cách chạy, thay tên file.

`mcp_spike.py` — PY-S1 (H2a): MCP Hub với CLI thật, server MCP giả stdlib `mcp_fake.py` trong cùng process (không cần
Hub/C2), token truyền bằng file cấu hình 0600 (`mcp_servers=<path>`). Kết quả:
`docs/specs/H2a-dify-command/spike-s1.md`. Cùng cách chạy (`env -i … python spikes/mcp_spike.py <ca...>`).
Ca không tốn API: `init-file` · `init-argv` (đối chứng token trên argv) · `init-discover` · `init-401` ·
`init-down`. Ca tốn 1 lượt mỗi ca: `call` · `confirm` · `timeout` · `call-discover`.
`SPIKE_DEBUG=1` → CLI `--debug mcp` (log ở `~/.claude/debug/`). JSON từng ca ở `/tmp/spike-mcp/out/`.
