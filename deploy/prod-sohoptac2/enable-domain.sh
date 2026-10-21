#!/usr/bin/env bash
# sohoptac2 - bat 4 hostname thu nghiem qua edge-proxy (chay TREN may chu, idempotent). Xem README "Domain thu nghiem".
#   bash enable-domain.sh [base-domain]        (mac dinh evoluconsulting.com; hoac S2_BASE_DOMAIN=...)
# Lam DUNG cac viec sau, khong dung conf/app khac:
#   1. chep edge/sohoptac2.conf -> $EDGE_DIR/conf.d/sohoptac2.conf (file moi duy nhat; __BASE__ -> base-domain)
#   2. docker network connect sohoptac2_default edge-proxy (runtime, khong recreate) neu chua noi
#   3. them mang vao $EDGE_DIR/docker-compose.yml (sao luu truoc, chi khi chua co) de ben vung qua `compose up`
#   4. docker exec edge-proxy nginx -t ; chi khi OK moi `nginx -s reload` (graceful). nginx -t loi => go conf moi, exit != 0.
set -euo pipefail
cd "$(dirname "$0")"
BASE="${1:-${S2_BASE_DOMAIN:-evoluconsulting.com}}"
EDGE_DIR="${EDGE_DIR:-$HOME/workspace/github/edge-proxy}"
EDGE_CTR="${EDGE_CTR:-edge-proxy}"
S2_NET="${S2_NET:-sohoptac2_default}"
S2_WEB="${S2_WEB:-sohoptac2-web-1}"
SRC="edge/sohoptac2.conf"
DST="$EDGE_DIR/conf.d/sohoptac2.conf"
HOSTS="ai2 sohoptac2 ai2-admin ai2-hub"

[[ "$BASE" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || { echo "enable-domain: base-domain khong hop le: $BASE"; exit 2; }
[ -f "$SRC" ] || { echo "enable-domain: thieu $SRC (chay tu thu muc kit)"; exit 2; }
[ -d "$EDGE_DIR/conf.d" ] || { echo "enable-domain: khong thay $EDGE_DIR/conf.d (dat EDGE_DIR=...)"; exit 2; }
docker inspect "$EDGE_CTR" >/dev/null 2>&1 || { echo "enable-domain: container $EDGE_CTR khong ton tai"; exit 2; }
docker inspect -f '{{.State.Running}}' "$S2_WEB" 2>/dev/null | grep -q true || { echo "enable-domain: $S2_WEB chua chay (deploy sohoptac2 truoc)"; exit 2; }

# Khong de trung server_name voi conf khac (chi doc).
for h in $HOSTS; do
  other="$(grep -lE "server_name[^;]*[[:space:]]$h\\.$BASE([[:space:];])" "$EDGE_DIR"/conf.d/*.conf 2>/dev/null | grep -v '/sohoptac2\.conf$' || true)"
  [ -z "$other" ] || { echo "enable-domain: $h.$BASE da duoc khai bao o: $other - dung lai"; exit 2; }
done

# Cong listen: theo conf hien co cua edge-proxy (mac dinh 80).
LISTEN="$(grep -h -m1 -oE '^[[:space:]]*listen[[:space:]]+[0-9.:\[\]]+' "$EDGE_DIR"/conf.d/aisystem.conf 2>/dev/null | head -n1 | awk '{print $2}' || true)"
LISTEN="${LISTEN:-80}"

prev=""
[ -f "$DST" ] && { prev="$(mktemp)"; cp -p "$DST" "$prev"; }
sed -e "s/__BASE__/$BASE/g" -e "s/listen 80;/listen $LISTEN;/" "$SRC" > "$DST.new"
mv "$DST.new" "$DST"
echo "enable-domain: da chep $DST (base=$BASE, listen=$LISTEN)"

# Noi mang (runtime, khong recreate edge-proxy).
if docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$EDGE_CTR" | tr ' ' '\n' | grep -qx "$S2_NET"; then
  echo "enable-domain: $EDGE_CTR da noi $S2_NET"
else
  docker network connect "$S2_NET" "$EDGE_CTR"
  echo "enable-domain: da noi $EDGE_CTR vao $S2_NET (runtime)"
fi

# Ben vung: them mang vao docker-compose.yml cua edge-proxy (sao luu, chi khi chua co).
COMPOSE="$EDGE_DIR/docker-compose.yml"
if [ -f "$COMPOSE" ] && ! grep -q "$S2_NET" "$COMPOSE"; then
  bak="$COMPOSE.bak-sohoptac2"
  [ -f "$bak" ] || cp -p "$COMPOSE" "$bak"
  awk -v net="$S2_NET" -v svc="$EDGE_CTR" '
    function indent(s) { match(s, /^ */); return RLENGTH }
    function blank(s) { return s ~ /^[ \t]*(#.*)?$/ }
    function flush_svc() { if (in_net && itemind != "") { printf "%s- %s\n", itemind, net; svc_done = 1 } in_net = 0 }
    function flush_top() { if (in_top && topind != "") { printf "%s%s:\n%s  name: %s\n%s  external: true\n", topind, net, topind, net, topind; top_done = 1 } in_top = 0 }
    {
      line = $0
      if (!blank(line)) {
        ind = indent(line)
        if (in_net && ind <= netind) flush_svc()
        if (in_svc && ind <= svcind) { flush_svc(); in_svc = 0 }
        if (in_top && ind == 0) flush_top()
      }
      if (!blank(line)) {
        if (line ~ /^services:/) in_services = 1
        else if (ind == 0) in_services = 0
        if (in_services && !in_svc && line ~ ("^ +" svc ":[ \t]*$")) { in_svc = 1; svcind = ind }
        else if (in_svc && !in_net && !svc_done && line ~ /^ +networks:[ \t]*$/) { in_net = 1; netind = ind; itemind = ""; mapstyle = 0 }
        else if (in_net) {
          if (line ~ /^ +- /) { itemind = substr(line, 1, ind) }
          else { mapstyle = 1; itemind = "" }
        }
        if (ind == 0 && line ~ /^networks:/) { in_top = 1; top_seen = 1; topind = "" }
        else if (in_top && topind == "") topind = substr(line, 1, ind)
      }
      print line
    }
    END {
      if (in_net) flush_svc()
      if (in_top) flush_top()
      else if (!top_seen && svc_done) printf "\nnetworks:\n  %s:\n    name: %s\n    external: true\n", net, net
    }
  ' "$COMPOSE" > "$COMPOSE.new"
  if [ "$(grep -c "$S2_NET" "$COMPOSE.new")" -ge 3 ] && (cd "$EDGE_DIR" && docker compose -f "$COMPOSE.new" config -q >/dev/null 2>&1); then
    mv "$COMPOSE.new" "$COMPOSE"
    echo "enable-domain: da them $S2_NET vao $COMPOSE (sao luu: $bak)"
  else
    rm -f "$COMPOSE.new"
    echo "enable-domain: CANH BAO - khong tu sua duoc $COMPOSE (dinh dang la). Them tay: service $EDGE_CTR networks += $S2_NET; networks: $S2_NET: {external: true}. Runtime da noi, nhung se mat khi recreate."
  fi
elif [ -f "$COMPOSE" ]; then
  echo "enable-domain: $COMPOSE da co $S2_NET"
fi

# Kiem + reload graceful.
if docker exec "$EDGE_CTR" nginx -t; then
  docker exec "$EDGE_CTR" nginx -s reload
  echo "enable-domain: nginx reload OK"
  [ -z "$prev" ] || rm -f "$prev"
else
  if [ -n "$prev" ]; then cp -p "$prev" "$DST"; rm -f "$prev"; echo "enable-domain: nginx -t LOI - da khoi phuc conf cu"; else rm -f "$DST"; echo "enable-domain: nginx -t LOI - da go $DST"; fi
  exit 1
fi

echo "--- kiem tra (qua host nginx + wildcard TLS):"
for h in $HOSTS; do echo "curl -sSI -o /dev/null -w '$h.$BASE %{http_code}\\n' https://$h.$BASE/"; done
echo "curl -sS https://ai2-hub.$BASE/health ; echo ; curl -sS https://ai2-hub.$BASE/auth-health ; echo"
echo "curl -sSI https://sohoptac2.$BASE/ | head -n1   # 200 = SPA contracts"
echo "(bat 4 host: nho chay 'S2_DOMAIN=$BASE' deploy/gen-env + build lai web de URL PUBLIC_* tro https; xem README)"
