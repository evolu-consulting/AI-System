# Hướng dẫn deploy đầy đủ — AI System (staging / production)

> Nguồn gốc: `.env.production.example` (header 6 bước) + `docs/PRODUCTION-NOTES.md` + `apps/agent-runtime/deploy/`.
> File này gom lại thành một runbook chạy từ máy sạch tới khi 3 web lên HTTPS và agent chạy thật.
> Mọi giá trị `<...>` là chỗ giữ — thay bằng của bạn, **không commit** file env đã điền.

---

## 0. Kiến trúc cần dựng

| Thành phần | Loại | Chạy bằng | Cổng mặc định |
|---|---|---|---|
| **admin-api** | tiến trình Bun | `bun --env-file=<env> apps/admin-api/src/server.ts` | `:3001` |
| **hub-api** | tiến trình Bun (phục vụ luôn Studio ở `/studio`) | `bun --env-file=<env> apps/hub-api/src/server.ts` | `:4000` |
| **agent-runtime** | tiến trình Python (systemd) | `apps/agent-runtime/deploy/ai-worker.service` | — |
| **admin-web** | build tĩnh | `apps/admin-web/dist` (reverse proxy phục vụ) | — |
| **chat-web** | build tĩnh | `apps/chat-web/dist` | — |
| **studio-web** | build tĩnh | `apps/studio-web/dist` (Hub mount ở `/studio`) | — |
| **Postgres 16** | stateful | docker compose / managed | `:5432` |
| **Redis 7** | stateful | docker compose / managed | `:6379` |
| **Reverse proxy + TLS** | nginx/Caddy | bắt buộc HTTPS | `:443` |

Ví dụ 3 tên miền: `admin.example.com`, `chat.example.com`, `hub.example.com` (Studio ở `https://hub.example.com/studio/`).

---

## 1. Chuẩn bị máy chủ (prereqs)

Máy Linux x64 (Ubuntu). Cài:

- **git**
- **Bun 1.3.14** (khớp `packageManager` trong `package.json`): `curl -fsSL https://bun.sh/install | bash`
- **uv** (quản lý Python cho agent-runtime), Python **≥ 3.12**: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- **Docker + compose plugin** (hoặc Podman) — cho Postgres/Redis và sandbox autofix
- **nginx** hoặc **Caddy** (reverse proxy + TLS), **openssl**, **psql client**
- **Claude CLI** trên máy chạy agent-runtime (xem §9): `curl -fsSL https://claude.ai/install.sh | bash`

> **Không cần Node** riêng — Bun chạy cả admin-api/hub-api và build web. Playwright chỉ cho test, không cần ở production.

---

## 2. Lấy mã nguồn

```bash
# cần quyền đọc repo (deploy key / tài khoản có quyền)
git clone git@github.com:evolu-consulting/AI-System.git /srv/ai-system
cd /srv/ai-system
git checkout <tag-hoặc-commit-đã-kiểm>      # ghim bản đã qua Gate, đừng deploy HEAD tuỳ hứng
bun install --frozen-lockfile
```

---

## 3. Postgres 16 + Redis 7

**Cách nhanh (cùng máy):** dùng `compose.yaml` của repo — nhưng nó là cấu hình **dev** (bind `127.0.0.1`, mật khẩu cố định `ai_dev_pw`, và init tạo thêm DB test). Cho production:

- Đổi `POSTGRES_PASSWORD` sang mật khẩu mạnh (sửa `compose.yaml` hoặc tách file compose riêng).
- Giữ bind `127.0.0.1` nếu DB cùng máy với api (khuyến nghị). Nếu khác máy: bind nội bộ + tường lửa, **không** mở ra internet.
- `docker compose up -d --wait`

**Cách chuẩn hơn:** Postgres/Redis managed hoặc compose riêng với volume sao lưu. Postgres phải là **16**, Redis **7** (`appendonly yes`).

Role owner của Postgres cần quyền **CREATEROLE** (migration tạo 3 role ứng dụng).

---

## 4. Sinh khoá & secret (một lần, sao lưu NGOÀI repo)

```bash
# JWT EdDSA (Ed25519) — admin-api ký (cần cả 2), hub-api chỉ verify bằng PUBLIC key
openssl genpkey -algorithm ed25519 -out jwt.pem
openssl pkey -in jwt.pem -pubout -out jwt.pub
# Chuyển mỗi PEM thành MỘT dòng, xuống dòng viết literal \n, bọc trong "..." khi dán vào env.
# (Hoặc dev: `bun run keys:dev` sinh sẵn cặp Ed25519 + kid.)

openssl rand -base64 32     # SECRET_MASTER_KEY  (chung admin-api + hub-api)
openssl rand -base64 32     # HUB_SECRETS_KEY    (CHỈ hub-api, PHẢI KHÁC SECRET_MASTER_KEY)
openssl rand -base64 36     # HUB_INTERNAL_TOKEN (chung admin-api + hub-api, ≥ 32 ký tự)
```

> ⚠️ **Mất khoá = mất secret.** `SECRET_MASTER_KEY` mã hoá 2FA + secret Admin; `HUB_SECRETS_KEY` mã hoá provider key / source credential / khoá KnowledgeHub. Chưa có cơ chế xoay khoá — sao lưu vào secret manager, không đặt trong DB, không commit.

---

## 5. File env

Chép mẫu, điền giá trị, quyền 600:

```bash
cp .env.production.example /etc/ai-system.env
chmod 600 /etc/ai-system.env
# điền: DATABASE_URL (owner), *_DATABASE_URL (3 role), REDIS_URL, JWT_*, SECRET_MASTER_KEY,
#       HUB_SECRETS_KEY, HUB_INTERNAL_TOKEN, CORS/URL, SMTP, HUB_ATTACH_DIR, PUBLIC_* (cho build)…
```

> **Giới hạn đăng nhập (L1, TECH-DEBT #224):** admin-api **không khởi động** ở `APP_ENV=production` nếu thiếu `REDIS_URL` (bộ đếm khoá tài khoản / trần IP). Redis chết ⇒ đăng nhập trả 503 `AUTH_UNAVAILABLE` (đóng an toàn) tới khi Redis lên lại. Đặt `TRUST_PROXY_HOPS=1` khi admin-api chạy sau reverse proxy §10 (Caddy/nginx nối `X-Forwarded-For`); để `0` sau proxy thì mọi người dùng chung một xô IP (30 lượt / 10 phút cho cả hệ thống). Tuỳ chọn `LOGIN_HASH_CONCURRENCY` (mặc định số lõi).

> **Quan trọng:** PEM một dòng chỉ được **dotenv của Bun** mở chuỗi `\n`. Vì vậy 2 service Bun phải nạp env bằng `bun --env-file=/etc/ai-system.env`, **đừng** nạp bằng `EnvironmentFile=` của systemd. (agent-runtime thì ngược lại — xem §9.)

---

## 6. Migrate DB + đặt mật khẩu role + seed

```bash
# 6.1 Migrate bằng role OWNER (production KHÔNG áp migration dev)
APP_ENV=production bun --env-file=/etc/ai-system.env packages/db/src/migrate.ts

# 6.2 Đặt mật khẩu cho 3 role ứng dụng (một lần, psql bằng owner) — khớp *_DATABASE_URL ở env
psql "$DATABASE_URL" -c "ALTER ROLE admin_api     WITH LOGIN PASSWORD '<mk-admin-api>';" \
                     -c "ALTER ROLE hub_api       WITH LOGIN PASSWORD '<mk-hub-api>';" \
                     -c "ALTER ROLE agent_runtime WITH LOGIN PASSWORD '<mk-agent-runtime>';"

# 6.3 Seed admin đầu tiên (đọc SEED_ADMIN_* trong env) — đổi mật khẩu ngay sau lần đăng nhập đầu
bun --env-file=/etc/ai-system.env packages/db/src/seed.ts

# 6.4 (Tuỳ chọn) seed cấu hình Hub (provider/profile mặc định)
bun --env-file=/etc/ai-system.env apps/hub-api/src/modules/seed/seed.ts
```

> 3 role ứng dụng là **NOBYPASSRLS** (cách ly tenant bằng RLS) — không bao giờ cho service chạy bằng role owner.
> Bảng lớn: vài migration có index nên tạo `CREATE INDEX CONCURRENTLY` thủ công trước (xem PRODUCTION-NOTES các mục H3a/H3b/H4a).

---

## 7. Build 3 web tĩnh

Biến `PUBLIC_*` **nhúng vào bundle lúc build** — đổi URL phải build lại.

```bash
# nạp các PUBLIC_* từ env rồi build (turbo xuất ra apps/*/dist)
set -a; . /etc/ai-system.env; set +a
bun run build
```

- `PUBLIC_HUB_URL`, `PUBLIC_STUDIO_URL`, `PUBLIC_CHAT_APP_URL` (admin-web)
- `PUBLIC_ADMIN_WEB_URL`, `PUBLIC_CHAT_WEB_URL`, `PUBLIC_AUTH_URL` (studio-web)
- **chat-web không có biến build** — mọi API đi đường dẫn tương đối, reverse proxy lo.

Kết quả: `apps/admin-web/dist`, `apps/chat-web/dist`, `apps/studio-web/dist`. Đặt `HUB_STUDIO_DIST` = đường tuyệt đối tới `apps/studio-web/dist`.

---

## 8. Chạy 2 service Bun (admin-api, hub-api)

systemd unit gọi thẳng Bun với `--env-file` (vì PEM, §5). Ví dụ `/etc/systemd/system/ai-admin-api.service`:

```ini
[Unit]
Description=AI System admin-api
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
User=aisys
WorkingDirectory=/srv/ai-system
ExecStart=/home/aisys/.bun/bin/bun --env-file=/etc/ai-system.env apps/admin-api/src/server.ts
Restart=always
RestartSec=2
Environment=APP_ENV=production

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/ai-hub-api.service` giống vậy, đổi `ExecStart` sang `apps/hub-api/src/server.ts`.

**Env production bắt buộc của hub-api** (ngoài những biến trong mẫu):
- `HUB_PROCESS_ENGINE=on` — thiếu ⇒ `/process-defs` 404 (engine quy trình tắt).
- Vòng nền process (`sweepOnce`) tự bật khi `processLoops` bật (mặc định prod) — thiếu ⇒ stage "Áp" không mở PR, run kẹt `running`.
- `HUB_PUBLIC_INTERNAL_URL` — URL Hub mà agent-runtime gọi (MCP + tải đính kèm); vắng ⇒ agent không có MCP.
- `HUB_INTERNAL_TOKEN` — vắng ⇒ `/internal/test-run` trả 503.
- **Autofix mở PR GitHub (P-c2):** đặt **cả hai** `HUB_GITHUB_API_URL=https://api.github.com` và biến endpoint còn lại (`githubEndpointOf` cần cả hai) vào env tiến trình Hub; vắng ⇒ stage Áp không mở được PR (`provider_error`), không cảnh báo lúc khởi động.

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now ai-admin-api ai-hub-api
```

---

## 9. agent-runtime (worker Python)

```bash
# 9.1 venv
cd /srv/ai-system/apps/agent-runtime && uv sync --frozen        # tạo .venv cho ExecStart

# 9.2 Claude CLI đăng nhập — DÙNG TÀI KHOẢN RIÊNG, config dir riêng để không đụng tiến trình khác
export CLAUDE_CONFIG_DIR=/home/aisys/.ai-system-claude-home
~/.local/bin/claude          # login OAuth một lần (user tự mở link; không dán token vào chat)

# 9.3 env riêng cho worker (CHỈ biến AGENT_RT_*, APP_ENV, REDIS_URL, LOG_LEVEL)
sudo install -m 0600 -o root apps/agent-runtime/deploy/ai-worker.env.example /etc/ai-worker.env
sudo nano /etc/ai-worker.env
#   AGENT_RT_DATABASE_URL (role agent_runtime), REDIS_URL, AGENT_RT_HUB_URL,
#   AGENT_RT_WORK_DIR / AGENT_RT_LOG_DIR (tuyệt đối, KHÔNG dưới /mnt),
#   AGENT_RT_CLI_PATH=/home/aisys/.local/bin/claude  (systemd không có ~/.local/bin trong PATH),
#   AGENT_RT_PROVIDERS=claude-sub[,dify]

# 9.4 service
sudo cp apps/agent-runtime/deploy/ai-worker.service /etc/systemd/system/
#   sửa User=, WorkingDirectory=, và thêm Environment=CLAUDE_CONFIG_DIR=... vào unit
sudo systemctl daemon-reload && sudo systemctl enable --now ai-worker
journalctl -u ai-worker -n 100 --no-pager
```

**Nếu bật sandbox tự-sửa (autofix P-c):**
- Dựng ảnh: `bun run sandbox:image` (ảnh `ai-autofix-sandbox:0.1.0`, ~474 MB).
- Đặt `RUNTIME_SANDBOX=on` (+ `RUNTIME_SANDBOX_*`). CPU phải có **AVX2** (máy ảo cũ ⇒ bun crash).
- Podman rootless/WSL2: bật `systemd=true` + **delegate cgroup** `cpu memory pids`, chạy uid 1000 `--userns keep-id`.
- ⚠️ **Tường lửa host bắt buộc:** mạng pha cài `install_cmd` vẫn tới được RFC1918 + `169.254.169.254` (metadata cloud) + host — phải chặn các dải đó từ mạng prep.

---

## 10. Reverse proxy + HTTPS (bắt buộc)

3 vhost. Bản đồ route (theo `.env.production.example`):

| Host | Phục vụ tĩnh | Reverse proxy |
|---|---|---|
| `admin.example.com` | `apps/admin-web/dist` | `/auth`, `/admin` → `admin-api:3001` |
| `chat.example.com` | `apps/chat-web/dist` | `/auth` → `admin-api:3001`; `/conversations /runs /agents /commands /attachments /rooms /directory /me /health` → `hub-api:4000` (GET `text/html` của `/rooms /directory /me` trả `index.html` — route SPA) |
| `hub.example.com` | (Hub tự phục vụ `/studio` từ `HUB_STUDIO_DIST`) | `/auth` → `admin-api:3001`; còn lại → `hub-api:4000` |
| `contracts.example.com` (Sổ Hợp Tác, `apps/contracts-web/dist`) | `apps/contracts-web/dist` | `/auth`, **`/admin`** → `admin-api:3001`; `/pack /notifications /conversations /runs` → `hub-api:4000` |

**contracts-web (M1D):** màn Cài đặt › Thành viên & phòng ban gọi `/admin/org*` và `/admin/groups*` (admin-api) cùng origin — thiếu rule `/admin` thì màn báo "chỉ chủ sở hữu" vì 404. Bảng route phải khớp `proxy` trong `apps/contracts-web/rsbuild.config.ts` (test `apps/contracts-web/scripts/deploy-proxy.test.ts` kiểm cả hai):

```nginx
server {
  listen 443 ssl;
  server_name contracts.example.com;
  root /srv/ai-system/apps/contracts-web/dist;

  location ^~ /auth/ { proxy_pass http://127.0.0.1:3001; }
  location ^~ /admin/ { proxy_pass http://127.0.0.1:3001; }
  location ~ ^/(pack|notifications|conversations|runs)/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;              # SSE (trợ lý): giữ kết nối
    proxy_set_header Connection "";
    proxy_buffering off;
  }
  location / { try_files $uri /index.html; }   # SPA fallback
}
```

Ví dụ nginx cho `chat.example.com` (mẫu, chỉnh theo hạ tầng của bạn):

```nginx
server {
  listen 443 ssl;
  server_name chat.example.com;
  # ssl_certificate ...;  (Caddy/Certbot tự lo)
  root /srv/ai-system/apps/chat-web/dist;

  location /auth/ { proxy_pass http://127.0.0.1:3001; }
  location ~ ^/(conversations|runs|agents|commands|attachments|rooms|directory|me|health) {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;              # SSE: giữ kết nối
    proxy_set_header Connection "";
    proxy_buffering off;
  }
  location / { try_files $uri /index.html; }   # SPA fallback
}
```

- TLS bắt buộc: `/internal/*` và `/mcp` nhận Bearer bản rõ ⇒ Hub↔Runtime↔Admin khác máy phải TLS hoặc mạng nội bộ.
- `CORS_ORIGINS` / `HUB_CORS_ORIGINS` phải gồm đúng 3 origin (scheme+host, không `/` cuối).

---

## 11. Kiểm tra sau deploy (smoke)

```bash
curl -s https://admin.example.com/auth/health          # admin-api sống
curl -s https://chat.example.com/health                # hub-api sống qua proxy
curl -sI https://hub.example.com/studio/ | head -1      # Studio mount (200)
journalctl -u ai-worker -n 30 --no-pager | grep -i "watching\|logged"   # worker nối Hub
```

Rồi kiểm tay: đăng nhập admin (đổi mật khẩu seed), tạo tenant/user, mở Chat, chạy một agent (claude-sub) để xác nhận subscription Claude của worker hoạt động.

---

## 12. Bẫy vận hành (đọc kỹ `docs/PRODUCTION-NOTES.md`)

- **Không quét virus** đính kèm — cần ClamAV/dịch vụ trước khi agent/người khác đọc. `HUB_ATTACH_DIR` là **dữ liệu khách**: sao lưu cùng DB `hub`.
- **SMTP thật** bắt buộc (`SMTP_URL`) cho mail quota/đặt lại mật khẩu; vắng ⇒ tắt gửi mail (chỉ cảnh báo).
- **Audit log** append-only (admin + hub) — lập kế hoạch lưu trữ/dọn.
- **KnowledgeHub (nếu dùng):** không có TLS trong app ⇒ sau reverse proxy TLS; bật OIDC; dùng embedder đa ngữ `bge-m3` cho tiếng Việt.
- **Dify (nếu dùng):** đặt sau TLS/mạng nội bộ (app-key đi bản rõ).

---

## Phụ lục A — deploy lên host EvoBuzz (`149.202.83.5`)

Host này **đang chạy stack EvoBuzz** (docker project `evolu-buzz`, ports 18080/18550) + **bridge `evobuzz-bridge`** (systemd user, dùng chung `~/.claude`). Nếu dựng AI System chung máy:

1. **Cổng không đụng nhau:** 3001/4000/5432/6379 hiện trống nhưng xác nhận trước; đổi nếu cần.
2. **Tài khoản Claude:** worker ai-system **phải** login **tài khoản riêng** với `CLAUDE_CONFIG_DIR` riêng (vd `~/.ai-system-claude-home`). **Tuyệt đối không** `claude logout` (bridge dùng chung `~/.claude`).
3. **User chạy:** tránh dùng chung thư mục của bridge (`~/scrubb-poc`, `~/evobuzz-bridge`); clone AI System vào thư mục riêng.
4. **Docker:** đã có sẵn; dùng project name riêng cho Postgres/Redis (đừng trùng `evolu-buzz`).
5. SSH/khoá: xem `D:\AI\host dư an\EvoBuzz-host-ssh-deploy-claude-cli.md`.

---

## Phụ lục B — thứ tự tóm tắt

```
1. prereqs (git, bun, uv, docker, proxy, claude cli)
2. git clone + bun install --frozen-lockfile
3. Postgres 16 + Redis 7 (mật khẩu thật)
4. sinh JWT + 3 khoá base64 (sao lưu ngoài repo)
5. /etc/ai-system.env (600)
6. migrate(owner) → ALTER ROLE 3 mật khẩu → seed admin [→ hub:seed]
7. PUBLIC_* + bun run build  (3 dist)
8. systemd: ai-admin-api, ai-hub-api  (+ HUB_PROCESS_ENGINE, HUB_GITHUB_*, HUB_PUBLIC_INTERNAL_URL…)
9. agent-runtime: uv sync → claude login (config dir riêng) → /etc/ai-worker.env → ai-worker.service
10. reverse proxy 3 vhost + TLS
11. smoke + kiểm tay
```
