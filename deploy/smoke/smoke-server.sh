#!/usr/bin/env bash
# Phía máy chủ của bài kiểm hành trình (deploy/smoke/smoke-journey.ps1 chép tới <thư mục stack>/smoke-src rồi gọi qua SSH).
#   bash smoke-server.sh setup|purge <thư mục stack> <project compose>     # mật khẩu tạm: DÒNG ĐẦU của stdin (không vào tham số/đĩa)
# setup: xoá sạch smoke-a/b còn sót -> tạo smoke-a/b (tenant-onboard, MỘT mật khẩu chung, không ép đổi) -> áp dụng quy trình (smoke-flows).
# purge: xoá SẠCH smoke-a/b (tenant-purge --apply --confirm "<tên>"). Khoá cứng: chỉ hai công ty này, không bao giờ evolu/nitigroup/preschool.
set -euo pipefail
MODE="$1"; DIR="$2"; PROJ="$3"
cd "$DIR"
SRC="$PWD/smoke-src"
IFS= read -r SMOKE_PW || true
SMOKE_PW="${SMOKE_PW%$'\r'}"
SMOKE_PW="${SMOKE_PW#$'\xEF\xBB\xBF'}" # PowerShell 5.1 gắn BOM UTF-8 khi pipe sang ssh
export SMOKE_PW
if [ -s ADMIN.pw ]; then SEED_ADMIN_PASSWORD="$(tr -d '\r\n' < ADMIN.pw)"
else SEED_ADMIN_PASSWORD="$(grep -E '^password:' ADMIN_CREDENTIALS.txt | head -1 | sed 's/^password:[[:space:]]*//' | tr -d '\r\n')"; fi
export SEED_ADMIN_PASSWORD
tool() {
  docker compose -p "$PROJ" run --rm -T -e SEED_ADMIN_PASSWORD -e SMOKE_PW -e AUTH_URL=http://admin-api:3001 -e HUB_URL=http://hub-api:4000 \
    -v "$SRC/smoke-flows.ts:/app/tools/scripts/src/smoke-flows.ts:ro" -v "$SRC/tenants:/app/deploy/smoke/tenants:ro" tool "$@" </dev/null
}
purge() {
  for k in a b; do
    tool tools/scripts/src/tenant-purge.ts --tenant "smoke-$k" --apply --confirm "Smoke $(echo "$k" | tr a-z A-Z)" --state "/tmp/smoke-purge-$k.json" 2>&1 | tail -3 || true
  done
}
case "$MODE" in
  purge) purge ;;
  probe) # in 1 nếu image có CR-169 (pmsg_send), ngược lại 0 (bài kiểm tin nhắn chỉ chạy khi có)
    docker compose -p "$PROJ" run --rm -T --entrypoint sh tool -c 'grep -rlq pmsg_send /app/apps /app/packages --exclude-dir=node_modules && echo 1 || echo 0' </dev/null | tail -1 ;;
  setup)
    [ -n "$SMOKE_PW" ] || { echo "thiếu mật khẩu tạm (dòng đầu stdin)"; exit 2; }
    purge
    ACTOR="$(tool tools/scripts/src/smoke-flows.ts actor | tail -1 | tr -d '\r')"
    for k in a b; do
      tool apps/admin-api/src/modules/tenant-onboard/tenant-onboard.cli.ts --file "/app/deploy/smoke/tenants/smoke-$k.yaml" \
        --actor "$ACTOR" --password-env SMOKE_PW --no-force-change >/dev/null
      echo "smoke-$k: đã tạo công ty + người"
    done
    for k in a b; do tool tools/scripts/src/smoke-flows.ts flows "smoke-$k"; done
    for k in a b; do tool tools/scripts/src/smoke-flows.ts directory "smoke-$k"; done ;;
  *) echo "dùng: setup|purge"; exit 2 ;;
esac
