#!/usr/bin/env bash
# sohoptac2-staging · nap du lieu DEMO len tenant `demo` cua STAGING (CR-140): cong ty mau 13 nguoi + phong ban (demo:org, gom quy trinh duyet HD / de nghi mua hang
# + HD mau) roi flow mau «Duyet de nghi chi» (seed-flow-showcase) roi quy trinh mua hang 1 cha + 3 con (demo:purchase). Chay TRONG mang docker cua stack staging (container `tool`, DB host `pg`); cac script chi cho
# phep host `pg` khi .env la cua stg-test (S2_STACK + admin URL ai-test-admin; seed-community-demo.guard.ts) va tu choi APP_ENV=production.
# Mat khau: 13 nguoi dung chung DEMO_OWNER.pw (doc tu file, khong in). Lap lai duoc (idempotent). Chay lai: bash seed-demo.sh [--trial]
# Ma nguon script: neu image :staging chua co ban moi, chep file vao ./seed-src/<ten>.ts — chung duoc mount de len /app/tools/scripts/src (xoa thu muc sau khi build lai).
# CR-150: buoc `partner` (UAT 2 cong ty: demo gui → evolu nhan) CHI THEM du lieu o evolu (nguoi/nhom `uat-nhan-*`, 1 quy trinh Nhan HD), khong xoa/sua; mat khau nguoi UAT evolu o file UAT_EVOLU.pw (tu sinh lan dau, khong in).
#   Stack stg-test chua co cong ty `evolu` ⇒ buoc partner TAO cong ty Evolu (+ goi Hop dong + quan tri uat-nhan-admin); co san thi chi them.
# CR-152: buoc `kinds` (--kinds-only) them 2 HD mau tren demo: «Nhuong quyen Ca Phe Mau» (DONE, co moc ky) + «Thoa thuan hop tac Logistics mien Tay» (dang cho duyet). Chay SAU org + partner; khong nam trong mac dinh.
# CR-181: buoc `sign` (--sign-only) bat ky tren tai lieu cho demo + quy trinh «Duyet va ky hop dong (ky tren tai lieu)» + 1 HD Nhap mau co 2 PDF (chay SAU org + partner; chi them, khong nam trong mac dinh).
#   CR-182: --sign-new = LUON tao them 1 HD mau Nhap MOI (tieu de co gio) de moi luot UAT co HD moi; --sign-only chi tao khi khong con HD Nhap nao.
#   bash seed-demo.sh [--org-only | --showcase-only | --purchase-only | --partner-only | --kinds-only | --sign-only | --sign-new] [--trial] [--dry-run]
set -euo pipefail
cd "$(dirname "$0")"
. ./lib.sh
[ "$PROJECT" = "sohoptac2-staging" ] || { echo "seed-demo: sai project"; exit 4; }
STEPS="org showcase purchase partner"; TRIAL=""; SIGN_ARGS=""
for a in "$@"; do case "$a" in --org-only) STEPS=org;; --showcase-only) STEPS=showcase;; --purchase-only) STEPS=purchase;; --partner-only) STEPS=partner;; --kinds-only) STEPS=kinds;; --sign-only) STEPS=sign;; --sign-new) STEPS=sign; SIGN_ARGS="--sign-new";; --trial) TRIAL="--trial";; esac; done
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
    kinds) tool tools/scripts/src/seed-kind-samples.ts ;;
    sign) tool tools/scripts/src/seed-cr181-sign.ts $SIGN_ARGS ;;
  esac
done
unset SEED_ADMIN_PASSWORD DEMO_OWNER_PW UAT_EVOLU_PW
echo "seed-demo: xong ($STEPS)"
