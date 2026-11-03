#!/usr/bin/env bash
# Chạy TRÊN máy chủ (do boot.sh gọi). Chỉ đụng ~/workspace/evotest/slots/sN (+ cache chung) và project Docker "evotest-sN" (N = EVO_SLOT, mặc định 1).
# Dùng: [EVO_FILTER="tests/a tests/b"] remote.sh <bước: unit|int|e2e|py|all> <commit> <tag>  (khoá slot do boot.sh giữ; tag = hậu tố file /tmp riêng mỗi lượt)
set -uo pipefail
STEP="$1"; COMMIT="$2"; TAG="$3"
R="$HOME/workspace/evotest"; SLOT="${EVO_SLOT:-1}"; PROJ="evotest-s$SLOT"
D="$R/slots/s$SLOT"
# CR-115: -Exclusive (perf) nạp thêm docker-compose.exclusive.yml (bỏ cap CPU/nice của slot thường); thường giữ nguyên cap.
DC=(docker compose -p "$PROJ" -f docker-compose.yml)
[ -n "${EVO_EXCLUSIVE:-}" ] && DC+=(-f docker-compose.exclusive.yml)
mkdir -p "$R/cache" "$D" && cd "$D" || exit 2
export EVO_CACHE="$R/cache"

# In "[evotest] exclusive-config <service>: cpus=… cpu_shares=… entrypoint=[…]" cho pg/redis/runner theo compose đã gộp (khớp exclusive.txt).
exclusive_config() {
  "${DC[@]}" "$@" config 2>/dev/null | awk -v P="[evotest] exclusive-config" '
    function flush() { if (s != "") print P " " s ": cpus=" c " cpu_shares=" sh " entrypoint=[" ep " ]" }
    /^  [a-z0-9-]+:$/ { flush(); s=$1; sub(":", "", s); c="-"; sh="-"; ep=""; ine=0; next }
    /^    cpus:/ { c=$2 }
    /^    cpu_shares:/ { sh=$2 }
    /^    entrypoint:/ { ine=1; next }
    ine && /^      - / { ep=ep " " $2; next }
    { ine=0 }
    END { flush() }' | grep -E "exclusive-config (pg|redis|runner):"
}

cleanup() {
  # chỉ project evotest-sN: dừng container + xoá volume/mạng của chính nó, bỏ mã nguồn tạm; giữ cache bun + image (<15 GB)
  "${DC[@]}" --profile e2e --profile py down -v --remove-orphans >/dev/null 2>&1
  rm -rf "$D/app"
}
trap cleanup EXIT

free_gb=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
[ "$free_gb" -ge 40 ] || { echo "đĩa còn $free_gb GB (<40) - dừng"; exit 4; }
cache_gb=$(du -s --block-size=1G "$R/cache" "$R"/slots/*/out 2>/dev/null | awk '{s+=$1} END{print s+0}')
[ "$cache_gb" -lt 15 ] || { echo "evotest chiếm $cache_gb GB (>=15) - xoá $R/cache rồi chạy lại"; exit 4; }

rm -rf app out; mkdir app out
tar xzf "/tmp/evotest-app-$TAG.tgz" -C app || { echo "giải nén mã nguồn lỗi"; exit 2; }
unlink "/tmp/evotest-app-$TAG.tgz"; unlink "/tmp/evotest-kit-$TAG.tgz"
echo "$COMMIT" > app/VERSION
export EVO_CAPTURE="${EVO_CAPTURE:-}" EVO_ALL="${EVO_ALL:-}" EVO_WORKERS="${EVO_WORKERS:-}" EVO_FILTER="${EVO_FILTER:-}" EVO_PROBE="${EVO_PROBE:-}" EVO_UID=$(id -u) EVO_GID=$(id -g)
echo "[evotest] slot $SLOT ($PROJ) · đĩa trống $free_gb GB · commit $COMMIT · bước $STEP"

rc=0
steps="$STEP"; [ "$STEP" = all ] && steps="unit int e2e"
for s in $steps; do
  svc=runner; prof=(); [ "$s" = e2e ] && { svc=runner-e2e; prof=(--profile e2e); }; [ "$s" = py ] && { svc=runner-py; prof=(--profile py); }
  export EVO_STEP="$s"
  echo "[evotest] ===== $s ====="
  if [ -n "${EVO_EXCLUSIVE:-}" ]; then exclusive_config "${prof[@]}"   # cấu hình CPU thật compose dùng (vào exclusive.txt)
  else echo "[evotest] caps: slot thường (pg 1 CPU, runner nice 19, cpu_shares 128)"; fi
  "${DC[@]}" "${prof[@]}" build -q "$svc" >/dev/null || { echo "build lỗi"; rc=2; break; }
  t0=$(date +%s)
  "${DC[@]}" "${prof[@]}" run --rm "$svc"; r=$?
  echo "[evotest] $s: exit $r, $(( $(date +%s) - t0 )) s"
  [ $r -ne 0 ] && rc=$r
  mkdir -p "out/$s"; [ -d out/logs ] && { cp -r out/logs/. "out/$s/"; rm -rf out/logs; }
  "${DC[@]}" --profile e2e --profile py down -v --remove-orphans >/dev/null 2>&1   # DB sạch cho bước sau
done
tar czf "/tmp/evotest-out-$TAG.tgz" -C out . 2>/dev/null
exit $rc
