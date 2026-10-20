# sohoptac2 — AI System + gói contracts trên 149.202.83.5 (project Docker riêng)

`powershell -File deploy/prod-sohoptac2/deploy.ps1 [-Ref platform/gd0] [-DryRun]` — git archive `<Ref>` + kit này → `evoc@149.202.83.5:~/workspace/sohoptac2`
→ `gen-env.sh` (bí mật một lần) → `docker compose -p sohoptac2 build` → `setup.sh` (migrate, seed, chạy, /health). Chạy lại an toàn.

## Dịch vụ (project `sohoptac2`, mạng riêng, `restart: unless-stopped`)
| Service | Image | Giới hạn | Ghi chú |
|---|---|---|---|
| pg | postgres:16.15-alpine | 2 CPU / 2 GB | volume `sohoptac2_pgdata`, owner `s2_owner` |
| redis | redis:7.4.11-alpine | 0.5 / 512 MB | AOF, volume `sohoptac2_redisdata` |
| admin-api | sohoptac2-app (bun 1.3.14) | 1 / 1 GB | :3001 nội bộ |
| hub-api | sohoptac2-app | 2 / 3 GB | :4000 nội bộ, Studio `/studio`, AI client = gói Claude |
| agent-runtime | sohoptac2-runtime (python 3.12 + uv) | 2 / 3 GB | worker `claude-sub` |
| web | sohoptac2-web (nginx) | 0.5 / 256 MB | 4 web + reverse proxy |
| tool (profile `tools`) | sohoptac2-app | 1 / 1 GB | migrate / seed / smoke |

Cổng (chỉ `127.0.0.1`): **18431** contracts-web · **18432** admin-web · **18433** chat-web · **18434** Hub + Studio (`/studio/`).
Migration: `packages/db/src/migrate.ts` = main + hub + packs-kit + gói `contracts` + `knowledge` (production bỏ `*-dev` và `pkdemo`).

## Mở bằng SSH tunnel (chưa public)
```
ssh -i F:\workspace\id_evoc_key -N -L 18431:127.0.0.1:18431 -L 18432:127.0.0.1:18432 -L 18433:127.0.0.1:18433 -L 18434:127.0.0.1:18434 evoc@149.202.83.5
```
Rồi mở http://localhost:18431 (contracts), :18432 (admin), :18433 (chat), :18434/studio/. URL `PUBLIC_*` đã nhúng lúc build theo
các cổng này; public bằng tên miền ⇒ đổi `S2_PUBLIC_*`, `CORS_ORIGINS`, `HUB_CORS_ORIGINS`, `ADMIN_WEB_URL` trong `.env` rồi build lại
(và `TRUST_PROXY_HOPS` = số proxy thật phía trước admin-api).

## Bí mật (chỉ trên máy chủ, không commit)
- `~/workspace/sohoptac2/.env` (600) — `gen-env.sh` sinh một lần, không ghi đè. Mẫu khoá (không giá trị): `env.template`.
  SAO LƯU: mất `SECRET_MASTER_KEY`/`HUB_SECRETS_KEY` = mất mọi secret đã lưu.
- `~/workspace/sohoptac2/ADMIN_CREDENTIALS.txt` (600) — platform admin (`admin`, tenant `platform`); mật khẩu chỉ ở file này.
- `APP_ENV=production`; không đặt cờ dev/test (`LOGIN_IP_MAX_ATTEMPTS`, `*_FROZEN_MODULES`, `HUB_NOTIFY_MODE=fake`…).
- SMTP: giữ mặc định trong code (`HUB_SMTP_HOST=smtp.gmail.com:587`), `HUB_NOTIFY_MODE` mặc định `off`, tài khoản gửi để trống (chờ người dùng).

## AI qua gói Claude (ai-sub)
- `gen-env.sh` chép MỘT lần `~/.claude/.credentials.json` + `~/.claude.json` của user `evoc` vào `./claude-home` (700/600) và chép
  CLI đang cài vào `./claude-bin/claude`. hub-api: `AI_PROVIDER=subscription`, `AI_SUB_CLI_PATH=/opt/claude/claude`,
  `AI_SUB_CLAUDE_CONFIG_DIR=/claude-home/.claude`; agent-runtime: `HOME=/claude-home`, `AGENT_RT_CLI_PATH=/opt/claude/claude`.
- Kiểm: `docker compose -p sohoptac2 exec hub-api env CLAUDE_CONFIG_DIR=/claude-home/.claude /opt/claude/claude auth status`.
- Bản sao tự làm mới token độc lập với `~/.claude` của host. Hết hạn/đăng xuất ⇒ xoá `claude-home/.claude/.credentials.json`
  rồi chạy lại `gen-env.sh` (chép lại từ host) — không `/login` trong container.
- Smoke: `docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/s2-smoke-ai.ts <tenant-uuid>` (một lời gọi
  `contracts.extract`, in dòng `hub.usage_logs` với `billing`).

## Kiểm sau deploy
- `setup.sh` tự kiểm `/health` của admin-api + hub-api. Qua tunnel: `http://localhost:18434/health` (hub), `/auth-health` (admin-api).
- UI (Node thật, tunnel đang mở): `S2_PW=<mật khẩu admin, không in> node deploy/prod-sohoptac2/verify-ui.mjs` — đăng nhập
  admin-web, contracts-web, chat-web + một lượt chat thật; ảnh vào `docs/deploy/sohoptac2/`.

## Không làm ở đây
Không nạp dữ liệu, không tạo tenant khách (NitiGroup = lát khác). Không đổi edge-proxy/nginx host/tên miền/TLS.
Không đụng `aisystem`, `sohoptac`, `evotest`, `edge-proxy`, dify, `infra-*`.
