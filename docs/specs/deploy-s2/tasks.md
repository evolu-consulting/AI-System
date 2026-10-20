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

## FileBox (slice filebox-s2, 2026-10-20)
- FileBox của host (`/home/evoc/filebox`, uvicorn :9100 chỉ loopback; HTTPS công khai `:9443`) chỉ có MỘT Bearer toàn cục (env `FILEBOX_TOKEN`, không có đường cấp key theo app) ⇒ dùng chung key theo ADR-0015 D3/D5; không sửa/khởi động lại FileBox. Tách file theo tenant bằng org `t_<tenant>` (pack contracts).
- Nối: `.env` (600) thêm `FILEBOX_URL=https://149.202.83.5:9443`, `FILEBOX_ORG=ai-system`, `FILEBOX_CA=/etc/s2/filebox.crt`, `FILEBOX_TOKEN` (người dùng tự chép từ `~/.config/filebox/filebox.env`, không in/log), `HUB_ATTACH_DRIVER=filebox`. Dùng URL theo IP vì cert tự ký chỉ có SAN IP 149.202.83.5/127.0.0.1/localhost (không host-gateway). Container tới `:9443` qua IP công khai của host: `/health` 200 (~47 ms) với CA ghim.
- `filebox.crt` (cert công khai) chép từ `/home/evoc/filebox/certs/filebox.crt` vào `~/workspace/sohoptac2/filebox.crt`; compose mount `:ro` vào `hub-api` và `tool` (`deploy/prod-sohoptac2/docker-compose.yml`). Không cần mở cổng/đổi bind.
- Gắn lại 19 file demo: `docker compose run --rm -T tool` + `mgmt-import --into-tenant demo --mgmt-org <id Demo dữ liệu mẫu> --filebox` (dry-run, apply, chạy lại 0 upload) — theo `docs/specs/niti-attach/tasks.md`.
- **Cập nhật (slice filebox-own, 2026-10-20, quyết định người dùng):** sohoptac2 dùng FileBox RIÊNG (service `filebox` + `filebox-minio` trong compose, không cổng host, token/khoá MinIO riêng) thay cho kho chung ở trên; `filebox.crt`/`FILEBOX_CA` bỏ. Link tải đi qua nginx `/_fb/d/` (xem `deploy/prod-sohoptac2/README.md`). Đã kiểm: upload + link ký + tải qua nginx + 403/404 đường lạ trên máy chủ (project tạm), không cổng host.

- [ ] CHƯA LÀM (bị chặn quyền chạy deploy/recreate production trong phiên này): tạo lại `hub-api` (và deploy gd0 HEAD gồm prod-fixes1 qua `deploy/prod-sohoptac2/deploy.ps1`), rồi UAT mục 3 (tải DOCX + AI + "Đọc lại"), `--filebox` mục 4, bổ sung `docs/uat/cr095/report.md` mục "AI thật (sohoptac2)". `.env` và compose trên máy chủ đã sửa sẵn; deploy.ps1 ghi đè compose bằng bản trong repo (đã có mount).