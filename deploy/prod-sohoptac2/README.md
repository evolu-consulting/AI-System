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
| web | sohoptac2-web (nginx) | 0.5 / 256 MB | 5 web (+ community-web :8085) + reverse proxy |
| filebox | sohoptac2-filebox (python 3.12, app = bản sao FileBox dùng chung) | 1 / 768 MB | :9100 **chỉ nội bộ** (không publish), volume `fbdata`; FileBox RIÊNG, token riêng |
| filebox-minio | alpine + nhị phân MinIO tĩnh chép từ host | 1 / 1 GB | :9000 chỉ nội bộ, volume `fbminio`, khoá riêng |
| tool (profile `tools`) | sohoptac2-app | 1 / 1 GB | migrate / seed / smoke |

Cổng (chỉ `127.0.0.1`): **18431** contracts-web · **18432** admin-web · **18433** chat-web · **18434** Hub + Studio (`/studio/`) · **18435** community-web (Cộng đồng đối tác).
Migration: `packages/db/src/migrate.ts` = main + hub + packs-kit + gói `contracts` + `knowledge` + `community` (production bỏ `*-dev` và `pkdemo`).

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
  Đích không nhận kết nối vào (máy Windows dev) ⇒ KÉO về: `pull-backup.ps1` (bản mới nhất → `F:\backups\sohoptac2`, giữ 14, thư mục chỉ user hiện tại đọc;
  log `F:\workspace\tools\_logs\pull-backup.log`). Đặt lịch hằng ngày 10:15 giờ VN (sau backup 02:30 UTC) bằng Task Scheduler (xem "Lịch Windows" dưới).
- Theo dõi từ ngoài: `uptime-check.ps1` (GET sohoptac./ai./ai-admin.; lỗi 2 lượt liền ⇒ cửa sổ `msg` + `F:\workspace\tools\_logs\uptime.log`), lịch mỗi 5 phút.
  Máy chủ tự khởi động lại 00:16 UTC mỗi ngày (~3 phút) ⇒ có thể báo một lần rồi "hồi phục".
- Lịch Windows (người dùng tự chạy một lần, PowerShell thường):
```
$d='F:\workspace\evolu-platform\deploy\prod-sohoptac2'
Register-ScheduledTask sohoptac2-pull-backup -Action (New-ScheduledTaskAction powershell.exe "-NoProfile -WindowStyle Hidden -File `"$d\pull-backup.ps1`"") -Trigger (New-ScheduledTaskTrigger -Daily -At 10:15) -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable)
Register-ScheduledTask sohoptac2-uptime -Action (New-ScheduledTaskAction powershell.exe "-NoProfile -WindowStyle Hidden -File `"$d\uptime-check.ps1`"") -Trigger (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)) -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew)
```
- Đổi mật khẩu platform admin: `bash rotate-admin-pw.sh` trên máy chủ (sinh ngẫu nhiên, đổi qua /auth/change-password, ghi ADMIN_CREDENTIALS.txt 600, thử đăng nhập lại; không in). Đã chạy 2026-10-27.
- `bash restore-test.sh` → khôi phục bản MỚI NHẤT vào project tạm `s2restore` (không cổng, volume `s2restore_*`), kiểm sha256, số hàng từng bảng khớp manifest,
  một object FileBox đúng hash, rồi gỡ sạch. Không đụng project/volume `sohoptac2`. exit 0 = đạt; log `backups/restore-test.log`.
- Crontab (đã cài 2026-10-21 dưới user `evoc`; backup đầu 20261021T060509Z + restore-test đạt; cài lại: `crontab -e`):
```
30 2 * * * bash $HOME/workspace/sohoptac2/backup.sh >> $HOME/workspace/sohoptac2/backups/cron.log 2>&1
30 4 * * 0 bash $HOME/workspace/sohoptac2/restore-test.sh >> $HOME/workspace/sohoptac2/backups/cron.log 2>&1
```
- Khôi phục thật (thảm hoạ): làm theo đúng các bước của `restore-test.sh` nhưng vào project `sohoptac2` với volume trống (thủ công, có người giám sát).

## Tình trạng hệ thống (CR-104)
- Trang `/system` của Hub đọc 2 file JSON trong `~/workspace/sohoptac2/ops-status/` (không bí mật; compose gắn thư mục này CHỈ-ĐỌC vào hub-api tại `/run/s2/ops`, `HUB_OPS_STATUS_DIR`; thư mục backup KHÔNG được gắn). `HUB_OPS_WATCH` (mặc định on) bật vòng kiểm; `OPS_PUBLIC_URLS` = 5 URL `S2_PUBLIC_*` (sohoptac, ai, ai-admin, ai-hub, community; phân cách dấu phẩy) do compose dựng.
- `backup.json`: `backup.sh` ghi nguyên tử ở CUỐI mỗi lần chạy (cả thành công lẫn lỗi; lần chạy trùng bị khoá thì không ghi): `finished_at, ok, dir, size_bytes, offsite, offsite_ok, error`.
- `host.json`: `ops-host-status.sh` (cron 30 phút, cũng chạy cuối `setup.sh`) ghi `at, disks[{mount,used_pct,avail_bytes}]` (`/` + thư mục dữ liệu Docker nếu khác mount), `deploy_ref` (dòng đầu file `VERSION` do deploy.ps1 ghi; thiếu ⇒ null).
- Cài cron MỘT lần trên máy chủ (idempotent, chạy lại không nhân đôi):
```n( crontab -l 2>/dev/null | grep -v 'ops-host-status.sh'; echo '*/30 * * * * bash $HOME/workspace/sohoptac2/ops-host-status.sh >> $HOME/workspace/sohoptac2/ops-status/cron.log 2>&1' ) | crontab -
```n- Kiểm: `cd ~/workspace/sohoptac2 && bash ops-host-status.sh && cat ops-status/host.json`; `bash backup.sh && cat ops-status/backup.json` (hoặc đợi backup 02:30 UTC); `crontab -l | grep ops-host`; `docker compose -p sohoptac2 exec hub-api ls /run/s2/ops` (thấy file, ghi thử phải báo read-only); rồi mở `/system`.
- Triển khai lần đầu: `powershell -File deploy/prod-sohoptac2/deploy.ps1` (chép kit, `setup.sh` tạo `ops-status/` + chạy `ops-host-status.sh` + `up -d` hub-api có mount) rồi lệnh cron ở trên.

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
thức, hẹn nhắc…) — khác `{}` ⇒ dừng, báo người dùng. Từ niti-import2: chat/CKS/thông báo/báo giá/quét giá/lịch sử chấm điểm nằm
trong `docs` (nhập ở (f)); `{"feedback": n}` là bình thường (góp ý không nhập).

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

### (f) Phần còn lại của tài khoản — niti-import2 (`--include-extras`, nhãn lô RIÊNG `sohoptac-tien-extras`)
Chat trợ lý + file chat → hội thoại LƯU TRỮ chỉ đọc của `tien` (không run, không agent; my-chat-history tìm được; file → FileBox
org `FILEBOX_ORG` của hub, gắn vào lượt nhắc tên file, file thừa gom ở hội thoại "Tệp đã tải lên ở app cũ"); văn bản ký + chứng thư
→ module CKS chỉ đọc (`contracts.cks_*`, nối khách CKS + HĐ bán đã nhập ở lô `sohoptac-tien`; app cũ không giữ bytes văn bản ký ⇒
không có file); thông báo → lịch sử ĐÃ ĐỌC (`fanout_at` đặt sẵn ⇒ không email/push); báo giá → `contracts.price_quotes`; quét giá →
giá tham chiếu CKS kèm ngày (`cks_market_prices`) + bản ghi lượt quét; lịch sử chấm điểm → `contracts.legacy_records` (JSON chỉ thêm).
CHỈ bản ghi của org `d963bf8c-e0dd-40e4-b6d5-56310e090514`; org khác ⇒ `excluded_other_org`, có "[E2E]" ⇒ `excluded_e2e`; góp ý
KHÔNG nhập (dữ liệu thử). Cần migration hub `0054` + contracts `0045` (deploy bản mới trước). Export cũ không có phần này ⇒ export lại:
```
"${EXP[@]}" --owner-email "$TIEN_OLD" --out /out/tien-export.json > import-out/export.json
jq '.export | {docs, not_imported}' import-out/export.json          # ⇒ not_imported chỉ còn {"feedback": 7}
EXTRA=(docker run --rm -i --user "$(id -u):$(id -g)" --network sohoptac2_default
  -v "$PWD/.env:/run/s2/app.env:ro" -v sohoptac_apidata:/mgmtdata:ro -v "$PWD/import-out:/out"
  sohoptac2-app:latest bun --env-file=/run/s2/app.env apps/admin-api/src/modules/mgmt-import/mgmt-import.cli.ts
  --source sohoptac-tien-extras --link-source sohoptac-tien --include-extras --actor "$ACTOR" --into-tenant nitigroup
  --owner-email "$TIEN_OLD" --owner-username tien --extras-org d963bf8c-e0dd-40e4-b6d5-56310e090514
  --from-export /out/tien-export.json --data-dir /mgmtdata --filebox)
"${EXTRA[@]}" --report /out/x-dry.json > /dev/null; echo "exit=$?"
jq '{counts, files, retention, notes, issues_by_code, not_imported}' import-out/x-dry.json
```
⇒ exit 0; mỗi `counts.<loại>`: `source_all = excluded_other_org + excluded_e2e + source`, `planned = source` (chats: số hội thoại;
`conversations`/`messages` = tổng gồm hội thoại gom file); `files.found = files.jobs`, `files.unsupported` = file đuôi hub không nhận
(báo người dùng); `retention.messages_older` > 0 ⇒ tin cũ hơn hạn lưu `chat_history_months` (mặc định 12) — my-chat-history không
thấy chúng; báo người dùng trước khi apply. Apply (sao lưu trước) + chạy lại:
```
bash backup.sh
"${EXTRA[@]}" --apply --report /out/x-apply.json > /dev/null; echo "exit=$?"
jq '{counts, files, deliveries, notifications_unread, issues_by_code}' import-out/x-apply.json
"${EXTRA[@]}" --apply --report /out/x-rerun.json > /dev/null; jq '{files, counts}' import-out/x-rerun.json
dc exec -T pg psql -U s2_owner -d ai_system -Atc "select count(*) from hub.notification_deliveries d join admin.tenants t on t.id=d.tenant_id where t.key='nitigroup'"
```
⇒ `counts.*.target = planned`; `files.uploaded = files.jobs`, `checksum_ok = jobs`, `checksum_bad = 0`; `deliveries = 0`,
`notifications_unread = 0`; chạy lại: `files.uploaded = 0`, `existing = jobs`, target không đổi; câu cuối ⇒ 0.
Hoàn tác (CHỈ nhãn `sohoptac-tien-extras`: hội thoại + tin + đính kèm, thông báo, hàng gói theo sổ `contracts.import_rows`; lô HĐ
chính và hàng app tạo không đụng; object FileBox giữ):
```
XRB=(docker run --rm -i --user "$(id -u):$(id -g)" --network sohoptac2_default -v "$PWD/.env:/run/s2/app.env:ro" -v "$PWD/import-out:/out"
  sohoptac2-app:latest bun --env-file=/run/s2/app.env apps/admin-api/src/modules/mgmt-import/mgmt-import.cli.ts
  --source sohoptac-tien-extras --link-source sohoptac-tien --include-extras --rollback --actor "$ACTOR" --into-tenant nitigroup
  --owner-username tien --from-export /out/tien-export.json)
"${XRB[@]}" --report /out/x-rb-dry.json > /dev/null; jq '.before' import-out/x-rb-dry.json
"${XRB[@]}" --apply --report /out/x-rb.json > /dev/null; jq '{deleted, after, error}' import-out/x-rb.json
```
⇒ `after`: `conversation_ids = []`, `messages = 0`, `attachments = []`, `notifications = 0`, `contracts = {}`. Xong: `rm import-out/tien-export.json`.

## Ký số hợp đồng — chọn nhà cung cấp (cf-esign-docusign)
Trung lập nhà cung cấp; chọn bằng `ESIGN_PROVIDER` trong `.env`: `none` (mặc định, tắt — UI báo "Chưa cấu hình ký số"),
`selfsign` (KÝ THỬ để demo luồng: không gọi mạng, không chứng thư, "Bản đã ký" = bản PDF gốc đổi tên `-ky-thu.pdf`; UI ghi rõ
"Ký thử – không có giá trị pháp lý"), `docusign` (DocuSign eSignature REST v2.1). CA Việt Nam (VNPT SmartCA / Viettel MySign…) sẽ là
adapter mới cùng cổng `ESignProvider`. Sau khi đặt env: owner gói bật ô "Ký số hợp đồng" ở Cài đặt › Quy trình duyệt (theo công ty).

**Nhiều nhà cung cấp song song (esign-multi):** `ESIGN_PROVIDERS=docusign,selfsign` (danh sách theo thứ tự; đặt thì thắng
`ESIGN_PROVIDER`; chỉ có `ESIGN_PROVIDER=x` ⇒ coi như `ESIGN_PROVIDERS=x`, cấu hình cũ chạy nguyên). Mỗi nhà cung cấp chỉ khả dụng
khi đủ cấu hình (docusign: đủ `DOCUSIGN_*`; selfsign: luôn; misa: chưa có adapter). Owner chọn **nhà cung cấp mặc định** ở cùng ô Cài
đặt (vắng ⇒ khả dụng đầu tiên theo thứ tự env); người gửi đổi được trong hộp "Gửi ký" khi có > 1 khả dụng. Phong bì đã gửi luôn dùng
nhà cung cấp lưu trên phong bì (đổi mặc định không ảnh hưởng). Người ký phía công ty = chính tài khoản bấm "Gửi ký" (cần có email).
Nhà cung cấp liệt kê mà thiếu cấu hình ⇒ log `esign-provider-not-configured` (chỉ tên nhà cung cấp, không lộ giá trị).

### Cài DocuSign sandbox (developer, KHÔNG phải tài khoản thật)
1. Tạo tài khoản developer tại `https://developers.docusign.com` (môi trường demo: REST `https://demo.docusign.net/restapi`,
   OAuth `account-d.docusign.com`).
2. Admin (`https://admindemo.docusign.com`) › **Apps and Keys** › **Add App and Integration Key** → ghi **Integration Key**.
   Trong app: **Service Integration › Generate RSA** → lưu khoá riêng (chỉ hiện một lần) thành `~/workspace/sohoptac2/secrets/docusign.pem`
   trên máy chủ (`chmod 600`, thư mục `secrets/` mount chỉ đọc vào hub-api tại `/run/s2/secrets`). **Additional settings › Redirect URIs**:
   thêm `https://sohoptac.evoluconsulting.com/`.
3. Cũng ở **Apps and Keys**: ghi **User ID** (GUID của user API sẽ mạo danh) và **API Account ID**.
4. Cấp consent JWT một lần (đăng nhập bằng user ở bước 3, bấm Accept; trang chuyển về sohoptac là xong):
   `https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=<INTEGRATION_KEY>&redirect_uri=https://sohoptac.evoluconsulting.com/`
5. **Connect** (Settings › Connect › Add Configuration › Custom): URL `https://sohoptac.evoluconsulting.com/pack/contracts/esign/webhook/docusign`,
   định dạng **JSON (SIM)**, sự kiện envelope Sent/Delivered/Completed/Declined/Voided, **bật Include HMAC Signature** và tạo khoá HMAC
   (Settings › Connect › Connect Keys) → đặt vào `DOCUSIGN_CONNECT_HMAC_KEY`. Thiếu khoá ⇒ webhook bị từ chối (401); vẫn dùng được nút
   "Làm mới trạng thái". nginx của contracts-web đã proxy `/pack` sang hub-api (không cần sửa).
6. `.env` (không commit giá trị; mẫu khoá ở `env.template`):
   ```
   ESIGN_PROVIDER=docusign
   DOCUSIGN_INTEGRATION_KEY=<Integration Key>
   DOCUSIGN_USER_ID=<User ID>
   DOCUSIGN_ACCOUNT_ID=<API Account ID>
   DOCUSIGN_BASE_URI=https://demo.docusign.net/restapi        # mặc định, có thể bỏ
   DOCUSIGN_OAUTH_HOST=account-d.docusign.com                 # mặc định, có thể bỏ
   DOCUSIGN_PRIVATE_KEY_FILE=/run/s2/secrets/docusign.pem
   DOCUSIGN_CONNECT_HMAC_KEY=<khoá HMAC Connect>
   ```
   Khởi động lại hub-api. Thiếu biến bắt buộc ⇒ log `esign-provider-not-configured` (không lộ giá trị) và docusign không khả dụng,
   không lỗi 500. Muốn chạy song song ký thử: thêm `ESIGN_PROVIDERS=docusign,selfsign` (giữ DocuSign đứng đầu = mặc định).
7. Thử: HĐ đã duyệt xong (đã khoá, tệp PDF) › "Gửi ký" › người ký 1 = mình ("Ký ngay", ký nhúng), người ký 2 = email đối tác (nhận
   email từ DocuSign demo) › ký xong ⇒ webhook (hoặc "Làm mới trạng thái") ⇒ "Đã ký số" + "Tải bản đã ký".
   Lên production DocuSign thật: qua Go-Live review của DocuSign, đổi `DOCUSIGN_BASE_URI` (theo base URI của tài khoản) và
   `DOCUSIGN_OAUTH_HOST=account.docusign.com`, consent lại.

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

## Cutover: 4 ten mien production -> stack moi (sohoptac., ai., ai-admin., ai-hub. .evoluconsulting.com)
| Host | Cong `web` | App |
|---|---|---|
| `sohoptac.<domain>` | 8081 | So Hop Tac moi (contracts-web) |
| `ai-admin.<domain>` | 8082 | Quan tri |
| `ai.<domain>` | 8083 | AI System portal + Chat AI |
| `ai-hub.<domain>` | 8084 | Hub + Studio |

Cac host `-test` van la alias vo hai (cung `server_name`, CORS van cho phep) nhung KHONG con duoc dung. App cu (`sohoptac`, `aisystem`) khong con ten mien cong khai:
container giu nguyen chay, chi truy cap bang SSH tunnel; khong migrate du lieu cu. Cert `evoluconsulting` da co ca 4 ten prod => khong can certbot (ten community moi thi CAN cert: xem muc Community).
Thu tu (tren may chu, thu muc `~/workspace/sohoptac2`; do nguoi dung chay):
1. `powershell -File deploy/prod-sohoptac2/deploy.ps1 -Domain evoluconsulting.com -Hosts prod` — `gen-env.sh` nhan `S2_HOSTS=prod|test` (ghi vao `.env`): `PUBLIC_*`/`APP_URL_*`/`ADMIN_WEB_URL`/`HUB_NOTIFY_BASE_URL`/SSO dung host prod; `CORS_ORIGINS`/`HUB_CORS_ORIGINS` gom CA host prod, host `-test` va origin localhost cua tunnel. Build lai web.
2. `bash enable-domain.sh` (neu chua chay: noi mang edge-proxy; chi cai ten `-test`, khong dung ten prod con thuoc app cu).
3. `bash cutover.sh` — sao luu `conf.d` -> `conf.d.bak-<ts>` (+ marker `.s2-cutover-backup`), doi ten `aisystem.conf` va `sohoptac.conf` thanh `*.conf.disabled` (khong xoa), cai `sohoptac2.conf` (ten prod + `-test`), `nginx -t` -> reload; loi => khoi phuc ban sao luu, exit 1. Chay lai an toan (khong ghi de ban sao luu goc). In san lenh `curl` kiem.
4. `docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/s2-app-urls.ts --base-domain evoluconsulting.com --hosts prod` (them `--apply` de ghi): doi `admin.app_catalog.url` con tro localhost hoac `-test` sang host prod; hang khac giu nguyen.
Hoan tac: `bash rollback-cutover.sh` (khoi phuc `conf.d` tu ban sao luu goc: bat lai app cu, go ten prod khoi sohoptac2.conf, reload), roi `deploy.ps1 -Hosts test` neu muon URL ve -test.
e2e: `e2e-deployed.ps1 -Domain evoluconsulting.com -Hosts prod` (hoac `DEP_DOMAIN` + `DEP_HOSTS=prod|test`).

## Community (community-web, CR-102) — app Cộng đồng đối tác
**Đã có trong kit:** web image build thêm `apps/community-web` (cùng `PUBLIC_*`, `PUBLIC_SSO_URL` = chat-web; **không** đặt `PUBLIC_COMMUNITY_API` ⇒ build chạy `http` → `/pack/community/*`), nginx `web` cổng **8085** (publish `127.0.0.1:18435`, `S2_PORT_COMMUNITY`): `/auth` → admin-api (cookie `ai_rt_community`, `Path=/auth`), `/pack` `/conversations` `/runs` `/notifications` → hub-api (SSE: `proxy_buffering off`, `proxy_read_timeout 600`), `/sso` và mọi route SPA → `index.html`. `edge/sohoptac2.conf` có server `__N_COMMUNITY__` → `:8085`. Env: admin-api `APP_URL_COMMUNITY`, hub-api `COMMUNITY_WEB_URL` + `CONTRACTS_WEB_URL` + `COMMUNITY_SWEEP` (mặc định on; `off` tắt) + `COMMUNITY_SWEEP_EVERY_MS` (mặc định 60000), `CORS_ORIGINS`/`HUB_CORS_ORIGINS` gồm host community (prod, -test) + `http://localhost:18435`. `s2-app-urls.ts` đổi thêm hàng catalog `community`.

| Host (TẠM — tên chưa chốt) | Cổng `web` | App |
|---|---|---|
| `community.<domain>` (prod) / `community-test.<domain>` (test) | 8085 | community-web |

Đổi tên host: sửa **cùng lúc** `edge-lib.sh` (`s2_names community`), `gen-env.sh` (`P_CM`/`T_CM`), `tools/scripts/src/s2-app-urls.ts` (+ test), `enable-domain.sh` (`HOSTS`) rồi build lại web (URL nhúng lúc build).

**Bước thủ công của người dùng (kit không làm được):**
1. **DNS:** tạo bản ghi `community.<domain>` (và `community-test.<domain>` nếu dùng test) trỏ về 149.202.83.5 (như 4 host hiện có, hoặc wildcard nếu có).
2. **Cert TLS:** cert `evoluconsulting` hiện chỉ phủ 4 tên (sohoptac, ai, ai-admin, ai-hub + `-test`) — KHÔNG phủ tên mới. Phải cấp lại/mở rộng cert (certbot `--expand` hoặc wildcard) cho host community trên host nginx, rồi reload nginx host, TRƯỚC khi mở tên mới cho người dùng. Kit không đụng cert/host nginx.
3. Chốt tên host (nếu khác mặc định) theo mục "Đổi tên host" ở trên.

**Thứ tự deploy (migrate TRƯỚC khi hub-api mới chạy):**
- Migration cần áp: admin **0028→0029**, kit **0006→0007**, community **0001→0004**, contracts **0066→0067**, hub **0063**. `setup.sh` đã làm đúng thứ tự: `tool packages/db/src/migrate.ts` (main + hub + packs gồm `community`) chạy trước `dc up -d … hub-api …`, nên hub-api mới chỉ start sau khi schema xong. Không `up -d hub-api` tay trước bước migrate.
1. (Sao lưu: `bash backup.sh` trước khi migrate.)
2. `deploy.ps1 -Domain evoluconsulting.com -Hosts prod` (hoặc `-Hosts test`): build lại web (có community-web) + `gen-env.sh` (thêm `S2_PORT_COMMUNITY`, `S2_PUBLIC_COMMUNITY_URL`, CORS) + `setup.sh`.
3. Sau khi DNS + cert xong: `bash enable-domain.sh` (hoặc `cutover.sh` nếu đang prod) để cài server community vào edge-proxy; rồi `s2-app-urls.ts --base-domain <domain> [--hosts prod] --apply` để hàng catalog `community` trỏ host https.

**Kiểm sau deploy:**
- `curl -sSI https://community[-test].<domain>/` = 200; `/sso` và route sâu cũng 200 (SPA fallback).
- Đối tác (partner) đăng nhập qua AI System → vào community-web, hiện hồ sơ (profile) và chuông thông báo (bell) hoạt động; Trợ lý giá (SSE `/conversations`, `/runs`) chạy không bị cắt.
- Đối tác bị **403** ở các app khác (contracts-web, admin-web, chat-web, Studio) — kiểm bằng tài khoản partner.
- Người nội bộ vẫn đăng nhập contracts/chat/admin bình thường; log hub-api không lỗi `community` sweep.

**Hoàn tác:** (a) chỉ tắt app: `bash disable-domain.sh` hoặc gỡ server community khỏi `sohoptac2.conf` + reload edge; đặt `COMMUNITY_SWEEP=off` trong `.env` rồi `up -d hub-api`. (b) Về bản trước: `deploy.ps1 -Ref <commit cũ>` — nhưng migration KHÔNG tự lùi: schema mới (cột/bảng thêm) tương thích ngược với hub/admin cũ; chỉ khôi phục DB từ `backup.sh` (`restore-test.sh` để thử trước) khi thật cần. Partner chưa có phiên community nên không ảnh hưởng người dùng nội bộ.