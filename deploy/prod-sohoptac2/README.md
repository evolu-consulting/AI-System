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
| filebox | sohoptac2-filebox (python 3.12, app = bản sao FileBox dùng chung) | 1 / 768 MB | :9100 **chỉ nội bộ** (không publish), volume `fbdata`; FileBox RIÊNG, token riêng |
| filebox-minio | alpine + nhị phân MinIO tĩnh chép từ host | 1 / 1 GB | :9000 chỉ nội bộ, volume `fbminio`, khoá riêng |
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

## FileBox riêng (ADR-0015)
- `filebox-env.sh` (gọi bởi `gen-env.sh`, idempotent, không in giá trị) sinh `FILEBOX_TOKEN`, `FILEBOX_MINIO_USER/PASSWORD` riêng, đặt `HUB_ATTACH_DRIVER=filebox`,
  `FILEBOX_URL=http://filebox:9100`, `FILEBOX_HTTP_HOSTS=filebox` (hub-api chỉ nhận http cho host liệt kê tường minh; host công khai vẫn buộc https),
  `FILEBOX_PUBLIC_PATH=/_fb`; thay các dòng FILEBOX_* của FileBox dùng chung (bản cũ: `.env.bak-filebox`). MinIO chính thức không còn trên registry ⇒ chép CHỈ-ĐỌC nhị phân tĩnh `~/filebox/bin/minio` vào `./minio-bin/`.
- Không cổng host. Trình duyệt tải qua link ký 10 phút `<web>/_fb/d/<id>?…`: nginx của `web` chỉ cho GET/HEAD tới `filebox:9100/d/<id>` (contracts :8081, chat :8083, hub :8084).
- Dữ liệu FileBox cũ (kho chung `ai-system`) KHÔNG chuyển sang; file đã đính kèm trước đây phải gắn lại bằng `mgmt-import --filebox`.

## Sao lưu + thử khôi phục (`backup.sh`, `restore-test.sh`; chạy TRÊN máy chủ, deploy.ps1 chép kèm kit)
- `bash backup.sh` → `~/workspace/sohoptac2/backups/<UTC yyyymmddThhmmssZ>/` (700; file 600): `pg.dump` (-Fc) + `pg-globals.sql` (role),
  `rowcounts.tsv` (số hàng mỗi bảng, khoảng min..max quanh lúc dump), `filebox-sample.tsv` (một object: id/version/size/sha256),
  `fbminio.tar` + `fbdata.tar` (volume MinIO + sqlite FileBox; **filebox + filebox-minio dừng vài giây** cho nhất quán rồi tự chạy lại; `QUIESCE=0` = tar nóng),
  `env`, `claude-home.tgz`, `admin-credentials.txt`, `MANIFEST.sha256`. Không in bí mật. Giữ 14 ngày + 8 tuần (bản mới nhất mỗi tuần). Lỗi ⇒ log `backups/backup.log`, exit ≠ 0.
- Ngoài máy chủ: `OFFSITE_DIR=user@host:/path bash backup.sh` (rsync; thêm `OFFSITE_RSYNC_OPTS="-e 'ssh -i …'"`). Không đặt ⇒ in cảnh báo (bản sao chỉ nằm cùng máy).
- `bash restore-test.sh` → khôi phục bản MỚI NHẤT vào project tạm `s2restore` (không cổng, volume `s2restore_*`), kiểm sha256, số hàng từng bảng khớp manifest,
  một object FileBox đúng hash, rồi gỡ sạch. Không đụng project/volume `sohoptac2`. exit 0 = đạt; log `backups/restore-test.log`.
- Crontab (đã cài 2026-10-21 dưới user `evoc`; backup đầu 20261021T060509Z + restore-test đạt; cài lại: `crontab -e`):
```
30 2 * * * bash $HOME/workspace/sohoptac2/backup.sh >> $HOME/workspace/sohoptac2/backups/cron.log 2>&1
30 4 * * 0 bash $HOME/workspace/sohoptac2/restore-test.sh >> $HOME/workspace/sohoptac2/backups/cron.log 2>&1
```
- Khôi phục thật (thảm hoạ): làm theo đúng các bước của `restore-test.sh` nhưng vào project `sohoptac2` với volume trống (thủ công, có người giám sát).

## Không làm ở đây
Không nạp dữ liệu, không tạo tenant khách (NitiGroup = lát khác). Không đổi edge-proxy/nginx host/tên miền/TLS.
Không đụng `aisystem`, `sohoptac`, `evotest`, `edge-proxy`, dify, `infra-*`.

## Domain thử nghiệm (ai-test / sohoptac-test / ai-test-admin / ai-test-hub .evoluconsulting.com) — KHÔNG đụng app cũ
Host nginx (TLS wildcard) → `edge-proxy` (127.0.0.1:8090) → container `sohoptac2-web-1` theo cổng nội bộ. Chỉ thêm **một** file vào `edge-proxy/conf.d/`.
| Host | Cổng `web` | App |
|---|---|---|
| `ai-test.<domain>` | 8083 | AI System portal + Chat AI (chat-web) |
| `sohoptac-test.<domain>` | 8081 | Sổ Hợp Tác (contracts-web) |
| `ai-test-admin.<domain>` | 8082 | Quản trị |
| `ai-test-hub.<domain>` | 8084 | Hub API + Studio (`/studio/`) |

Thứ tự (trên máy chủ, thư mục `~/workspace/sohoptac2`; các lệnh dưới do người dùng chạy):
1. `powershell -File deploy/prod-sohoptac2/deploy.ps1 -Domain evoluconsulting.com` — kit kèm `enable-domain.sh`, `disable-domain.sh`, `edge/`; `gen-env.sh` nhận `S2_DOMAIN` (đổi `S2_PUBLIC_*`, `APP_URL_*` qua compose, `CORS_ORIGINS`/`HUB_CORS_ORIGINS` = 4 host https **và** 4 origin localhost của tunnel, `ADMIN_WEB_URL`, `HUB_NOTIFY_BASE_URL`, `TRUST_PROXY_HOPS=3`; sao lưu `.env.bak-domain` một lần), build lại web (URL `PUBLIC_*` nhúng lúc build) và `setup.sh`. `-Domain none` = về tunnel.
2. `bash enable-domain.sh` — chép `edge/sohoptac2.conf` → `edge-proxy/conf.d/sohoptac2.conf`, `docker network connect sohoptac2_default edge-proxy` (runtime), thêm mạng vào `edge-proxy/docker-compose.yml` (sao lưu `.bak-sohoptac2`, chỉ khi chưa có; không tự sửa được thì cảnh báo + hướng dẫn tay), `nginx -t` rồi MỚI `nginx -s reload` (graceful). `nginx -t` lỗi ⇒ gỡ conf mới, exit ≠ 0. Từ chối nếu `server_name` đã có ở conf khác. In sẵn các lệnh `curl` kiểm.
3. `docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/s2-app-urls.ts --base-domain evoluconsulting.com` (chạy thử), thêm `--apply` để ghi: đổi `admin.app_catalog.url` (chat/contracts/studio/admin) sang https, **chỉ hàng còn trỏ localhost** (idempotent; hàng sửa tay giữ nguyên).
Hoàn tác: `bash disable-domain.sh` (gỡ conf, reload, ngắt mạng, khôi phục compose từ bản sao lưu), rồi `deploy.ps1 -Domain none`.

Ghi chú: cookie refresh đã `Secure` (APP_ENV=production; Chrome vẫn nhận trên `http://localhost`) và nginx `web` giữ `X-Forwarded-Proto` của edge. Cookie mỗi host riêng (`Path=/auth`, SameSite=Strict, cùng origin với web nên không cross-site); SSO giữa app đi qua `PUBLIC_SSO_URL` = `https://ai-test.<domain>`. Qua tunnel vẫn đăng nhập được từng cổng (CORS có origin localhost) nhưng link chuyển app dẫn sang host https. Giới hạn body 110m, SSE `proxy_buffering off`, `proxy_read_timeout 600`. `TRUST_PROXY_HOPS=3` = host nginx + edge-proxy + web (đều nối `X-Forwarded-For`).

e2e triển khai qua domain: `powershell -File deploy/prod-sohoptac2/e2e-deployed.ps1 -Domain evoluconsulting.com` (không mở tunnel) hoặc đặt `DEP_DOMAIN=evoluconsulting.com` (`e2e/deployed/_support.ts`; `DEP_*_URL` vẫn ghi đè từng host). Không đặt ⇒ localhost:1843x qua tunnel.