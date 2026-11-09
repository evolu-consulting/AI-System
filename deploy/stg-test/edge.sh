#!/usr/bin/env bash
# sohoptac2-staging · tro CHI 4 host -test vao stack staging qua edge-proxy (chay TREN may chu, idempotent). Ten prod (app./ai./ai-admin./ai-hub.) van tro vao sohoptac2-web-1.
# Lam DUNG cac viec sau (chi cham 2 file trong edge-proxy/conf.d: sohoptac2.conf va sohoptac2-staging.conf):
#   1. kiem staging len (web 28544 /health) va khong conf khac khai bao ten -test
#   2. sao luu sohoptac2.conf (co dau thoi gian) vao ./edge-backup/ + ghi duong dan vao edge-backup/PRE_STAGING (rollback.sh dung)
#   3. docker network connect sohoptac2-staging_default edge-proxy (runtime, khong recreate; chay lai edge.sh/up.sh neu edge-proxy bi recreate)
#   4. go ten -test khoi dong server_name cua sohoptac2.conf (KHONG sua gi khac) + chep edge/sohoptac2-staging.conf
#   5. nginx -t trong edge-proxy; chi khi OK moi `nginx -s reload` (graceful). Loi => khoi phuc ca hai file, exit != 0.
#   bash edge.sh [--dry-run]
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
SRC=edge/sohoptac2-staging.conf
PROD_CONF="$EDGE_DIR/conf.d/sohoptac2.conf"; STG_CONF="$EDGE_DIR/conf.d/sohoptac2-staging.conf"
HOSTS="app-test ai-test ai-test-admin ai-test-hub"
BASE_RE="${BASE//./\\.}"
[[ "$BASE" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || { echo "edge: base domain khong hop le: $BASE"; exit 2; }
[ -f "$SRC" ] || { echo "edge: thieu $SRC"; exit 2; }
[ -f "$PROD_CONF" ] || { echo "edge: thieu $PROD_CONF"; exit 2; }
docker inspect "$EDGE_CTR" >/dev/null 2>&1 || { echo "edge: container $EDGE_CTR khong ton tai"; exit 2; }
if [ "$DRY" = 1 ]; then
  echo "[dry-run] kiem sohoptac2-staging-web-1 + /health :28544"
  echo "[dry-run] sao luu $PROD_CONF -> edge-backup/sohoptac2.conf.<ts>; go ten -test ($HOSTS).$BASE khoi server_name; chep $SRC -> $STG_CONF"
  echo "[dry-run] docker network connect $NET $EDGE_CTR ; nginx -t ; nginx -s reload"
  exit 0
fi
docker inspect -f '{{.State.Running}}' "${PROJECT}-web-1" 2>/dev/null | grep -q true || { echo "edge: ${PROJECT}-web-1 chua chay (bash up.sh truoc)"; exit 2; }
curl -fsS --max-time 5 http://127.0.0.1:28544/health >/dev/null || { echo "edge: http://127.0.0.1:28544/health chua OK"; exit 2; }
for h in $HOSTS; do
  other="$(grep -lE "server_name[^;]*[[:space:]]$h\\.$BASE_RE([[:space:];])" "$EDGE_DIR"/conf.d/*.conf 2>/dev/null | grep -vE '/sohoptac2(-staging)?\.conf$' || true)"
  [ -z "$other" ] || { echo "edge: $h.$BASE da duoc khai bao o: $other - dung lai"; exit 2; }
done

mkdir -p edge-backup
ts="$(date +%Y%m%d-%H%M%S)"
had_test=0; for h in $HOSTS; do grep -qE "server_name[^;]*[[:space:]]$h\\.$BASE_RE([[:space:];])" "$PROD_CONF" && had_test=1; done
if [ "$had_test" = 1 ]; then
  cp -p "$PROD_CONF" "edge-backup/sohoptac2.conf.$ts"
  echo "$PWD/edge-backup/sohoptac2.conf.$ts" > edge-backup/PRE_STAGING
  echo "edge: da sao luu $PROD_CONF -> edge-backup/sohoptac2.conf.$ts"
else
  echo "edge: $PROD_CONF da het ten -test (giu sao luu cu: $(cat edge-backup/PRE_STAGING 2>/dev/null || echo 'KHONG CO'))"
fi

# Dua ve trang thai cu neu nginx -t loi.
undo() {
  if [ "$had_test" = 1 ]; then cp -p "edge-backup/sohoptac2.conf.$ts" "$PROD_CONF"; fi
  rm -f "$STG_CONF"
}

if ! docker network inspect "$NET" -f '{{range .Containers}}{{.Name}} {{end}}' | tr ' ' '\n' | grep -qx "$EDGE_CTR"; then
  docker network connect "$NET" "$EDGE_CTR"; echo "edge: da noi $EDGE_CTR vao $NET (runtime)"
else echo "edge: $EDGE_CTR da noi $NET"; fi

# go ten -test khoi server_name cua sohoptac2.conf (chi dong server_name; ten prod va moi dong khac nguyen ven)
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
cp "$PROD_CONF" "$tmp"
for h in $HOSTS; do sed -i -E "/^[[:space:]]*server_name/ s/[[:space:]]+$h\\.$BASE_RE([[:space:];])/\\1/g" "$tmp"; done
# moi khoi server van phai con dung 1 ten prod; khong dong server_name trong
[ "$(grep -cE '^[[:space:]]*server_name[[:space:]]+[^;[:space:]]+;[[:space:]]*$' "$tmp")" = "$(grep -cE '^[[:space:]]*server_name' "$tmp")" ] || { echo "edge: sau khi go ten -test, server_name khong con dung 1 ten/khoi:"; grep -n server_name "$tmp"; exit 3; }
grep -qE "[[:space:]](app|ai|ai-admin|ai-hub)\\.$BASE_RE;" "$tmp" || { echo "edge: mat ten prod?"; grep -n server_name "$tmp"; exit 3; }
if grep -E '^[[:space:]]*server_name' "$tmp" | grep -qE "(app|ai)-test"; then echo "edge: van con ten -test trong server_name:"; grep -n server_name "$tmp"; exit 3; fi
[ "$had_test" = 1 ] && cp "$tmp" "$PROD_CONF"
sed -e "s/__BASE__/$BASE/g" "$SRC" > "$STG_CONF"

if docker exec "$EDGE_CTR" nginx -t; then
  docker exec "$EDGE_CTR" nginx -s reload
  echo "edge: nginx reload OK - host -test -> $PROJECT ; ten prod khong doi"
else
  undo; echo "edge: nginx -t LOI - da khoi phuc conf cu (chua reload)"; exit 1
fi
echo "--- kiem tra:"
for h in $HOSTS; do echo "curl -sSI -o /dev/null -w '$h.$BASE %{http_code}\\n' https://$h.$BASE/"; done
echo "curl -sS https://ai-test-hub.$BASE/health ; curl -sS https://ai-hub.$BASE/health"
