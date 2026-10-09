# Runbook · Hub dev + `done:h1` / `done:h2a` / `done:h2b` (H1, H2a, H2b)

| Việc | Lệnh | Ghi chú |
|---|---|---|
| Hạ tầng | `docker compose up -d --wait` | Postgres, Redis |
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

**Cảnh báo (từ H3b):** YAML seed production **không chứa `grants:`** — quản grant qua `/agent-grants`. Seed cộng dồn chèn lại grant đã bị thu hồi qua API (`on conflict do nothing`) và không ghi audit; `grants:` chỉ dùng cho dev.

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

### Provider subscription (H3a: probe, `cooldown`, `logged_out`)
Runtime tự probe provider `kind=subscription` (`AGENT_RT_PROBE_S`, mặc định 1 200 s; vòng `logged_out` mỗi `AGENT_RT_PROBE_LOGGED_OUT_S`, mặc định 60 s): (a) `claude auth status` (miễn phí, chỉ đọc file local) rồi (b) một lượt haiku nhỏ khi (a) báo đã đăng nhập.
- **Xem trạng thái:** `select provider_key, status, cooldown_until, consecutive_errors, rate_limit_type, utilization, last_probe_at, last_ok_at, last_error from hub.provider_state;` — `ok`/`busy` khoẻ; `cooldown` chờ tới `cooldown_until` (tin mới bị từ chối ngay, câu lỗi `quota`); `logged_out` (câu lỗi `provider_unavailable`); `error` (3 lỗi liên tiếp). Log Runtime: `probe.result`, `provider.cooldown|logged_out|recovered|quota_warning`.
- **Đăng nhập lại** khi `logged_out`: đăng nhập CLI cho đúng user chạy Runtime (WSL `worker`: `claude` → `/login`, hoặc `claude auth login`) — credential dùng chung `~/.claude`. **Không cần khởi động lại Runtime**: vòng `logged_out` thấy (a) ok ⇒ chạy (b) xác nhận ⇒ `ok` + `provider.recovered` trong ≤ `AGENT_RT_PROBE_LOGGED_OUT_S` + ~15 s.
- **`cooldown`:** tự mở lại khi qua `cooldown_until` (probe ngay lượt kế). Không có lệnh "bỏ cooldown" — giới hạn là của gói Anthropic.
- **Smoke thật (`HUB_LIVE=1`, I2):** `tests/smoke/h3a-live.test.ts` tự dựng DB `ai_system_h3a_smoke_test` + Redis DB 12 (`H3A_REDIS_DB`) + Runtime WSL với `HOME` tạm có symlink `.claude`/`.claude.json` (PL10 — không đụng file credential thật), đổi symlink sang thư mục rỗng ⇒ `logged_out`, trả lại ⇒ `ok`; dọn hết khi xong. 2 lượt haiku. Chạy cả file: `HUB_LIVE=1 bun --env-file=.env.local --config=bunfig.stack.toml test --timeout 300000 tests/smoke/h3a-live.test.ts` (env tuỳ chọn `H3A_WSL_DISTRO`, `H3A_WSL_USER`, `H3A_WSL_REPO`). Kết quả: `docs/specs/H3a-subscription/smoke.md`.

### Giới hạn file phía Dify (`UPLOAD_FILE_SIZE_LIMIT`, H2c K4)
Hub nhận file ≤ 20 MiB (`ATTACH_MAX_BYTES`), nhưng **Dify** tự giới hạn khi Hub gọi `/files/upload` (command/tool có input `file`): mặc định ~**15 MB** tài liệu (`UPLOAD_FILE_SIZE_LIMIT`, MB) và ~**10 MB** ảnh (`UPLOAD_IMAGE_FILE_SIZE_LIMIT`), cộng loại file app cho phép (cấu hình input `file` của app). Đây là biến env của **server Dify** (`docker/.env` của Dify), không phải của Hub. Vượt/sai loại ⇒ Dify trả 413/415 (`file_too_large`/`unsupported_file_type`) ⇒ Hub `UPSTREAM_ERROR` hint "Dify không nhận file này (loại hoặc kích thước)." (H2c-R22). Muốn Dify nhận file tới 20 MiB như Hub: đặt `UPLOAD_FILE_SIZE_LIMIT=20` (và ảnh nếu cần) ở Dify rồi khởi động lại API Dify.

## Admin gọi Hub (H3b, R23)
admin-web (dev `http://localhost:3000`) gọi Hub `:4000` cross-origin cho `/agent-grants*` và `GET /runs/:id/trace`. CORS là danh sách trắng `HUB_CORS_ORIGINS` (`.env.example` đã có `http://localhost:3100,http://localhost:3000`); **mặc định trong `env.ts` chỉ chat-web** — origin admin-web phải khai báo tường minh, không mở ngầm. Đổi env ⇒ khởi động lại hub-api. Production: đặt origin admin-web thật (xem `docs/PRODUCTION-NOTES.md`).
- **Chuẩn bị trước khi curl:** (1) `.env.local` cũ (chép trước R23) chỉ có `HUB_CORS_ORIGINS=http://localhost:3100` ⇒ thêm `,http://localhost:3000` rồi chạy lại `hub:dev` (không thì preflight `:3000` không có ACAO). (2) Đăng nhập cần `tenant_key`: body `{"tenant_key":"acme","username":"lan","password":"dev-password-1"}` (platform_admin: `tenant_key":"platform"`). (3) `hub:dev` chỉ dựng member `lan/hoa/an/khoa`; không có `tenant_admin` mặc định. Tạo bằng platform_admin: `POST :3001/admin/users?tenant_id=<T>` `{"username","display_name","email","role":"tenant_admin","locale":"vi"}` (tenant_admin **bắt buộc `email`**) → đăng nhập bằng `temp_password` ⇒ `password_change_required` ⇒ `POST /auth/change-password {change_token,new_password}`; user có sẵn quên mật khẩu: `POST /admin/users/<id>/reset-password?tenant_id=<T>` rồi đổi như trên. (4) Run mẫu để thử trace nằm ở `hub.runs` (chủ `lan`, acme).
- **Preflight:** `curl -i -X OPTIONS http://localhost:4000/agent-grants -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type"` ⇒ `Access-Control-Allow-Origin: http://localhost:3000`. Origin lạ ⇒ không có header này.
- **JWT dev 3 role:** đăng nhập admin-api `:3001` — `platform_admin` = `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD`; `tenant_admin` và `member` = user fixture của tenant dev (mật khẩu `dev-password-1`, tạo qua UI Admin hoặc `hub:dev`; `lan/hoa/an` là member). `TOKEN=$(curl -s -X POST http://localhost:3001/auth/login -H "Content-Type: application/json" -d '{"username":"<u>","password":"<p>"}' | jq -r .access_token)`. Hub dùng chung `JWT_PUBLIC_KEY` nên nhận token này.
- **Mẫu `curl`** (platform_admin phải thêm `?tenant_id=<uuid>`; tenant_admin tự lấy tenant của mình; member ⇒ 403):
  - Liệt kê: `curl -H "Authorization: Bearer $TOKEN" "http://localhost:4000/agent-grants?tenant_id=$T"`
  - Cấp: `curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"agent_id":"<uuid>","subject_type":"group","subject_id":"<uuid>"}' "http://localhost:4000/agent-grants?tenant_id=$T"` (201 mới, 200 trùng)
  - Thu hồi: `curl -X DELETE -H "Authorization: Bearer $TOKEN" "http://localhost:4000/agent-grants?tenant_id=$T&agent_id=<uuid>&subject_type=group&subject_id=<uuid>"` (204)
  - Effective: `curl -H "Authorization: Bearer $TOKEN" "http://localhost:4000/agent-grants/effective/<user_id>?tenant_id=$T"`
  - Trace: `curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/runs/<run_id>/trace`

## Studio dev (H4a)
Agent Studio = `apps/studio-web` (base `/studio`) + API `/studio/api/*` trên Hub `:4000`. Chỉ `platform_admin` (401 không token → 403 `FORBIDDEN` role khác, trước parse body/query). Không có login riêng: Studio gọi `admin-api POST /auth/login` (token `platform_admin` như mục trên).
- **Dev 2 tiến trình:** `bun run --cwd apps/studio-web dev` (`:3200`) proxy `/auth` → admin-api, `/studio/api` → Hub ⇒ trình duyệt thấy cùng origin. `HUB_CORS_ORIGINS` đã thêm `http://localhost:3200` (`.env.example`) cho trường hợp gọi Hub thẳng; `.env.local` cũ ⇒ tự thêm rồi chạy lại `hub:dev`.
- **Hub phục vụ bản build (như prod):** `bun run --cwd apps/studio-web build` rồi đặt `HUB_STUDIO_DIST=<đường dẫn tuyệt đối>/apps/studio-web/dist` và chạy lại Hub ⇒ `http://localhost:4000/studio/` (`/studio` → 308 `/studio/`; đường dẫn sâu không đuôi → `index.html`; file có đuôi không có → 404 JSON; `/studio/static/*` cache 1 năm). Trống ⇒ `/studio` 404; có mà thiếu `index.html` ⇒ log `studio-dist-missing`, không mount.
- **Env build studio-web** (`.env.example` gốc): `PUBLIC_ADMIN_WEB_URL=http://localhost:3000` (link "⇄ Admin", "Admin › Workflows ↗"; vắng ⇒ ẩn link), `PUBLIC_CHAT_WEB_URL` (nút "Về Chat"; vắng ⇒ ẩn), `PUBLIC_AUTH_URL` (vắng = `/auth` cùng origin). Biến `PUBLIC_*` đọc lúc build ⇒ đổi xong phải build lại.
- **Mẫu `curl`** (`TOKEN` của platform_admin): `curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/studio/api/me` · catalog `GET /studio/api/{agent-types,model-profiles,providers,workflows,tenants}?q=&limit=` (`limit` 1–200, mặc định 200; `workflows` thêm `app_type`). `providers` chỉ trả `has_secret`, không bao giờ `secret_id`/ciphertext/`last_error` (R13).
