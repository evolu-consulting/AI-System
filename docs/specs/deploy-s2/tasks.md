---
slice: deploy-s2
lane: đầy đủ (deploy production, bí mật, đăng nhập gói Claude) — người dùng duyệt deploy 2026-10-20
---
# deploy-s2 · AI System + gói contracts lên 149.202.83.5 (project Docker `sohoptac2`)

Kit: `deploy/prod-sohoptac2/` (README = runbook). Bản deploy đầu: `platform/gd0` @ `8d39f821`, 2026-10-20.

| # | Việc | Trạng thái |
|---|---|---|
| 1 | Kit: compose (pg 16.15 + redis 7.4.11 + admin-api + hub-api + agent-runtime + nginx 4 web + tool), Dockerfile, nginx.conf, `env.template` (không giá trị), `gen-env.sh`, `setup.sh`, `deploy.ps1`, `smoke-ai.ts`, `verify-ui.mjs` | xong |
| 2 | Deploy: build 3 image `sohoptac2-*`, migrate production (main +15, hub +43, packs-kit +5, packs +26 = contracts + knowledge), seed platform admin, `hub:seed` profile `claude-sub-1` | xong |
| 3 | Kiểm: /health admin-api + hub-api OK; đăng nhập admin-web, contracts-web (màn "gói chưa bật" — đúng, chưa có tenant), chat-web — ảnh `docs/deploy/sohoptac2/` | xong |
| 4 | ai-sub: `claude auth status` trong hub-api + agent-runtime = loggedIn (claude.ai, max); 1 lời gọi AI client `contracts.extract` + 1 lượt chat thật (Orchestrator) ⇒ 2 dòng `hub.usage_logs` billing `subscription`, cost 0 | xong |

## Quyết định trong lúc làm
- Cổng chỉ `127.0.0.1`: 18431 contracts · 18432 admin · 18433 chat · 18434 Hub/Studio. Không đụng edge-proxy/nginx host/TLS.
- `PUBLIC_*` build theo URL tunnel `http://localhost:1843x`; public bằng tên miền = đổi `.env` + build lại (README).
- Đăng nhập gói: chép MỘT lần `~/.claude/.credentials.json` + `~/.claude.json` vào `./claude-home` (bind 700/600); hub-api
  `AI_SUB_CLAUDE_CONFIG_DIR=/claude-home/.claude`, agent-runtime `HOME=/claude-home` — cùng một file credentials. CLI chép vào
  `./claude-bin/claude` (auto-update của host không gỡ file đang gắn).
- Mật khẩu platform admin chỉ ở `ADMIN_CREDENTIALS.txt` (600); `setup.sh` truyền qua env tiến trình lúc seed, không vào `.env`.
- `HUB_PROCESS_ENGINE`, `*_FROZEN_MODULES` để mặc định (off, CR-095); `HUB_NOTIFY_MODE` mặc định off, SMTP giữ mặc định code, tài
  khoản gửi trống (chờ người dùng). `TRUST_PROXY_HOPS=1` (nginx của project).
- Chat smoke dùng chat-web + Orchestrator của tenant `platform` (không tạo tenant, không bật gói). Trợ lý `mgmt-assistant` trong
  contracts-web kiểm sau khi lát NitiGroup tạo tenant + bật gói.

## Còn lại / lưu ý
- [ ] Public (tên miền + TLS + edge-proxy) — bước riêng; khi đó build lại `PUBLIC_*`, CORS và xem lại `TRUST_PROXY_HOPS`.
- [ ] Tài khoản gửi SMTP (người dùng cung cấp) ⇒ `HUB_NOTIFY_MODE=live` + `HUB_SMTP_USER` + secret `smtp_password`; admin-api `SMTP_URL`.
- [ ] Gói Claude dùng chung với host: probe lúc deploy báo `seven_day` utilization 0.98 (reset 2026-10-21 01:00 UTC).
- [ ] Bản sao đăng nhập tự làm mới token độc lập với `~/.claude` của host; nếu một bên bị đăng xuất do xoay refresh token ⇒
  xoá `claude-home/.claude/.credentials.json` và chạy lại `gen-env.sh` (README).
- [ ] admin-web gọi `/process-defs` (404 vì engine tắt) và thẻ Agent Forge báo "Available once Agent Hub is ready" — không chặn.
- [ ] Sao lưu `.env` (SECRET_MASTER_KEY/HUB_SECRETS_KEY) và volume `sohoptac2_pgdata` — chưa có lịch.
