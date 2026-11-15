#!/usr/bin/env bash
# CR-159 · dựng MỘT công ty đầy đủ, "chỉ việc dùng": onboarding (công ty, người, gói, danh bạ) → cài AI → quy trình.
#   ACTOR=<uuid platform admin> PW=<mật khẩu chung> bash deploy/tenants/onboard-all.sh --tenant <key> [--no-flows] [--dry-run]
# Chạy lại an toàn (mỗi bước idempotent). Mật khẩu chỉ qua biến môi trường PW (không in, không ghi file).
# Env: ADMIN_API_DATABASE_URL (onboarding, role admin_api) · DATABASE_URL (chủ migration, cho cài AI) · ACTOR · PW
#      và cho bước quy trình: SEED_ADMIN_USERNAME/SEED_ADMIN_PASSWORD, admin-api + hub-api đang chạy (xem tenant-flows.ts).
# Cài AI (tenant-ai-setup) chỉ ghi SQL — KHÔNG cần đăng nhập nhà cung cấp AI (Claude) trước.
set -euo pipefail
cd "$(dirname "$0")/../.."
KEY=""
FLOWS=1
DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tenant) KEY="${2:-}"; shift 2 ;;
    --no-flows) FLOWS=0; shift ;;
    --dry-run) DRY=1; shift ;;
    *) echo "onboard-all: tham số lạ: $1" >&2; exit 2 ;;
  esac
done
[ -n "$KEY" ] || { echo "onboard-all: cần --tenant <key> (file deploy/tenants/<key>.yaml)" >&2; exit 2; }
FILE="deploy/tenants/$KEY.yaml"
[ -f "$FILE" ] || { echo "onboard-all: không có $FILE" >&2; exit 2; }
BUN="${BUN:-bun}"
ENVF=""
[ -f .env.local ] && ENVF="--env-file=.env.local"

if [ "$DRY" = 1 ]; then
  "$BUN" $ENVF apps/admin-api/src/modules/tenant-onboard/tenant-onboard.cli.ts --file "$FILE" --dry-run
  exit 0
fi
: "${ACTOR:?onboard-all: cần ACTOR=<uuid platform admin>}"
: "${PW:?onboard-all: cần PW=<mật khẩu chung cho người mới>}"

echo "== 1/3 onboarding (công ty, người, gói, danh bạ)"
"$BUN" $ENVF apps/admin-api/src/modules/tenant-onboard/tenant-onboard.cli.ts \
  --file "$FILE" --actor "$ACTOR" --password-env PW
echo "== 2/3 cài AI (assistant + knowledge + agent mặc định)"
"$BUN" $ENVF tools/scripts/src/tenant-ai-setup.ts --tenant "$KEY" --apply
case "$KEY" in
  evolu|nitigroup|preschool)
    if [ "$FLOWS" = 1 ]; then
      echo "== 3/3 quy trình"
      "$BUN" $ENVF tools/scripts/src/tenant-flows.ts --tenant "$KEY"
    else
      echo "== 3/3 quy trình: bỏ qua (--no-flows)"
    fi ;;
  *) echo "== 3/3 quy trình: công ty này không có bộ quy trình dựng sẵn" ;;
esac
echo "onboard-all[$KEY]: xong"
