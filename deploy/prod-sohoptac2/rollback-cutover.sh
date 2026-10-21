#!/usr/bin/env bash
# sohoptac2 - hoan tac cutover.sh (chay TREN may chu, idempotent): khoi phuc edge-proxy conf.d tu ban sao luu goc
# (bat lai aisystem.conf + sohoptac.conf, go sohoptac2.conf ve ban truoc cutover), nginx -t roi reload.
#   bash rollback-cutover.sh
set -euo pipefail
cd "$(dirname "$0")"
EDGE_DIR="${EDGE_DIR:-$HOME/workspace/github/edge-proxy}"
EDGE_CTR="${EDGE_CTR:-edge-proxy}"
CONFD="$EDGE_DIR/conf.d"
MARK="$EDGE_DIR/.s2-cutover-backup"
. ./edge-lib.sh

[ -f "$MARK" ] || { echo "rollback-cutover: khong co marker $MARK (chua cutover hoac da hoan tac)"; exit 0; }
BAK="$(cat "$MARK")"
[ -d "$BAK" ] || { echo "rollback-cutover: ban sao luu $BAK khong ton tai"; exit 2; }

cur="$(mktemp -d)"; cp -a "$CONFD"/. "$cur"/
s2_restore_confd "$BAK" "$CONFD"
if docker exec "$EDGE_CTR" nginx -t; then
  docker exec "$EDGE_CTR" nginx -s reload
  rm -f "$MARK"; rm -rf "$cur"
  echo "rollback-cutover: da khoi phuc tu $BAK, nginx reload OK"
else
  s2_restore_confd "$cur" "$CONFD"; rm -rf "$cur"
  echo "rollback-cutover: nginx -t LOI sau khi khoi phuc - da dua conf.d ve trang thai truoc khi chay"; exit 1
fi
echo "curl -sSI https://sohoptac.${S2_BASE_DOMAIN:-evoluconsulting.com}/ | head -n1   # app cu"
