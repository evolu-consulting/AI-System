#!/usr/bin/env bash
# sohoptac2 - go 4 hostname thu nghiem khoi edge-proxy (chay TREN may chu, idempotent). Hoan tac enable-domain.sh.
#   bash disable-domain.sh
# Go conf.d/sohoptac2.conf, nginx -t + reload graceful, go mang khoi docker-compose.yml neu co ban sao luu cua enable-domain.sh
# (khong co ban sao => khong dong vao compose), va ngat mang runtime. Khong dung conf/app khac.
set -euo pipefail
EDGE_DIR="${EDGE_DIR:-$HOME/workspace/github/edge-proxy}"
EDGE_CTR="${EDGE_CTR:-edge-proxy}"
S2_NET="${S2_NET:-sohoptac2_default}"
DST="$EDGE_DIR/conf.d/sohoptac2.conf"
COMPOSE="$EDGE_DIR/docker-compose.yml"

if [ -f "$DST" ]; then
  mv "$DST" "$DST.removed"
  if docker exec "$EDGE_CTR" nginx -t; then
    docker exec "$EDGE_CTR" nginx -s reload
    rm -f "$DST.removed"
    echo "disable-domain: da go $DST, nginx reload OK"
  else
    mv "$DST.removed" "$DST"
    echo "disable-domain: nginx -t LOI sau khi go conf - da giu nguyen conf"; exit 1
  fi
else
  echo "disable-domain: $DST khong ton tai"
fi

# Compose: chi hoan tac khi chinh enable-domain.sh da sao luu (so khop se khong lam hong thay doi tay khac).
if [ -f "$COMPOSE.bak-sohoptac2" ] && grep -q "$S2_NET" "$COMPOSE"; then
  cp -p "$COMPOSE" "$COMPOSE.before-disable"
  cp -p "$COMPOSE.bak-sohoptac2" "$COMPOSE"
  echo "disable-domain: da khoi phuc $COMPOSE tu ban sao luu (ban hien tai: $COMPOSE.before-disable)"
fi
if docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$EDGE_CTR" | tr ' ' '\n' | grep -qx "$S2_NET"; then
  docker network disconnect "$S2_NET" "$EDGE_CTR"
  echo "disable-domain: da ngat $EDGE_CTR khoi $S2_NET"
fi
echo "disable-domain: xong. Cac app khac cua edge-proxy khong bi dong vao."
