#!/usr/bin/env bash
# sohoptac2-staging · build image: sohoptac2-app:staging + sohoptac2-web:staging tu ./build/app (push.ps1 giai nen git archive cua ref).
# KHONG bao gio build/tag :latest, khong dung project `sohoptac2`. filebox/runtime dung lai image prod (khong build lai).
#   bash build.sh [--dry-run]
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
[ "$DRY" = 1 ] || [ -d build/app ] || { echo "build: thieu build/app (chay push.ps1)"; exit 2; }
[ "$DRY" = 1 ] || [ -f build/Dockerfile ] || { echo "build: thieu build/Dockerfile (push.ps1 chep tu deploy/prod-sohoptac2 cua cung ref)"; exit 2; }
[ -f .env ] || { [ "$DRY" = 1 ] && echo "[dry-run] bash gen-env.sh" || bash ./gen-env.sh; }
if [ "$DRY" != 1 ]; then
  # compose config phai ra DUNG hai image staging (khong :latest) truoc khi build.
  imgs="$(dc config --images | grep -E '^sohoptac2-(app|web):' | sort -u | tr '\n' ' ')"
  [ "$imgs" = "$IMG_APP $IMG_WEB " ] || [ "$imgs" = "$IMG_WEB $IMG_APP " ] || { echo "build: image khong phai staging: $imgs"; exit 4; }
  S2_APP_VERSION="$(cat REF 2>/dev/null || echo staging)"; export S2_APP_VERSION
fi
run dc build admin-api web
echo "build: xong $IMG_APP $IMG_WEB (dry=$DRY)"
