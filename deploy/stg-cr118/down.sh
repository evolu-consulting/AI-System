#!/usr/bin/env bash
# sohoptac2-cr118 · DON SAU UAT: chi project `sohoptac2-cr118` (down -v: container, mang, volume/tmpfs) + xoa image cr118 (app, web). KHONG xoa
# image :latest (prod) / filebox / runtime. --rm-dir xoa luon thu muc kit (mat .env/mat khau). --dry-run: chi in.
#   bash down.sh [--dry-run] [--rm-dir]
set -uo pipefail
cd "$(dirname "$0")"
. ./lib.sh
RMDIR=0; for a in "$@"; do [ "$a" = "--rm-dir" ] && RMDIR=1; done
run docker compose -p "$PROJECT" --profile tools down -v --remove-orphans
for img in "$IMG_APP" "$IMG_WEB"; do guard_tag "$img"; run docker rmi "$img" || true; done
if [ "$DRY" = 1 ]; then echo "[dry-run] kiem: docker ps -a / volume ls / images theo project + tag cr118 phai rong"; [ "$RMDIR" = 1 ] && echo "[dry-run] rm -rf $(pwd)"; exit 0; fi
echo "con lai container: $(docker ps -a --filter label=com.docker.compose.project=$PROJECT --format '{{.Names}}' | wc -l) · volume: $(docker volume ls -q --filter label=com.docker.compose.project=$PROJECT | wc -l) · image cr118: $(docker images -q 'sohoptac2-*:cr118' | wc -l)  (mong 0 0 0)"
[ "$RMDIR" = 1 ] && { d="$(pwd)"; cd .. && rm -rf "$d"; }
exit 0