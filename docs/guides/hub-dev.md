# Runbook · Hub dev + `done:h1` / `done:h2a` (H1, H2a)

| Việc | Lệnh | Ghi chú |
|---|---|---|
| Hạ tầng | `docker compose up -d --wait` | Postgres, Redis, Mailpit |
| Env | `.env.local` có khối Hub (`HUB_*`, `HUB_TEST_DATABASE_URL`, `AGENT_RT_TEST_DATABASE_URL`) | chép từ `.env.example` nếu thiếu |
| Dev Hub | `bun run hub:dev` | migrate DB `ai_system` → admin-api `:3001` (dùng lại nếu đang chạy) → user fixture `lan/hoa/an/khoa` (mật khẩu `dev-password-1`, `khoa` bị khoá) qua platform_admin → `hub:seed` → hub-api `:4000` → agent-runtime `fake-cli` (Windows: container `ai-hub-dev-runtime`; Linux/WSL2: `uv` thẳng). Ctrl+C dừng phần script đã bật. In ra `CHAT_CONTRACT_USERS` |
| Mock Dify (H2a) | `bun run hub:dify-mock` | mock Dify streaming (`tools/hub-dev/src/dify-mock.ts`, cổng `PORT`, mặc định 5001); kịch bản chọn theo app-key (`mk-ok`, `mk-401`, `mk-503x<n>`, `mk-slow-<ms>`, `mk-agent`…); `GET /__mock/requests` xem lời gọi |
| Xong mốc H2a | `bun run done:h2a` | `test-plan H2a §7.1` (14 bước: typecheck, unit, int H1+H2a+Admin, contracts, Python, stack H1/H2a, contract chat, lock/trace/size/depcruise). DB TS (`TEST_DATABASE_URL`) và DB Hub/Runtime (`HUB_TEST_DATABASE_URL` = `AGENT_RT_TEST_DATABASE_URL`) phải **khác nhau**; chỉ export 4 biến DB từ `.env.test-<tag>.local` (không `source` cả file — PEM nhiều dòng hỏng) |
| Stack H2a | `bun run test:h2a:stack` | S01–S03: hub-api trên host + Runtime container + mock Dify; Hub gọi mock qua `localhost`, Runtime qua `host.docker.internal` |
| Xong mốc H1 | `bun run done:h1` | chạy đúng `test-plan H1 §7.1`; bước contract chat tự bật `hub:dev` nếu `:4000`/`:3001` chưa chạy. `--from=N` chạy lại từ bước N (không tính là xong đủ) |

- Python chạy qua `apps/agent-runtime/scripts/run.ts`; URL DB test nằm trong chuỗi lệnh (host `postgres:5432` trong container). Python và TS dùng chung `ai_system_h1_test` → không chạy song song `done:h1` với `test:int` khác.
- Bước "chỉ báo cáo" (`tsc -p tsconfig.tests.json`, `bun run depcruise --all`) không làm đỏ kết quả; đỏ do code Chat/Admin dở → ghi "combine".
- admin-api không lên được hoặc đăng nhập platform_admin lỗi (`SEED_ADMIN_PASSWORD`) → `hub:dev` ghi chú và bỏ fixture, không chặn.

## Env H2a

| Biến | Bên | Ghi chú |
|---|---|---|
| `SECRET_MASTER_KEY` | hub-api (chung admin-api) | giải mã app-key Dify trong `admin.secrets`; vắng → mọi lời gọi Dify `NOT_CONFIGURED` |
| `HUB_INTERNAL_TOKEN` | hub-api (chung admin-api, M5) | ≥ 32 ký tự, tự sinh, không commit; vắng → `POST /internal/test-run` 503 |
| `HUB_PUBLIC_INTERNAL_URL` | hub-api | URL Hub mà Runtime/CLI gọi được (`<url>/mcp`). Trống: dev/test → `http://localhost:4000`; production → MCP tắt + cảnh báo |
| `HUB_DIFY_TIMEOUT_MAX_S` | hub-api | trần hạn một lời gọi Dify (mặc định 300) |
| `AGENT_RT_HUB_URL` | Runtime | URL Hub cho credential `workflow.async`; **bắt buộc** khi `AGENT_RT_PROVIDERS` có `dify` |
| `AGENT_RT_DIFY_BACKOFF_S` · `AGENT_RT_DIFY_READ_TIMEOUT_S` · `AGENT_RT_DIFY_STOP_TIMEOUT_S` | Runtime | backoff giữa các lần thử (mặc định `2,8`), timeout đọc (30), timeout stop (2) |
| `AGENT_RT_HEARTBEAT_S` · `AGENT_RT_ORPHAN_S` | Runtime | ràng buộc: `HEARTBEAT_S` < 30 và `ORPHAN_S` ≥ 2 × `HEARTBEAT_S` (mặc định 10/60); sai → Runtime thoát lúc khởi động. Test rút ngắn: 1/5 |

### WSL NAT (smoke H2a F2)
Runbook giả định WSL **mirrored** (`localhost` của WSL = Windows). Máy chạy **NAT** (không có `.wslconfig` `networkingMode=mirrored`): `localhost:5432/6379` vẫn tới được nhờ Docker Desktop, nhưng `localhost:<cổng hub-api trên Windows>` bị từ chối. Khi đó:
- lấy IP Windows nhìn từ WSL: `ip route | awk '/default/ {print $3}'` (vd `172.26.0.1`; đổi sau mỗi lần khởi động WSL);
- đặt **cả hai** `HUB_PUBLIC_INTERNAL_URL=http://<ip>:<cổng>` (hub-api, để `mcp.url` đúng) và `AGENT_RT_HUB_URL=http://<ip>:<cổng>` (Runtime);
- hoặc bật mirrored: `%UserProfile%\.wslconfig` → `[wsl2]` `networkingMode=mirrored`, rồi `wsl --shutdown`.

### Smoke Dify thật (`DIFY_LIVE=1`, I2)
Không có script tự động trong repo; quy trình và kết quả lần đầu: `docs/specs/H2a-dify-command/smoke.md`. Nguyên tắc:
- app-key Dify **không chép vào repo** hay `.env.local`: đặt `DIFY_LIVE_ENV_FILE=<đường dẫn file .env có key>` (cấu hình chỉ định ở `spec-decisions.md` "Gate duyệt"), script tạm (scratchpad) đọc key lúc chạy và nhập vào `admin.secrets` (mã hoá bằng `SECRET_MASTER_KEY`) của DB smoke riêng;
- dùng DB riêng (vd `ai_system_h2a_smoke_test`) + Redis DB riêng, xoá sau khi chạy; chỉ gọi app không có tác dụng phụ;
- cuối smoke quét lộ key (thô/base64/base64url/hex) trong log hub-api, log Runtime và dump DB.

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
