#!/usr/bin/env bash
# sohoptac2-staging · dung/cap nhat STAGING (project `sohoptac2-staging`, image tag staging, cong 127.0.0.1:28541..28544, DU LIEU BEN trong volume ten).
# KHONG dung project `sohoptac2`: chi chep MOT file nhi phan minio (chi doc) neu thieu. Idempotent: chay lai sau build.sh de cap nhat ban moi (migrate + seed
# idempotent). Seed = cung duong voi stg-sohoptac2/up.sh: migrate -> ALTER ROLE -> platform seed -> hub seed -> stg-seed (tenant demo) -> seed.tenant-fixtures.
# Sau up: bash edge.sh (tro host -test vao stack nay) neu chua lam; bash verify.sh de kiem tenant demo.
#   bash up.sh [--dry-run]
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
envv() { grep -m1 "^$1=" .env | cut -d= -f2-; }
pw_of() { envv "$1" | sed -E 's#^postgres://[^:]+:([^@]+)@.*#\1#'; }
PORTS="28541 28542 28543 28544"
if [ "$DRY" = 1 ]; then
  echo "[dry-run] cong: $PORTS (127.0.0.1) · project $PROJECT · image $IMG_APP $IMG_WEB"
  bash ./gen-env.sh --dry-run
else
  bash ./gen-env.sh
  docker image inspect "$IMG_APP" "$IMG_WEB" >/dev/null 2>&1 || { echo "up: thieu image $IMG_APP/$IMG_WEB - chay build.sh"; exit 3; }
  [ -x minio-bin/minio ] || { mkdir -p minio-bin; cp -p "$HOME/workspace/sohoptac2/minio-bin/minio" minio-bin/minio; }
  # tu choi neu cong dang bi chiem boi cai KHAC (khong phai web cua chinh project nay)
  for p in $PORTS; do
    if ss -ltn | awk '{print $4}' | grep -q ":$p$" && ! dc ps --format '{{.Service}}' 2>/dev/null | grep -q web; then echo "up: cong $p dang bi chiem"; exit 3; fi
  done
  export S2_APP_VERSION="$(cat REF 2>/dev/null || echo staging)"
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
# CR-125 cr125-seed (D7): cau hinh cong ty du tron SAU khi tenant demo + goi da co (nhom duyet, quy trinh mua hang 11 buoc, co flow_triggers)
run dc run --rm -T tool apps/hub-api/src/modules/seed/seed.tenant-fixtures.ts
run dc up -d --remove-orphans admin-api hub-api agent-runtime web
if [ "$DRY" = 1 ]; then
  echo "[dry-run] cho admin-api + hub-api /health; s2-app-urls.ts --apply (hang catalog: url https -test)"
  exit 0
fi
ok=0
for i in $(seq 1 60); do
  if dc exec -T admin-api bun -e "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null \
    && dc exec -T hub-api bun -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then ok=1; break; fi
  sleep 2
done
[ $ok -eq 1 ] && echo "up: admin-api + hub-api /health OK" || { echo "up: /health CHUA len - xem docker compose -p $PROJECT logs"; exit 5; }
# hang app_catalog: URL https -test (idempotent; cung script prod s2-app-urls.ts).
# --community-url chi doi hang community; cac hang con lai (contracts/admin/chat/studio) can --base-domain, thieu thi nut chuyen app tro localhost.
base=$(envv S2_PUBLIC_ADMIN_URL | sed -E 's#^https://ai-test-admin\.##; s#/.*$##')
dc run --rm -T tool tools/scripts/src/s2-app-urls.ts --base-domain "$base" --hosts test --apply || echo "up: CANH BAO s2-app-urls (base) loi (khong chan)"
dc run --rm -T tool tools/scripts/src/s2-app-urls.ts --community-url "$(envv S2_PUBLIC_COMMUNITY_URL)" --apply || echo "up: CANH BAO s2-app-urls loi (khong chan)"
echo "up: kiem nhanh:"
echo "  /community fallback (cong noi bo): $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:28541/community/profile/x/y) (mong 200)"
dc ps --format '{{.Service}}: {{.Status}}'
