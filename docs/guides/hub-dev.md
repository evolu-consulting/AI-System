# Runbook · Hub dev + `done:h1` (H1, task I1)

| Việc | Lệnh | Ghi chú |
|---|---|---|
| Hạ tầng | `docker compose up -d --wait` | Postgres, Redis, Mailpit |
| Env | `.env.local` có khối Hub (`HUB_*`, `HUB_TEST_DATABASE_URL`, `AGENT_RT_TEST_DATABASE_URL`) | chép từ `.env.example` nếu thiếu |
| Dev Hub | `bun run hub:dev` | migrate DB `ai_system` → admin-api `:3001` (dùng lại nếu đang chạy) → user fixture `lan/hoa/an/khoa` (mật khẩu `dev-password-1`, `khoa` bị khoá) qua platform_admin → `hub:seed` → hub-api `:4000` → agent-runtime `fake-cli` (Windows: container `ai-hub-dev-runtime`; Linux/WSL2: `uv` thẳng). Ctrl+C dừng phần script đã bật. In ra `CHAT_CONTRACT_USERS` |
| Xong mốc H1 | `bun run done:h1` | chạy đúng `test-plan H1 §7.1`; bước contract chat tự bật `hub:dev` nếu `:4000`/`:3001` chưa chạy. `--from=N` chạy lại từ bước N (không tính là xong đủ) |

- Python chạy qua `apps/agent-runtime/scripts/run.ts`; URL DB test nằm trong chuỗi lệnh (host `postgres:5432` trong container). Python và TS dùng chung `ai_system_h1_test` → không chạy song song `done:h1` với `test:int` khác.
- Bước "chỉ báo cáo" (`tsc -p tsconfig.tests.json`, `bun run depcruise --all`) không làm đỏ kết quả; đỏ do code Chat/Admin dở → ghi "combine".
- admin-api không lên được hoặc đăng nhập platform_admin lỗi (`SEED_ADMIN_PASSWORD`) → `hub:dev` ghi chú và bỏ fixture, không chặn.

## Runtime trong WSL với `claude-sub` (smoke CLI thật, I2)

Cần: WSL Ubuntu, user `worker` đã `claude` login (subscription), venv `~/.venvs/agent-runtime`, `localhost:5432/6379` tới được từ WSL. Kết quả lần chạy đầu: `docs/specs/H1-hub-core/smoke-i2.md`.

| Bước | Lệnh |
|---|---|
| Hub (Windows) | `HUB_DEV_RUNTIME=none HUB_SEED_PROFILE=claude-sub-1 bun run hub:dev` — bỏ bước Runtime; agent seed dùng profile `claude-sub-1` (DB dev `ai_system`) |
| Quyền agent | grant `assistant` chỉ cho group `beta-testers` → thêm user thử (vd `lan`) vào group đó trong tenant `acme` (Admin UI hoặc `POST /admin/groups/<id>/members {"usernames":["lan"]}`), nếu không Orchestrator thấy `<agents>[]` |
| Runtime (WSL) | script dưới, chạy từ Git Bash: `wsl.exe -d Ubuntu -u worker -- bash -l -s < rt.sh` (pipe tránh đổi đường dẫn MSYS; hoặc `MSYS_NO_PATHCONV=1`) |
| Dừng | WSL: `pkill -TERM -f "python -m agent_runtime"`; Windows: Ctrl+C `hub:dev` |

```bash
# rt.sh — work/log dir phải ngoài /mnt (config chặn)
mkdir -p ~/smoke/work ~/smoke/logs && cd /mnt/d/AI/ai-system/apps/agent-runtime
export UV_PROJECT_ENVIRONMENT=$HOME/.venvs/agent-runtime APP_ENV=development AGENT_RT_PROVIDERS=claude-sub   AGENT_RT_DATABASE_URL=postgres://agent_runtime:agent_runtime_dev_pw@localhost:5432/ai_system   REDIS_URL=redis://localhost:6379 AGENT_RT_WORKER_ID=smoke AGENT_RT_WORK_DIR=$HOME/smoke/work AGENT_RT_LOG_DIR=$HOME/smoke/logs
exec uv run --frozen python -m agent_runtime   # chờ log `runtime.ready`
```

- Log job: `~/smoke/logs/<ngày>/<job_id>.events.jsonl` (khung sự kiện, không nội dung) + `.stderr.log`; log Runtime có `job.finished … resumed=`.
- Kiểm process sau huỷ: `ps -eo pgid,pid,stat,cmd | grep _bundled/claude` (không được còn, kể cả `<defunct>`).
- `HUB_LIVE` trong checklist cũ không được code nào đọc — bỏ qua. Mỗi tin ≈ 1 lượt CLI (~10 s); delegate = 2 lượt.
