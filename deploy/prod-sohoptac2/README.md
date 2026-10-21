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

## Nhập dữ liệu chị Tiên (sohoptac cũ → tenant `nitigroup`) — niti-import
Chỉ dữ liệu của MỘT tài khoản cũ (Lê Thị Thuý Tiên): HĐ chị phụ trách / chưa giao mà chị tạo + phụ lục, hạng mục, đợt thanh toán/giao
hàng, sổ đối tác (cả đánh giá chị ghi), file gốc → FileBox; mọi HĐ thuộc user `tien` (tạo trước bằng script tenant-owner; vắng ⇒ lỗi
`OWNER_USER_NOT_FOUND`). Không tạo user, không gửi gì: mốc nhắc đã qua của HĐ nhập được đánh dấu "đã nhắc" trong cùng tx (vòng nhắc
không gửi cho hạn cũ); mốc nhắc TƯƠNG LAI vẫn chạy như HĐ thường. Nhãn lô = `--source sohoptac-tien` (hoàn tác chỉ theo nhãn này).

sohoptac cũ (project Docker `sohoptac`, CHỈ ĐỌC): dữ liệu ở OpenSearch (index không tiền tố: `contracts`, `obligations`,
`partner_events`, `companies`, `state`, `users`…; cổng không publish ⇒ đọc qua mạng `sohoptac_default`, REST `_search` scroll), file
gốc ở volume `sohoptac_apidata` → `/app/data/contract_files/<org>/<hđ>/<tên>` (mount `:ro`); Neo4j không cần. Mọi lệnh chạy TRÊN máy chủ:
```
cd ~/workspace/sohoptac2; dc() { docker compose -p sohoptac2 "$@"; }
docker inspect sohoptac-api-1 --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'   # ⇒ sohoptac_apidata -> /app/data
docker inspect sohoptac-opensearch-1 --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' # ⇒ sohoptac_default
ACTOR=$(dc exec -T pg psql -U s2_owner -d ai_system -Atc "select id from admin.users where role='platform_admin' and username='admin'")
dc exec -T pg psql -U s2_owner -d ai_system -Atc "select u.active from admin.users u join admin.tenants t on t.id=u.tenant_id where t.key='nitigroup' and u.username='tien'"   # ⇒ t
mkdir -p import-out && chmod 700 import-out
```
**(a) Export chỉ-đọc.** Liệt kê chủ HĐ để lấy email cũ của chị Tiên, rồi export đã lọc đúng tài khoản đó (file 600):
```
EXP=(docker run --rm -i --user "$(id -u):$(id -g)" --network sohoptac_default -v "$PWD/import-out:/out"
  -e MGMT_OPENSEARCH_URL=http://opensearch:9200 sohoptac2-app:latest bun apps/admin-api/src/modules/mgmt-import/mgmt-export.cli.ts)
"${EXP[@]}" | jq '.owners'                       # tìm dòng tên "Lê Thị Thuý Tiên" ⇒ email; contracts ≈ 11
TIEN_OLD='<email cũ của chị Tiên>'
"${EXP[@]}" --owner-email "$TIEN_OLD" --out /out/tien-export.json > import-out/export.json
jq '.export | {sha256, source_orgs, docs, excluded, not_imported}' import-out/export.json
```
⇒ `docs.contracts` = số HĐ + phụ lục của chị; `source_orgs` đúng 1 org; `not_imported` = bản ghi của chị ở phần KHÔNG nhập (CKS, tri
thức, hẹn nhắc, chat…) — khác `{}` ⇒ dừng, báo người dùng.

**(b) Dry-run** (không ghi, không tải file; exit 0 = sạch, 2 = có vấn đề):
```
IMP=(docker run --rm -i --user "$(id -u):$(id -g)" --network sohoptac2_default
  -v "$PWD/.env:/run/s2/app.env:ro" -v sohoptac_apidata:/mgmtdata:ro -v "$PWD/import-out:/out"
  sohoptac2-app:latest bun --env-file=/run/s2/app.env apps/admin-api/src/modules/mgmt-import/mgmt-import.cli.ts
  --source sohoptac-tien --actor "$ACTOR" --into-tenant nitigroup --owner-email "$TIEN_OLD" --owner-username tien
  --from-export /out/tien-export.json --files-dir /mgmtdata/contract_files --filebox)
"${IMP[@]}" --report /out/dry.json > /dev/null; echo "exit=$?"
jq '{counts, money, money_ok, files, partners, issues_by_code, unmapped_fields, excluded, not_imported}' import-out/dry.json
jq -r '.contracts[] | [.kind, .number, .partner, .value, .signed_date, .start_date, .end_date, .has_file, .file_found] | @tsv' import-out/dry.json
```
⇒ `counts.*.source = planned`, `money_ok=true`, mỗi HĐ `has_file` ⇒ `file_found=true` (không thì `FILE_MISSING`), `unmapped_fields`
= trường cũ không có chỗ ở app mới (đọc, báo người dùng). Danh sách HĐ so tay với app cũ.

**(c) Apply** (sao lưu trước; MỘT tx mỗi HĐ; file → FileBox org `t_<tenant>` rồi đọc lại so sha256):
```
bash backup.sh
"${IMP[@]}" --apply --report /out/apply.json > /dev/null; echo "exit=$?"
jq '{counts, money, money_ok, files, tables, issues_by_code}' import-out/apply.json
"${IMP[@]}" --apply --report /out/rerun.json > /dev/null; jq '[.tables[].inserted] | add, .files' import-out/rerun.json
```
⇒ exit 0; `counts.*`: source = planned = target; `money_ok=true`; `files.checksum_ok` = số file, `checksum_bad=0`; chạy lại: tổng
`inserted = 0`, `uploaded = 0`. Đứt giữa chừng ⇒ chạy lại đúng lệnh (id tất định; HĐ đã có mà chưa file ⇒ chỉ gắn file).

**(d) Kiểm tra:**
```
Q="select count(*) from hub.notifications n join admin.tenants t on t.id=n.tenant_id where t.key='nitigroup'"
dc exec -T pg psql -U s2_owner -d ai_system -Atc "$Q"; sleep 150; dc exec -T pg psql -U s2_owner -d ai_system -Atc "$Q"   # ⇒ 0 và 0 (vòng nhắc 60 s)
dc exec -T pg psql -U s2_owner -d ai_system -c "select c.kind, c.number, c.seller, c.buyer, c.value, c.end_date, c.action_deadline,
  c.file_id is not null as has_file, u.username as owner from contracts.contracts c join admin.tenants t on t.id=c.tenant_id
  join admin.users u on u.id=c.owner_user_id where t.key='nitigroup' and exists (select 1 from contracts.contract_events e
  where e.contract_id=c.id and e.type='mgmt_import' and e.data->>'mgmt_source'='sohoptac-tien') order by c.kind, c.number"
```
⇒ đúng danh sách ở (b), owner = `tien`. HĐ có `action_deadline` sắp tới sẽ nhắc bình thường từ nay. Rồi mở contracts-web (tunnel
:18431) bằng tài khoản `tien`, so từng HĐ/sổ/file với app cũ. Xong: `rm import-out/tien-export.json` (dữ liệu khách).

**(e) Hoàn tác** (chỉ lô `sohoptac-tien` trong `nitigroup`; HĐ xoá qua `contracts.delete_contract` — đường xoá của app, một tx mỗi
HĐ; sổ đối tác chỉ thêm ⇒ được HUỶ chứ không xoá; nhật ký xoá giữ ở `contracts.contract_delete_log`; có phụ lục tạo sau treo dưới HĐ
của lô ⇒ từ chối `ROLLBACK_FOREIGN_CHILDREN`):
```
RB=(docker run --rm -i --user "$(id -u):$(id -g)" --network sohoptac2_default -v "$PWD/.env:/run/s2/app.env:ro" -v "$PWD/import-out:/out"
  sohoptac2-app:latest bun --env-file=/run/s2/app.env apps/admin-api/src/modules/mgmt-import/mgmt-import.cli.ts
  --source sohoptac-tien --actor "$ACTOR" --into-tenant nitigroup --rollback --from-export /out/tien-export.json)
"${RB[@]}" --report /out/rb-dry.json > /dev/null; jq '{before, contracts, error}' import-out/rb-dry.json
"${RB[@]}" --apply --report /out/rb.json > /dev/null; jq '{deleted_contracts, voided_events, after, files_kept, error}' import-out/rb.json
```
⇒ `after`: contracts/items/obligations/approvals/events/reminders/files = 0, `partner_events = partner_events_voided`. Hàng
`contracts.files` + object FileBox của lô được GIỮ (app không xoá file; không HĐ nào trỏ tới). Nhập lại sau hoàn tác ⇒ dùng nhãn MỚI
(`--source sohoptac-tien-2`; sự kiện sổ của nhãn cũ đã huỷ). Xoá hẳn hàng file (tuỳ chọn, role chủ):
`dc exec -T pg psql -U s2_owner -d ai_system -c "delete from contracts.files f where f.id = any('{<files_kept>}'::uuid[]) and not exists (select 1 from contracts.contracts c where c.file_id = f.id)"`.
Khôi phục toàn bộ (thảm hoạ): bản `backup.sh` chụp ngay trước (c).

## Không làm ở đây
Không nạp dữ liệu (trừ mục niti-import ở trên, do người dùng chạy), không tạo tenant khách (NitiGroup = lát khác). Không đổi edge-proxy/nginx host/tên miền/TLS.
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