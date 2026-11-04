#!/usr/bin/env bash
# sohoptac2-cr118 · build image UAT: sohoptac2-app:cr118 + sohoptac2-web:cr118 tu ./build/app (push.ps1 giai nen git archive cua nhanh slice).
# KHONG bao gio build/tag :latest, khong dung project `sohoptac2`. filebox/runtime dung lai image prod (khong build lai).
#   bash build.sh [--dry-run]
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
[ "$DRY" = 1 ] || [ -d build/app ] || { echo "build: thieu build/app (chay push.ps1)"; exit 2; }
[ "$DRY" = 1 ] || [ -f build/Dockerfile ] || { echo "build: thieu build/Dockerfile (push.ps1 chep tu deploy/prod-sohoptac2 cua cung ref)"; exit 2; }
[ -f .env ] || { [ "$DRY" = 1 ] && echo "[dry-run] bash gen-env.sh" || bash ./gen-env.sh; }
if [ "$DRY" != 1 ]; then
  # compose config phai ra DUNG hai image cr118 (khong :latest) truoc khi build.
  imgs="$(dc config --images | grep -E '^sohoptac2-(app|web):' | sort -u | tr '\n' ' ')"
  [ "$imgs" = "$IMG_APP $IMG_WEB " ] || [ "$imgs" = "$IMG_WEB $IMG_APP " ] || { echo "build: image khong phai cr118: $imgs"; exit 4; }
fi
run dc build admin-api web
echo "build: xong $IMG_APP $IMG_WEB (dry=$DRY)"