#!/usr/bin/env bash
# CR-161 · kết nối sẵn Evolu↔NitiGroup và Evolu↔Preschool (chạy SAU onboard-all của cả ba công ty). Lặp lại an toàn.
#   DATABASE_URL=<chủ migration> bash deploy/tenants/connect-all.sh [--dry-run] [--i-know-prod]
# Trên máy chủ chạy trong container `tool` (cùng biến môi trường như onboard-all / tenant-ai-setup).
set -euo pipefail
cd "$(dirname "$0")/../.."
BUN="${BUN:-bun}"
ENVF=""
[ -f .env.local ] && ENVF="--env-file=.env.local"
for B in nitigroup preschool; do
  "$BUN" $ENVF tools/scripts/src/tenant-connect.ts --a evolu --b "$B" "$@"
done
