#!/usr/bin/env bash
# sohoptac2-staging · nap du lieu DEMO len tenant `demo` cua STAGING (CR-140): cong ty mau 13 nguoi + phong ban (demo:org, gom quy trinh duyet HD / de nghi mua hang
# + HD mau) roi flow mau «Duyet de nghi chi» (seed-flow-showcase) roi quy trinh mua hang 1 cha + 3 con (demo:purchase). Chay TRONG mang docker cua stack staging (container `tool`, DB host `pg`); cac script chi cho
# phep host `pg` khi .env la cua stg-test (S2_STACK + admin URL ai-test-admin; seed-community-demo.guard.ts) va tu choi APP_ENV=production.
# Mat khau: 13 nguoi dung chung DEMO_OWNER.pw (doc tu file, khong in). Lap lai duoc (idempotent). Chay lai: bash seed-demo.sh [--trial]
# Ma nguon script: neu image :staging chua co ban moi, chep file vao ./seed-src/<ten>.ts — chung duoc mount de len /app/tools/scripts/src (xoa thu muc sau khi build lai).
# CR-150: buoc `partner` (UAT 2 cong ty: demo gui → evolu nhan) CHI THEM du lieu o evolu (nguoi/nhom `uat-nhan-*`, 1 quy trinh Nhan HD), khong xoa/sua; mat khau nguoi UAT evolu o file UAT_EVOLU.pw (tu sinh lan dau, khong in).
#   bash seed-demo.sh [--org-only | --showcase-only | --purchase-only | --partner-only] [--trial] [--dry-run]
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
[ "$PROJECT" = "sohoptac2-staging" ] || { echo "seed-demo: sai project"; exit 4; }
STEPS="org showcase purchase partner"; TRIAL=""
for a in "$@"; do case "$a" in --org-only) STEPS=org;; --showcase-only) STEPS=showcase;; --purchase-only) STEPS=purchase;; --partner-only) STEPS=partner;; --trial) TRIAL="--trial";; esac; done
MOUNTS=()
for f in seed-src/*.ts; do [ -e "$f" ] && MOUNTS+=(-v "$PWD/$f:/app/tools/scripts/src/$(basename "$f"):ro"); done
if [ "$DRY" = 1 ]; then echo "[dry-run] project $PROJECT, buoc: $STEPS $TRIAL, mount ${#MOUNTS[@]} file"; exit 0; fi
[ -s UAT_EVOLU.pw ] || { umask 077; openssl rand -base64 24 | tr -d '/+=
' | head -c 20 > UAT_EVOLU.pw; }
export SEED_ADMIN_PASSWORD="$(cat ADMIN.pw)" DEMO_OWNER_PW="$(cat DEMO_OWNER.pw)" UAT_EVOLU_PW="$(cat UAT_EVOLU.pw)"
tool() { dc run --rm -T -e SEED_ADMIN_PASSWORD -e DEMO_OWNER_PW -e UAT_EVOLU_PW -e AUTH_URL=http://admin-api:3001 -e HUB_URL=http://hub-api:4000 "${MOUNTS[@]}" tool "$@"; }
for s in $STEPS; do
  case "$s" in
    org) tool tools/scripts/src/seed-demo-org.ts ;;
    showcase) tool tools/scripts/src/seed-flow-showcase.ts --apply ;;
    purchase) tool tools/scripts/src/seed-purchase-flow.ts $TRIAL ;;
    partner) tool tools/scripts/src/seed-demo-partner.ts ;;
  esac
done
unset SEED_ADMIN_PASSWORD DEMO_OWNER_PW UAT_EVOLU_PW
echo "seed-demo: xong ($STEPS)"
