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
