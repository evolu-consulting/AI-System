# Dung chung cho build.sh / up.sh / down.sh (source). Project + tag co dinh: KHONG doc tu env de khong the tro nham sang prod.
PROJECT=sohoptac2-cr118
IMG_APP=sohoptac2-app:cr118
IMG_WEB=sohoptac2-web:cr118
DRY=0
for a in "$@"; do [ "$a" = "--dry-run" ] && DRY=1; done
dc() { docker compose -p "$PROJECT" "$@"; }
# run: --dry-run => chi in lenh se chay (khong goi docker, khong ghi gi).
run() { if [ "$DRY" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }
# Chan cung: tag :latest cua image app/web = image PROD. Moi image minh dung/xoa phai la cr118.
guard_tag() { case "$1" in *:latest|*:) echo "${0##*/}: tu choi image '$1' (chi tag cr118)"; exit 4;; esac; }
guard_tag "$IMG_APP"; guard_tag "$IMG_WEB"