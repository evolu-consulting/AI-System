#!/usr/bin/env bash
# sohoptac2 · CR-117 · số đo SLO từ log cho ops-watch (chạy TRÊN máy chủ, cron 30 phút cùng ops-host-status.sh; không in nội dung log).
# Ghi nguyên tử $S2_DIR/ops-status/slo.json: {"at":ISO-UTC,"window_min":30,"log":{"lines":N,"errors":N}}
# lines/errors: dòng log hub-api + admin-api trong WINDOW_MIN phút; "lỗi" = lvl=error|fatal (LOG_FORMAT=kv) hoặc "level":"error|fatal" (json).
# Chưa có nguồn p95 theo route (nginx chưa ghi $request_time) ⇒ không ghi "routes"; check `slo` coi contracts.list là chưa có số đo.
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

tmp=$(mktemp "$OUT_DIR/.slo.json.XXXXXX")
trap 'rm -f -- "$tmp"' EXIT
printf '{"at":"%s","window_min":%d,"log":{"lines":%d,"errors":%d}}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$WINDOW_MIN" "${lines:-0}" "${errors:-0}" > "$tmp"
chmod 644 "$tmp"
mv -f "$tmp" "$OUT_DIR/slo.json"
