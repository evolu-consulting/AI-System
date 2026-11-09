#!/usr/bin/env bash
# sohoptac2-staging · DUNG staging: chi project `sohoptac2-staging`. Mac dinh KHONG xoa du lieu (volume pgdata/redisdata/fbdata/fbminio con nguyen, `up.sh` dung lai).
# Chay `bash rollback.sh` TRUOC neu khong muon host -test tra 502. --purge --yes-delete-staging-data: down -v (XOA DU LIEU staging) + rmi image :staging.
# KHONG xoa image :latest (prod) / filebox / runtime.
#   bash down.sh [--dry-run] [--purge --yes-delete-staging-data]
set -uo pipefail
cd "$(dirname "$0")"
. ./lib.sh
PURGE=0; YES=0
for a in "$@"; do [ "$a" = "--purge" ] && PURGE=1; [ "$a" = "--yes-delete-staging-data" ] && YES=1; done
if [ "$PURGE" = 1 ] && [ "$YES" != 1 ]; then echo "down: --purge can them --yes-delete-staging-data"; exit 2; fi
if [ "$PURGE" = 1 ]; then
  run docker compose -p "$PROJECT" --profile tools down -v --remove-orphans
  for img in "$IMG_APP" "$IMG_WEB"; do guard_tag "$img"; run docker rmi "$img" || true; done
else
  run docker compose -p "$PROJECT" --profile tools down --remove-orphans
fi
[ "$DRY" = 1 ] && exit 0
echo "con lai container: $(docker ps -a --filter label=com.docker.compose.project=$PROJECT --format '{{.Names}}' | wc -l) · volume: $(docker volume ls -q --filter label=com.docker.compose.project=$PROJECT | wc -l)"
