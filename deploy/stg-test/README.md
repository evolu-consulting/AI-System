# stg-test — STAGING that cho ten mien `-test`, CO LAP khoi prod `sohoptac2`

Chay tren cung may `149.202.83.5` nhung la mot stack rieng; chi 4 host `-test` tro vao day, 4 host prod giu nguyen.

| Muc | Gia tri |
|---|---|
| Project Docker | `sohoptac2-staging` (mang `sohoptac2-staging_default`, container `sohoptac2-staging-*`) |
| Image | `sohoptac2-app:staging`, `sohoptac2-web:staging` — **khong bao gio `:latest`** (prod nhan `:latest` o lan restart sau) |
| Cong (127.0.0.1) | `28541` web gop (app-test) · `28542` admin · `28543` chat · `28544` hub/Studio |
| Du lieu | volume ten **ben**: `pgdata`, `redisdata`, `fbdata`, `fbminio` (+ `./data/attachments`); song qua restart/up. Bi mat sinh moi (`gen-env.sh`), khong copy gi cua prod |
| Dung lai (chi doc) | `sohoptac2-filebox:latest`, `sohoptac2-runtime:latest`, mot file `minio-bin/minio`; `down.sh` khong xoa |
| URL | https://app-test.evoluconsulting.com (web gop) · https://ai-test… · https://ai-test-admin… · https://ai-test-hub… |
| Cau hinh | `APP_ENV=development` (de seed fixture), `ESIGN_PROVIDERS=selfsign`, `HUB_NOTIFY_MODE=off` + khong SMTP ⇒ **khong gui mail that**; khong DocuSign; khong Claude CLI ⇒ chat AI that khong chay |
| Thu muc tren host | `~/workspace/sohoptac2-staging` |

## Cap nhat (build → up)
```
# 1) may dev: day ma + kit (khong build/chay gi)
powershell -File deploy/stg-test/push.ps1 -Ref platform/gd0 [-DryRun]
# 2) tren host
cd ~/workspace/sohoptac2-staging
bash build.sh      # hai image :staging tu build/app (tu choi neu image khong phai :staging)
bash up.sh         # gen-env (mot lan) -> pg/redis/filebox -> migrate -> ALTER ROLE -> seed platform -> seed hub -> stg-seed (tenant demo) -> seed.tenant-fixtures -> api/web -> /health
bash edge.sh       # CHI LAN DAU (idempotent): tro host -test vao stack nay
bash verify.sh     # SQL: tenant demo co «Quy trinh mua hang» + thanh vien nhom duyet
```
Cap nhat ban moi: push → `build.sh` → `up.sh` (khong can lai `edge.sh`, tru khi `edge-proxy` bi recreate: chay lai `edge.sh` de noi lai mang).
`--dry-run` o build/up/edge/rollback chi in lenh.

Mat khau tai khoan: `ADMIN.pw` (platform admin `admin`), `DEMO_OWNER.pw` (`demo-owner`) trong thu muc kit (600); doi tac demo trong `out/partners.json`. Doc bang `cat` tren host, khong dan vao chat/commit.

## Edge (edge.sh) va hoan tac (rollback.sh)
`edge.sh` chi dung 2 file trong `~/workspace/github/edge-proxy/conf.d/`:
- `sohoptac2.conf`: **sao luu** vao `edge-backup/sohoptac2.conf.<timestamp>` (duong dan ghi o `edge-backup/PRE_STAGING`), roi chi go ten `-test` khoi dong `server_name` (ten prod, upstream `sohoptac2-web-1`, moi dong khac giu nguyen).
- `sohoptac2-staging.conf` (moi): 4 khoi `-test` → `sohoptac2-staging-web-1:808x`. Ten map/log_format co tien to `s2stg_`.
- `docker network connect sohoptac2-staging_default edge-proxy` (runtime; `docker-compose.yml` cua edge KHONG bi sua).
- `nginx -t` truoc, chi khi OK moi `reload`; loi ⇒ khoi phuc ca hai file. TLS: wildcard o host nginx, khong doi.

**Hoan tac**: `bash rollback.sh [--disconnect]` — tra `sohoptac2.conf` ve ban sao luu, go `sohoptac2-staging.conf`, `nginx -t`, reload ⇒ host `-test` lai tro vao prod `sohoptac2-web-1`. Staging van chay (chi het nhan luu luong).

Luu y: `deploy/prod-sohoptac2/enable-domain.sh` / `cutover.sh` ve lai `sohoptac2.conf` voi ten `-test` ⇒ se **trung server_name** voi `sohoptac2-staging.conf` (enable-domain tu choi vi phat hien trung o conf khac). Truoc khi chay chung: `bash rollback.sh`.

## Dung / xoa
`bash down.sh` dung stack, giu du lieu (host `-test` tra 502 cho den khi `up.sh`; hoac `rollback.sh` truoc). Xoa han: `bash down.sh --purge --yes-delete-staging-data` (down -v + xoa 2 image :staging).
**Khong** `docker image prune -a` / `docker system prune` tren host (xoa image prod).

## Chong nham prod (tu kiem)
- Ten project + tag co dinh trong `lib.sh` (khong doc env); `guard_tag` thoat khi gap `:latest`; `build.sh` so `docker compose config --images` phai dung hai image staging.
- Cong chi `127.0.0.1:2854x`; khong mount `claude-home`, `.env` hay volume prod.
- `stg-seed.ts` tu choi khi `APP_ENV=production` hoac `.env` khong co `S2_STACK=stg-test` + admin URL `https://ai-test-admin.*`.
