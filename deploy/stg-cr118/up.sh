#!/usr/bin/env bash
# sohoptac2-cr118 · dung UAT CR-118 (project `sohoptac2-cr118`, image tag cr118, cong 127.0.0.1:28531..28535, DB/Redis/FileBox tmpfs). KHONG dung
# project `sohoptac2`: chi chep MOT file nhi phan minio (chi doc) neu thieu. Truy cap qua SSH tunnel (README). Dung lai: bash down.sh && bash up.sh.
#   bash up.sh [--dry-run]     (--dry-run: in ke hoach, khong goi docker, khong ghi file)
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
envv() { grep -m1 "^$1=" .env | cut -d= -f2-; }
pw_of() { envv "$1" | sed -E 's#^postgres://[^:]+:([^@]+)@.*#\1#'; }
PORTS="28531 28532 28533 28534 28535"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] cong: $PORTS (127.0.0.1) · project $PROJECT · image $IMG_APP $IMG_WEB"
  bash ./gen-env.sh --dry-run
else
  bash ./gen-env.sh
  # chi chay khi image cr118 da co (build.sh); tuyet doi khong keo/dung :latest cua app/web.
  docker image inspect "$IMG_APP" "$IMG_WEB" >/dev/null 2>&1 || { echo "up: thieu image $IMG_APP/$IMG_WEB - chay build.sh"; exit 3; }
  [ -x minio-bin/minio ] || { mkdir -p minio-bin; cp -p "$HOME/workspace/sohoptac2/minio-bin/minio" minio-bin/minio; }
  # tu choi neu cong UAT dang bi chiem boi cai khac (khong de lan sang cong khac)
  for p in $PORTS; do
    if ss -ltn | awk '{print $4}' | grep -q ":$p$" && ! dc ps --format '{{.Service}}' 2>/dev/null | grep -q web; then echo "up: cong $p dang bi chiem"; exit 3; fi
  done
fi
run dc up -d --wait pg redis filebox
run dc run --rm -T tool packages/db/src/migrate.ts
if [ "$DRY" = 1 ]; then
  echo "[dry-run] ALTER ROLE admin_api/hub_api/agent_runtime LOGIN PASSWORD <tu .env> (psql trong pg)"
else
  dc exec -T pg psql -v ON_ERROR_STOP=1 -q -U s2_owner -d ai_system \
    -v p1="$(pw_of ADMIN_API_DATABASE_URL)" -v p2="$(pw_of HUB_DATABASE_URL)" -v p3="$(pw_of AGENT_RT_DATABASE_URL)" <<'SQL'
ALTER ROLE admin_api WITH LOGIN PASSWORD :'p1';
ALTER ROLE hub_api WITH LOGIN PASSWORD :'p2';
ALTER ROLE agent_runtime WITH LOGIN PASSWORD :'p3';
SQL
  SEED_ADMIN_PASSWORD="$(cat ADMIN.pw)"; export SEED_ADMIN_PASSWORD
  dc run --rm -T -e SEED_ADMIN_PASSWORD tool packages/db/src/seed.ts
  unset SEED_ADMIN_PASSWORD
fi
run dc run --rm -T tool apps/hub-api/src/modules/seed/seed.ts
run dc run --rm -T tool tools/scripts/src/stg-seed.ts
run dc up -d --remove-orphans admin-api hub-api agent-runtime web
if [ "$DRY" = 1 ]; then
  echo "[dry-run] cho admin-api + hub-api /health; roi s2-app-urls.ts --community-url http://127.0.0.1:28531/community --apply (hang catalog community: url /community, sso=false)"
  echo "[dry-run] kiem: curl 127.0.0.1:28531/community/x (200 SPA) · curl 127.0.0.1:28535/ (301 -> http://127.0.0.1:28531/community; tunnel: cong ...5 -> ...1)"
  exit 0
fi
ok=0
for i in $(seq 1 60); do
  if dc exec -T admin-api bun -e "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null \
    && dc exec -T hub-api bun -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then ok=1; break; fi
  sleep 2
done
[ $ok -eq 1 ] && echo "up: admin-api + hub-api /health OK" || { echo "up: /health CHUA len - xem docker compose -p $PROJECT logs"; exit 5; }
# CR-118: hang catalog community = <SHT>/community, sso=false (idempotent; cung script prod s2-app-urls.ts).
dc run --rm -T tool tools/scripts/src/s2-app-urls.ts --community-url http://127.0.0.1:28531/community --apply
echo "up: kiem nhanh:"
echo "  /community fallback : $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:28531/community/profile/x/y) (mong 200)"
echo "  community cu 301    : $(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' http://127.0.0.1:28535/) (mong 301 -> http://127.0.0.1:28531/community)"
dc ps --format '{{.Service}}: {{.Status}}'