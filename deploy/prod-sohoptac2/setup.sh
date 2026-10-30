#!/usr/bin/env bash
# sohoptac2 · chạy TRÊN máy chủ sau mỗi lần deploy (idempotent): DB → migrate (main + hub + packs: contracts, knowledge)
# → mật khẩu 3 role → seed platform admin → seed Hub (profile claude-sub-1) → chạy app → kiểm /health. Không nạp dữ liệu khách,
# không tạo tenant. Chỉ đụng project Docker "sohoptac2".
set -euo pipefail
cd "$(dirname "$0")"
dc() { docker compose -p sohoptac2 "$@"; }
envv() { grep -m1 "^$1=" .env | cut -d= -f2-; }
pw_of() { envv "$1" | sed -E 's#^postgres://[^:]+:([^@]+)@.*#\1#'; }

# CR-104: thư mục trạng thái cho hub-api (chỉ-đọc trong container; chủ = user chạy script = S2_UID). Không bí mật.
mkdir -p ops-status; chmod 755 ops-status
dc up -d --wait pg redis filebox
dc run --rm -T tool packages/db/src/migrate.ts
# Production không áp migration dev ⇒ 3 role ứng dụng chưa có mật khẩu đăng nhập.
dc exec -T pg psql -v ON_ERROR_STOP=1 -q -U s2_owner -d ai_system \
  -v p1="$(pw_of ADMIN_API_DATABASE_URL)" -v p2="$(pw_of HUB_DATABASE_URL)" -v p3="$(pw_of AGENT_RT_DATABASE_URL)" <<'SQL'
ALTER ROLE admin_api WITH LOGIN PASSWORD :'p1';
ALTER ROLE hub_api WITH LOGIN PASSWORD :'p2';
ALTER ROLE agent_runtime WITH LOGIN PASSWORD :'p3';
SQL
# Platform admin: mật khẩu chỉ đọc từ ADMIN_CREDENTIALS.txt, truyền qua env của tiến trình (không nằm trên dòng lệnh).
SEED_ADMIN_PASSWORD="$(sed -n 's/^password: //p' ADMIN_CREDENTIALS.txt)"; export SEED_ADMIN_PASSWORD
dc run --rm -T -e SEED_ADMIN_PASSWORD tool packages/db/src/seed.ts
unset SEED_ADMIN_PASSWORD
dc run --rm -T tool apps/hub-api/src/modules/seed/seed.ts
dc up -d --remove-orphans filebox admin-api hub-api agent-runtime web

ok=0
for i in $(seq 1 60); do
  if dc exec -T admin-api bun -e "fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null \
    && dc exec -T hub-api bun -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then ok=1; break; fi
  sleep 2
done
[ $ok -eq 1 ] && echo "setup: admin-api + hub-api /health OK" || echo "setup: /health CHƯA lên — xem docker compose -p sohoptac2 logs"
bash ./ops-host-status.sh || echo "setup: ops-host-status.sh loi (khong chan deploy)"
dc ps --format '{{.Service}}: {{.Status}}'
