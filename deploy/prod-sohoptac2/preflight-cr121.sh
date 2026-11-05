#!/usr/bin/env bash
# sohoptac2 · CR-121 P-1 · kiểm TRƯỚC deploy CR-120 + CR-121 (chạy TRÊN máy chủ; CHỈ ĐỌC; không in bí mật/env khác).
# SQL chạy trong BEGIN READ ONLY … ROLLBACK (preflight-cr121.sql) qua `docker compose exec -T pg psql` như backup.sh; kiểm biến HUB_FLOW_RUNTIME
# của container hub-api (chỉ in on/off). Mỗi mục in [OK] / [CẢNH BÁO] / [CHẶN] kèm cách sửa. Thoát 2 nếu có [CHẶN], 0 nếu không.
# Biến (preflight-cr121.ps1 truyền từ journal repo): PREFLIGHT_HUB_WHEN/_N, PREFLIGHT_PACK_WHEN/_N, PREFLIGHT_ADMIN_WHEN/_N (-1 = không có).
# Cách chạy:  bash preflight-cr121.sh     (S2: PROJECT mặc định sohoptac2)
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
PROJECT=${COMPOSE_PROJECT:-sohoptac2}
dc() { docker compose -p "$PROJECT" "$@"; }

num() { case "${1:-}" in ''|*[!0-9-]*) echo -1 ;; *) echo "$1" ;; esac; }
HUB_WHEN=$(num "${PREFLIGHT_HUB_WHEN:-}");     HUB_N=$(num "${PREFLIGHT_HUB_N:-}")
PACK_WHEN=$(num "${PREFLIGHT_PACK_WHEN:-}");   PACK_N=$(num "${PREFLIGHT_PACK_N:-}")
ADMIN_WHEN=$(num "${PREFLIGHT_ADMIN_WHEN:-}"); ADMIN_N=$(num "${PREFLIGHT_ADMIN_N:-}")

blocks=0; warns=0
show() { # $1=OK|WARN|BLOCK  $2=id  $3=chi tiết  $4=cách sửa
  local tag
  case "$1" in
    OK) tag="[OK]       " ;;
    WARN) tag="[CẢNH BÁO]"; warns=$((warns + 1)) ;;
    *) tag="[CHẶN]     "; blocks=$((blocks + 1)) ;;
  esac
  printf '%s %s: %s\n' "$tag" "$2" "$3"
  [ -n "${4:-}" ] && printf '            → Cách sửa: %s\n' "$4"
  return 0
}

echo "== Kiểm trước deploy CR-120 + CR-121 · $PROJECT · $(date -u +%Y-%m-%dT%H:%M:%SZ) (chỉ đọc) =="

# 1–7: SQL chỉ đọc
out=$(dc exec -T pg psql -U s2_owner -d ai_system -X -q -At -F $'\t' -v ON_ERROR_STOP=1 \
  -v hub_when="$HUB_WHEN" -v hub_n="$HUB_N" -v pack_when="$PACK_WHEN" -v pack_n="$PACK_N" \
  -v admin_when="$ADMIN_WHEN" -v admin_n="$ADMIN_N" < preflight-cr121.sql 2>&1)
rc=$?
if [ "$rc" -ne 0 ]; then
  show BLOCK "sql" "không chạy được kiểm tra DB (psql thoát $rc): $(printf '%s' "$out" | tail -n 3 | tr '\n' ' ')" \
    "Kiểm container pg đang chạy (docker compose -p $PROJECT ps) và quyền s2_owner; chưa kiểm được thì KHÔNG deploy."
else
  while IFS=$'\t' read -r id st detail fix; do
    [ -z "${id:-}" ] && continue
    show "$st" "$id" "$detail" "${fix:-}"
  done <<< "$out"
fi

# 8: HUB_FLOW_RUNTIME của hub-api (chỉ in on/off)
flow=$(timeout 20 docker compose -p "$PROJECT" exec -T hub-api sh -c 'printf %s "${HUB_FLOW_RUNTIME:-}"' 2>/dev/null) || flow="?"
case "$flow" in
  off) show BLOCK "flow-runtime" "HUB_FLOW_RUNTIME = off" \
    "CR-121 gỡ đường dự phòng của web: tắt runtime thì /flow/* 404 và màn duyệt hỏng. Đặt HUB_FLOW_RUNTIME=on (hoặc để trống) trong .env rồi up -d hub-api." ;;
  on|"") show OK "flow-runtime" "HUB_FLOW_RUNTIME = on" "" ;;
  \?) show WARN "flow-runtime" "không đọc được container hub-api (chưa chạy?)" "Kiểm docker compose -p $PROJECT ps; mặc định compose là on." ;;
  *) show WARN "flow-runtime" "HUB_FLOW_RUNTIME có giá trị lạ (không phải on/off, engine coi là on)" "Đặt on hoặc off cho rõ." ;;
esac

echo "== Kết quả: $blocks CHẶN · $warns CẢNH BÁO =="
if [ "$blocks" -gt 0 ]; then echo "KHÔNG deploy cho đến khi hết [CHẶN]."; exit 2; fi
exit 0
