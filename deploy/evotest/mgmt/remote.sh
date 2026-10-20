#!/usr/bin/env bash
# I1 · chạy TRÊN máy chủ (run.ps1 gọi qua ssh, đã giữ khoá ~/workspace/evotest/.lock ⇒ không chồng ngân sách với evotest).
# Chỉ đụng ~/workspace/evotest-mgmt và project Docker `evotest-mgmt`; KHÔNG đụng sohoptac-* (container/volume/mạng).
# Dùng: remote.sh <tag> <mgmt commit>. Dọn khi thoát: down -v, xoá thư mục tạm, xoá image api đã build.
set -uo pipefail
TAG="$1"; MCOMMIT="$2"
export MGMT_INTO_TENANT="${3:-}"   # niti-onboard: key tenant (deploy/tenants/<key>.yaml) ⇒ onboarding + --into-tenant
D="$HOME/workspace/evotest-mgmt"
mkdir -p "$D" && cd "$D" || exit 2
export EVO_UID=$(id -u) EVO_GID=$(id -g) MGMT_COMMIT="$MCOMMIT" MGMT_NEO4J_PW="$(head -c 18 /dev/urandom | base64 | tr -dc A-Za-z0-9)"
DC=(docker compose -p evotest-mgmt --profile mgmt)

cleanup() {
  "${DC[@]}" down -v --remove-orphans >/dev/null 2>&1
  docker image rm "evotest-mgmt-api:$MGMT_COMMIT" >/dev/null 2>&1
  docker run --rm -v "$D:/w" --entrypoint sh evotest-runner:bun-1.3.14 -c 'rm -rf /w/app /w/data /w/mgmt-api' >/dev/null 2>&1
  rm -rf "$D/app" "$D/data" "$D/mgmt-api"
}
trap cleanup EXIT

free_gb=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
[ "$free_gb" -ge 45 ] || { echo "đĩa còn $free_gb GB (<45) - dừng"; exit 4; }
rm -rf app data mgmt-api out; mkdir -p app data/contract_files mgmt-api out
chmod 1777 data
tar xzf "/tmp/evotest-mgmt-app-$TAG.tgz" -C app && tar xzf "/tmp/evotest-mgmt-api-$TAG.tgz" -C mgmt-api || { echo "giải nén lỗi"; exit 2; }
unlink "/tmp/evotest-mgmt-app-$TAG.tgz"; unlink "/tmp/evotest-mgmt-api-$TAG.tgz"
cp app/deploy/evotest/mgmt/docker-compose.yml app/deploy/evotest/mgmt/seed-plus.py app/deploy/evotest/mgmt/in-runner.sh .
echo "[mgmt] đĩa trống $free_gb GB · mgmt-app $MCOMMIT"

t0=$(date +%s)
"${DC[@]}" build -q mgmt-api >/dev/null || { echo "build api lỗi"; exit 2; }
"${DC[@]}" up -d --wait mgmt-opensearch mgmt-neo4j mgmt-api >/dev/null || { echo "dựng mgmt lỗi"; "${DC[@]}" logs --tail 40; exit 2; }
echo "[mgmt] mgmt-app chạy · $(( $(date +%s) - t0 )) s"
t1=$(date +%s)
for owner in tien@annam.test hai@binhminh.test; do
  "${DC[@]}" exec -T -e SEED_PASSWORD="$MGMT_NEO4J_PW" mgmt-api nice -n 19 python -m app.seed.demo --owner "$owner" --create --today 2026-10-20 || exit 2
done
"${DC[@]}" exec -T -e SEED_PASSWORD="$MGMT_NEO4J_PW" -e PYTHONPATH=/app mgmt-api nice -n 19 python /seed/seed-plus.py tien@annam.test || exit 2
echo "[mgmt] seed xong · $(( $(date +%s) - t1 )) s"
"${DC[@]}" exec -T mgmt-api python -c "from app.store import opensearch as o; c=o.client(); print({i: c.count(index=i)['count'] for i in ['orgs','users','memberships','contracts','obligations','partner_events','cks_lots','cks_certificates','signed_docs','companies','documents','chunks']})"

KORG=$("${DC[@]}" exec -T mgmt-api python -c "from app import orgs; print((orgs.membership('tien@annam.test') or {}).get('org_id', ''))" | tr -d '\r\n')
export MGMT_KNOWLEDGE_ORG="$KORG"
"${DC[@]}" up -d --wait mgmt-pg >/dev/null || exit 2
"${DC[@]}" run --rm mgmt-runner; rc=$?
echo "[mgmt] importer: exit $rc · tổng $(( $(date +%s) - t0 )) s"
"${DC[@]}" stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' 2>/dev/null | head -6
tar czf "/tmp/evotest-mgmt-out-$TAG.tgz" -C out . 2>/dev/null
exit $rc
