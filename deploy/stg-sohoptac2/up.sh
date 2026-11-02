#!/usr/bin/env bash
# sohoptac2-stg · dung staging tu image prod (xem docker-compose.yml). CHI project `sohoptac2-stg`, thu muc nay. Idempotent den muc co the;
# dung lai tu dau: bash down.sh && bash up.sh. Khong doc/ghi gi cua project `sohoptac2`, tru chep MOT file nhi phan minio (chi doc) neu thieu.
set -euo pipefail
cd "$(dirname "$0")"
dc() { docker compose -p sohoptac2-stg "$@"; }
envv() { grep -m1 "^$1=" .env | cut -d= -f2-; }
pw_of() { envv "$1" | sed -E 's#^postgres://[^:]+:([^@]+)@.*#\1#'; }
bash ./gen-env.sh
[ -x minio-bin/minio ] || { mkdir -p minio-bin; cp -p "$HOME/workspace/sohoptac2/minio-bin/minio" minio-bin/minio; }
# tu choi neu cong stg dang bi chiem (khong de lan sang cong khac)
for k in CONTRACTS ADMIN CHAT HUB COMMUNITY; do
  p=$(envv S2_PORT_$k)
  if ss -ltn | awk '{print $4}' | grep -q ":$p$" && ! dc ps --format '{{.Service}}' 2>/dev/null | grep -q web; then echo "up: cong $p dang bi chiem"; exit 3; fi
done
dc up -d --wait pg redis filebox
dc run --rm -T tool packages/db/src/migrate.ts
dc exec -T pg psql -v ON_ERROR_STOP=1 -q -U s2_owner -d ai_system \
  -v p1="$(pw_of ADMIN_API_DATABASE_URL)" -v p2="$(pw_of HUB_DATABASE_URL)" -v p3="$(pw_of AGENT_RT_DATABASE_URL)" <<'SQL'
ALTER ROLE admin_api WITH LOGIN PASSWORD :'p1';
ALTER ROLE hub_api WITH LOGIN PASSWORD :'p2';
ALTER ROLE agent_runtime WITH LOGIN PASSWORD :'p3';
SQL
SEED_ADMIN_PASSWORD="$(cat ADMIN.pw)"; export SEED_ADMIN_PASSWORD
dc run --rm -T -e SEED_ADMIN_PASSWORD tool packages/db/src/seed.ts
unset SEED_ADMIN_PASSWORD
dc run --rm -T tool apps/hub-api/src/modules/seed/seed.ts
dc run --rm -T tool tools/scripts/src/stg-seed.ts
dc up -d --remove-orphans admin-api hub-api agent-runtime web
ok=0
for i in $(seq 1 60); do
  if dc exec -T admin-api bun -e "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null \
    && dc exec -T hub-api bun -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then ok=1; break; fi
  sleep 2
done
[ $ok -eq 1 ] && echo "up: admin-api + hub-api /health OK" || echo "up: /health CHUA len - xem docker compose -p sohoptac2-stg logs"
dc ps --format '{{.Service}}: {{.Status}}'