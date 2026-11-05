#!/usr/bin/env bash
# sohoptac2 · CR-117 · số đo SLO từ log cho ops-watch (chạy TRÊN máy chủ, cron 30 phút cùng ops-host-status.sh; không in nội dung log).
# Ghi nguyên tử $S2_DIR/ops-status/slo.json: {"at":ISO-UTC,"window_min":30,"log":{"lines":N,"errors":N}}
# lines/errors: dòng log hub-api + admin-api trong WINDOW_MIN phút; "lỗi" = lvl=error|fatal (LOG_FORMAT=kv) hoặc "level":"error|fatal" (json).
# "routes": p95 (ms) + số request theo route từ access log container `web` (log_format main_rt có rt=$request_time, nginx.conf), tính bởi
#   tools/scripts/src/slo-routes.ts chạy qua service `tool`. Lỗi/không có dòng nào ⇒ bỏ "routes" (check `slo` coi contracts.list là chưa có số đo).
# Biến: S2_DIR (mặc định thư mục chứa script), WINDOW_MIN (mặc định 30), COMPOSE_PROJECT (mặc định sohoptac2).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
S2_DIR=${S2_DIR:-$(pwd)}
OUT_DIR="$S2_DIR/ops-status"
WINDOW_MIN=${WINDOW_MIN:-30}
umask 022
mkdir -p "$OUT_DIR"

# docker compose logs lỗi (stack tắt/không có docker) ⇒ không ghi file: check coi là "chưa có số đo", không báo sai 0 lỗi.
logs=$(timeout 60 docker compose -p "${COMPOSE_PROJECT:-sohoptac2}" logs --no-color --no-log-prefix --since "${WINDOW_MIN}m" hub-api admin-api 2>/dev/null) || exit 0
lines=$(printf '%s' "$logs" | grep -c '' || true)
errors=$(printf '%s' "$logs" | grep -cE '(^| )lvl=(error|fatal)( |$)|"level":"(error|fatal)"' || true)

# p95 theo route: web log -> tool (bun) -> {"contracts.list":{"n":N,"p95_ms":X},…}; mọi lỗi ⇒ để trống.
routes=$(timeout 60 docker compose -p "${COMPOSE_PROJECT:-sohoptac2}" logs --no-color --no-log-prefix --since "${WINDOW_MIN}m" web 2>/dev/null \
  | timeout 90 docker compose -p "${COMPOSE_PROJECT:-sohoptac2}" run --rm -T tool tools/scripts/src/slo-routes.ts 2>/dev/null | tail -n 1) || routes=""
routes_json=""
case "$routes" in \{\"*\}) routes_json=",\"routes\":$routes" ;; esac
tmp=$(mktemp "$OUT_DIR/.slo.json.XXXXXX")
trap 'rm -f -- "$tmp"' EXIT
printf '{"at":"%s","window_min":%d,"log":{"lines":%d,"errors":%d}%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$WINDOW_MIN" "${lines:-0}" "${errors:-0}" "${routes_json:-}" > "$tmp"
chmod 644 "$tmp"
mv -f "$tmp" "$OUT_DIR/slo.json"
