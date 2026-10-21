#!/usr/bin/env bash
# sohoptac2 - CUTOVER: chuyen 4 ten mien production sang stack moi (chay TREN may chu, idempotent). Xem README "Cutover".
#   bash cutover.sh [base-domain]
# Lam DUNG:
#   1. sao luu edge-proxy conf.d -> conf.d.bak-<ts> (chi lan dau; chay lai khi da cutover thi KHONG ghi de ban sao luu goc)
#   2. vo hieu hoa conf cu: aisystem.conf -> aisystem.conf.disabled, sohoptac.conf -> sohoptac.conf.disabled (doi ten, KHONG xoa;
#      container app cu giu nguyen, khong dung toi)
#   3. cai edge/sohoptac2.conf (server_name = ten prod + ten -test) thanh conf.d/sohoptac2.conf
#   4. docker exec edge-proxy nginx -t ; OK moi reload ; loi => khoi phuc ban sao luu, reload khong can, exit 1.
# Tien quyet: da chay enable-domain.sh (noi mang + compose) va deploy.ps1 -Hosts prod (build lai web voi URL prod).
set -euo pipefail
cd "$(dirname "$0")"
BASE="${1:-${S2_BASE_DOMAIN:-evoluconsulting.com}}"
EDGE_DIR="${EDGE_DIR:-$HOME/workspace/github/edge-proxy}"
EDGE_CTR="${EDGE_CTR:-edge-proxy}"
S2_NET="${S2_NET:-sohoptac2_default}"
S2_WEB="${S2_WEB:-sohoptac2-web-1}"
CONFD="$EDGE_DIR/conf.d"
MARK="$EDGE_DIR/.s2-cutover-backup"
OLD_CONFS="aisystem.conf sohoptac.conf"
. ./edge-lib.sh

[[ "$BASE" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || { echo "cutover: base-domain khong hop le: $BASE"; exit 2; }
[ -f edge/sohoptac2.conf ] || { echo "cutover: thieu edge/sohoptac2.conf (chay tu thu muc kit)"; exit 2; }
[ -d "$CONFD" ] || { echo "cutover: khong thay $CONFD (dat EDGE_DIR=...)"; exit 2; }
docker inspect "$EDGE_CTR" >/dev/null 2>&1 || { echo "cutover: container $EDGE_CTR khong ton tai"; exit 2; }
docker inspect -f '{{.State.Running}}' "$S2_WEB" 2>/dev/null | grep -q true || { echo "cutover: $S2_WEB chua chay"; exit 2; }
docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$EDGE_CTR" | tr ' ' '\n' | grep -qx "$S2_NET" \
  || { echo "cutover: $EDGE_CTR chua noi $S2_NET - chay enable-domain.sh truoc"; exit 2; }

# Cong listen: lay tu conf cu (hoac conf da bi vo hieu hoa o lan chay truoc), mac dinh 80.
LISTEN="$(cat "$CONFD"/aisystem.conf "$CONFD"/aisystem.conf.disabled 2>/dev/null | grep -m1 -oE '^[[:space:]]*listen[[:space:]]+[0-9.:]+' | awk '{print $2}' || true)"
LISTEN="${LISTEN:-80}"

# 1. Sao luu (chi khi con conf cu dang hoat dong, tuc chua cutover; marker tro toi ban sao luu goc).
need=""
for f in $OLD_CONFS; do [ -f "$CONFD/$f" ] && need=1; done
if [ -n "$need" ]; then
  BAK="$EDGE_DIR/conf.d.bak-$(date +%Y%m%d-%H%M%S)"
  cp -a "$CONFD" "$BAK"
  echo "$BAK" > "$MARK"
  echo "cutover: da sao luu $CONFD -> $BAK"
elif [ -f "$MARK" ]; then
  BAK="$(cat "$MARK")"
  echo "cutover: conf cu da vo hieu hoa tu truoc; giu ban sao luu goc $BAK"
else
  echo "cutover: khong thay aisystem.conf/sohoptac.conf va khong co ban sao luu - dung lai"; exit 2
fi

# 2 + 3. Vo hieu hoa conf cu, cai conf moi (ghi .new roi mv).
for f in $OLD_CONFS; do
  if [ -f "$CONFD/$f" ]; then mv "$CONFD/$f" "$CONFD/$f.disabled"; echo "cutover: $f -> $f.disabled"; fi
done
s2_render edge/sohoptac2.conf "$BASE" both "$LISTEN" > "$CONFD/sohoptac2.conf.new"
mv "$CONFD/sohoptac2.conf.new" "$CONFD/sohoptac2.conf"
echo "cutover: da cai $CONFD/sohoptac2.conf (base=$BASE, listen=$LISTEN)"

# 4. Kiem + reload; loi => khoi phuc.
if docker exec "$EDGE_CTR" nginx -t; then
  docker exec "$EDGE_CTR" nginx -s reload
  echo "cutover: nginx reload OK"
else
  s2_restore_confd "$BAK" "$CONFD"
  rm -f "$MARK"
  echo "cutover: nginx -t LOI - da khoi phuc conf.d tu $BAK (nginx dang chay van giu cau hinh cu)"
  exit 1
fi

echo "--- kiem tra:"
for h in sohoptac ai ai-admin ai-hub; do echo "curl -sSI -o /dev/null -w '$h.$BASE %{http_code}\\n' https://$h.$BASE/"; done
echo "curl -sS https://ai-hub.$BASE/health ; echo ; curl -sS https://ai-hub.$BASE/auth-health ; echo"
echo "curl -sSI https://sohoptac.$BASE/ | head -n1   # 200 = So Hop Tac moi"
echo "Hoan tac: bash rollback-cutover.sh"
