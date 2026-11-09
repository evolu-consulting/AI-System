#!/usr/bin/env bash
# sohoptac2-staging · HOAN TAC edge: tra sohoptac2.conf ve ban sao luu truoc edge.sh (host -test lai tro vao prod sohoptac2-web-1), go sohoptac2-staging.conf,
# nginx -t roi reload. Khong dung container/du lieu nao (staging van chay, chi het nhan luu luong). --disconnect: ngat edge-proxy khoi mang staging.
#   bash rollback.sh [--dry-run] [--disconnect]
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
PROD_CONF="$EDGE_DIR/conf.d/sohoptac2.conf"; STG_CONF="$EDGE_DIR/conf.d/sohoptac2-staging.conf"
DISC=0; for a in "$@"; do [ "$a" = "--disconnect" ] && DISC=1; done
bak="$(cat edge-backup/PRE_STAGING 2>/dev/null || true)"
[ -n "$bak" ] && [ -f "$bak" ] || { echo "rollback: khong co ban sao luu (edge-backup/PRE_STAGING) - chua tung chay edge.sh?"; exit 2; }
echo "rollback: khoi phuc $PROD_CONF <- $bak ; go $STG_CONF"
if [ "$DRY" = 1 ]; then echo "[dry-run] nginx -t ; nginx -s reload ; (disconnect=$DISC)"; exit 0; fi
cur="$(mktemp)"; trap 'rm -f "$cur"' EXIT
cp -p "$PROD_CONF" "$cur"; had_stg=0; [ -f "$STG_CONF" ] && had_stg=1
cp -p "$bak" "$PROD_CONF"; rm -f "$STG_CONF"
if docker exec "$EDGE_CTR" nginx -t; then
  docker exec "$EDGE_CTR" nginx -s reload
  echo "rollback: nginx reload OK - host -test tro lai prod"
else
  cp -p "$cur" "$PROD_CONF"; [ "$had_stg" = 1 ] && sed -e "s/__BASE__/$BASE/g" edge/sohoptac2-staging.conf > "$STG_CONF"
  echo "rollback: nginx -t LOI - da giu nguyen trang thai truoc khi hoan tac"; exit 1
fi
if [ "$DISC" = 1 ]; then docker network disconnect "$NET" "$EDGE_CTR" && echo "rollback: da ngat $EDGE_CTR khoi $NET"; fi
