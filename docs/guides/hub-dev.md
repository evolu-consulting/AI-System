# Runbook · Hub dev + `done:h1` / `done:h2a` / `done:h2b` (H1, H2a, H2b)

| Việc | Lệnh | Ghi chú |
|---|---|---|
| Hạ tầng | `docker compose up -d --wait` | Postgres, Redis, Mailpit |
| Env | `.env.local` có khối Hub (`HUB_*`, `HUB_TEST_DATABASE_URL`, `AGENT_RT_TEST_DATABASE_URL`) | chép từ `.env.example` nếu thiếu |
| Dev Hub | `bun run hub:dev` | migrate DB `ai_system` → admin-api `:3001` (dùng lại nếu đang chạy) → user fixture `lan/hoa/an/khoa` (mật khẩu `dev-password-1`, `khoa` bị khoá) qua platform_admin → `hub:seed` → hub-api `:4000` → agent-runtime `fake-cli` (Windows: container `ai-hub-dev-runtime`; Linux/WSL2: `uv` thẳng). Ctrl+C dừng phần script đã bật. In ra `CHAT_CONTRACT_USERS` |
| Mock Dify (H2a) | `bun run hub:dify-mock` | mock Dify streaming (`tools/hub-dev/src/dify-mock.ts`, cổng `PORT`, mặc định 5001); kịch bản chọn theo app-key (`mk-ok`, `mk-401`, `mk-503x<n>`, `mk-slow-<ms>`, `mk-agent`…); `GET /__mock/requests` xem lời gọi |
| Xong mốc H2a | `bun run done:h2a` | `test-plan H2a §7.1` (14 bước: typecheck, unit, int H1+H2a+Admin, contracts, Python, stack H1/H2a, contract chat, lock/trace/size/depcruise). DB TS (`TEST_DATABASE_URL`) và DB Hub/Runtime (`HUB_TEST_DATABASE_URL` = `AGENT_RT_TEST_DATABASE_URL`) phải **khác nhau**; chỉ export 4 biến DB từ `.env.test-<tag>.local` (không `source` cả file — PEM nhiều dòng hỏng) |
| Xong mốc H2b | `bun run done:h2b` | `test-plan H2b §7.1` (16 bước: **mọi bước `done:h2a`** + int/rules H2b, Python P20–P28, `test:h2b:stack`, H01 `H2b/hubdev` cần `hub:dev`, `test:perf H2a H2b` chỉ báo cáo). DB như `done:h2a`; `--from=N` chạy lại từ bước N. Contract chat tích hội thoại trên DB dev → CHAT-AC-19 có thể đỏ sau nhiều lần chạy (TECH-DEBT #55, dọn hội thoại mẫu của `lan`) |
| Stack H2b | `bun run test:h2b:stack` | S01–S08 (`bunfig.stack.toml`, đặt `HUB_MAX_CONCURRENT_RUNS=2` tường minh): stream `fake-cli`, xác nhận với tag, `refused` |
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

## Env H2b

| Biến | Bên | Ghi chú |
|---|---|---|
| `HUB_MAX_CONCURRENT_RUNS` | hub-api | số run `running` tối đa mỗi user (HUB-FR-94), nguyên 1–20; vắng → 2; sai → server thoát lúc khởi động. Vượt → `429 TOO_MANY_RUNS` + `Retry-After: 5` (kiểm sau lỗi Router và `FLOW_BUSY`). `hub:dev` đặt 20 (bộ 41 ca contract chat không đụng 429); `test:h2b:stack` đặt 2 |
| `AGENT_RT_DELTA_FLUSH_MS` · `AGENT_RT_DELTA_FLUSH_CHARS` | Runtime | gom `job.delta` trước khi XADD: xả khi ≥ N ms (10–1000, mặc định 100) hoặc ≥ N ký tự (1–4000, mặc định 200) |
| `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING` | Runtime → CLI (tự đặt) | Runtime luôn đặt `=1` trong env của `claude-sub` (`providers/claude/options.py` `FGTS_ENV`) — **không cấu hình**. Thiếu cờ (do `CLI_QUIET_ENV` tắt GrowthBook) thì agent `StructuredOutput` dồn hết `delta` tới cuối. Biến không công khai: nâng CLI/SDK → chạy lại `apps/agent-runtime/spikes/stream_fgts_spike.py` (`SPIKE_FGTS=0/1`) (TECH-DEBT #53) |

Orchestrator theo tenant: mục `orchestrator_tenants` trong seed yaml (`{tenant_key, agent, max_steps?, …}`, xoá `{tenant_key, remove: true}`; ví dụ chú thích trong `apps/hub-api/seed/agents.yaml`) → `bun run hub:seed`. Chạy int một thư mục: `bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 ./tests/acceptance/H2b` (`bun run test:int <path>` chạy **cả repo**, TECH-DEBT #57).

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
- Mỗi tin ≈ 1 lượt CLI (~10 s); delegate = 2 lượt.

### Smoke stream H2b (`HUB_LIVE=1`, F7)
`HUB_LIVE=1 bun run test:smoke:live` chạy `tests/smoke/h2b-live.test.ts` (SM1–SM3, vắng cờ → bỏ qua, exit 0; không chặn `done:h2b`). Env: `HUB_URL`, `AUTH_URL` (hoặc `SMOKE_TOKEN` = JWT sẵn, bỏ đăng nhập — dùng khi Hub chạy trên DB fixture không có admin-api), `SMOKE_USER`, `DATABASE_URL` (owner, đọc `hub.usage_logs`), `SMOKE_CANCEL_MS` (SM3 huỷ sau N ms nếu chưa có delta, mặc định 12 000 — 8 000 từng huỷ trước lượt model đầu khi CLI khởi động chậm ~6,7 s). Cần Orchestrator + `assistant` dùng profile `claude-sub-1` và Runtime WSL như trên. Quy trình + kết quả lần đầu: `docs/specs/H2b-routing/smoke.md`.

### Smoke file đính kèm H2c (`HUB_LIVE=1`, I2)
`tests/smoke/h2c-live.test.ts` (SM1 PDF 2 trang, SM2 PNG chữ lớn — `@assistant`; SM3 `@writer` bật `Write` ghi `out/report.md` → tin assistant có `attachments`). File mẫu sinh lúc chạy (`tests/smoke/_h2c-samples.ts`, không file nhị phân trong repo). Env như smoke H2b + `SMOKE_WRITE_AGENT` (agent có `runtime_options.allowed_tools` ∋ `Write`, mặc định `writer`); hub-api cần `HUB_ATTACH_DRIVER=local` + `HUB_ATTACH_DIR` (tuyệt đối), Runtime WSL cần `AGENT_RT_HUB_URL` (tải file + gửi `out/`). Chạy riêng từng ca: `bun --env-file=.env.local --config=bunfig.stack.toml test --timeout 300000 tests/smoke/h2c-live.test.ts -t "· SM1 ·"` (mỗi ca 1 job `claude-sub`). Quy trình + kết quả: `docs/specs/H2c-attachments/smoke.md`.

### Giới hạn file phía Dify (`UPLOAD_FILE_SIZE_LIMIT`, H2c K4)
Hub nhận file ≤ 20 MiB (`ATTACH_MAX_BYTES`), nhưng **Dify** tự giới hạn khi Hub gọi `/files/upload` (command/tool có input `file`): mặc định ~**15 MB** tài liệu (`UPLOAD_FILE_SIZE_LIMIT`, MB) và ~**10 MB** ảnh (`UPLOAD_IMAGE_FILE_SIZE_LIMIT`), cộng loại file app cho phép (cấu hình input `file` của app). Đây là biến env của **server Dify** (`docker/.env` của Dify), không phải của Hub. Vượt/sai loại ⇒ Dify trả 413/415 (`file_too_large`/`unsupported_file_type`) ⇒ Hub `UPSTREAM_ERROR` hint "Dify không nhận file này (loại hoặc kích thước)." (H2c-R22). Muốn Dify nhận file tới 20 MiB như Hub: đặt `UPLOAD_FILE_SIZE_LIMIT=20` (và ảnh nếu cần) ở Dify rồi khởi động lại API Dify.
