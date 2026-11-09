# Dung chung cho build.sh / up.sh / down.sh / edge.sh (source). Project + tag co dinh: KHONG doc tu env de khong the tro nham sang prod.
PROJECT=sohoptac2-staging
IMG_APP=sohoptac2-app:staging
IMG_WEB=sohoptac2-web:staging
NET="${PROJECT}_default"
EDGE_DIR="${EDGE_DIR:-$HOME/workspace/github/edge-proxy}"
EDGE_CTR="${EDGE_CTR:-edge-proxy}"
BASE="${S2_BASE_DOMAIN:-evoluconsulting.com}"
DRY=0
for a in "$@"; do [ "$a" = "--dry-run" ] && DRY=1; done
dc() { docker compose -p "$PROJECT" "$@"; }
# run: --dry-run => chi in lenh se chay (khong goi docker, khong ghi gi).
run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }
# Chan cung: tag :latest cua image app/web = image PROD. Moi image minh dung/xoa phai la :staging.
guard_tag() { case "$1" in *:latest|*:) echo "${0##*/}: tu choi image '$1' (chi tag staging)"; exit 4;; esac; }
guard_tag "$IMG_APP"; guard_tag "$IMG_WEB"
