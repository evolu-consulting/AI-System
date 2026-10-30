#!/usr/bin/env bash
# sohoptac2 · CR-104 · trạng thái máy chủ cho hub-api đọc (chạy TRÊN máy chủ, cron 30 phút; không cần root, không in bí mật).
# Ghi nguyên tử $S2_DIR/ops-status/host.json:
#   {"at":ISO-UTC,"every_min":30,"disks":[{"mount":"/","used_pct":N,"avail_bytes":N}],"deploy_ref":string|null}
# disks: "/" + thư mục dữ liệu Docker nếu nằm trên mount khác. deploy_ref: dòng đầu file VERSION (deploy.ps1 ghi "<commit> (<ref>)").
# Biến: S2_DIR (mặc định thư mục chứa script), DOCKER_ROOT (bỏ qua hỏi docker).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
S2_DIR=${S2_DIR:-$(pwd)}
OUT_DIR="$S2_DIR/ops-status"
umask 022
mkdir -p "$OUT_DIR"

json_str() { printf '%s' "$1" | LC_ALL=C tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# df -B1 -P <path> → {"mount":..,"used_pct":..,"avail_bytes":..}; in ra "<mount>\t<json>" hoặc không in gì nếu df lỗi.
disk_of() {
  df -B1 -P "$1" 2>/dev/null | awk 'NR==2 {
    m=$NF; p=$(NF-1); a=$(NF-2); sub(/%$/,"",p)
    gsub(/\\/,"\\\\",m); gsub(/"/,"\\\"",m)
    printf "%s\t{\"mount\":\"%s\",\"used_pct\":%d,\"avail_bytes\":%.0f}\n", $NF, m, p+0, a+0 }'
}

root_line=$(disk_of /) || root_line=""
disks=""
root_mount=""
if [ -n "$root_line" ]; then
  root_mount=${root_line%%$'\t'*}
  disks=${root_line#*$'\t'}
fi

docker_root=${DOCKER_ROOT:-}
if [ -z "$docker_root" ] && command -v docker >/dev/null 2>&1; then
  docker_root=$(timeout 10 docker info -f '{{.DockerRootDir}}' 2>/dev/null || true)
fi
if [ -n "$docker_root" ] && [ -d "$docker_root" ]; then
  d_line=$(disk_of "$docker_root") || d_line=""
  if [ -n "$d_line" ] && [ "${d_line%%$'\t'*}" != "$root_mount" ]; then
    disks="${disks:+$disks,}${d_line#*$'\t'}"
  fi
fi

deploy_ref=null
if [ -s VERSION ]; then
  v=$(head -n 1 VERSION | tr -d '\r')
  [ -n "$v" ] && deploy_ref="\"$(json_str "$v")\""
fi

tmp=$(mktemp "$OUT_DIR/.host.json.XXXXXX")
trap 'rm -f -- "$tmp"' EXIT
printf '{"at":"%s","every_min":30,"disks":[%s],"deploy_ref":%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$disks" "$deploy_ref" > "$tmp"
chmod 644 "$tmp"
mv -f "$tmp" "$OUT_DIR/host.json"
