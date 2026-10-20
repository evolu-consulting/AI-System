#!/usr/bin/env bash
# Chạy TRÊN máy chủ (run-tests.ps1 scp lên /tmp rồi gọi qua ssh): chọn slot trống đầu tiên bằng `mkdir .lock` nguyên tử, giải kit, chạy remote.sh.
# Dùng: [EVO_SLOTS=4] boot.sh <bước> <commit> <tag>. Slot 1 giữ khoá cũ ~/workspace/evotest/.lock (tương thích mgmt/run.ps1, nightly); slot N>1: ~/workspace/evotest/slots/sN/.lock.
# Lock mồ côi (PID owner đã chết) bị gỡ. Chỉ chờ khi mọi slot bận (tối đa 90 phút, exit 3).
STEP="$1"; COMMIT="$2"; TAG="$3"
R="$HOME/workspace/evotest"; N="${EVO_SLOTS:-4}"
mkdir -p "$R/slots" || exit 2
lockof() { if [ "$1" = 1 ]; then echo "$R/.lock"; else echo "$R/slots/s$1/.lock"; fi; }
try_lock() {
  mkdir "$1" 2>/dev/null && return 0
  local o p; o=$(cat "$1/owner" 2>/dev/null); p=${o%% *}
  if [ ${#p} -gt 0 ] && ! kill -0 "$p" 2>/dev/null; then
    echo "evotest: lock mồ côi, gỡ $1 - owner: $o"; rm -rf "$1"; mkdir "$1" 2>/dev/null && return 0
  fi
  return 1
}
SLOT=0; w=0; said=0
while [ "$SLOT" -eq 0 ]; do
  for i in $(seq 1 "$N"); do
    mkdir -p "$R/slots/s$i"
    if try_lock "$(lockof "$i")"; then SLOT=$i; break; fi
  done
  [ "$SLOT" -ne 0 ] && break
  [ "$said" -eq 0 ] && echo "evotest: cả $N slot đều bận, xếp hàng... slot1 owner: $(cat "$(lockof 1)/owner" 2>/dev/null)"; said=1
  w=$((w+5)); if [ "$w" -ge 5400 ]; then echo "evotest: chờ slot quá 90 phút; nếu treo, xoá khoá trong ~/workspace/evotest(/slots/sN)/.lock"; exit 3; fi
  sleep 5
done
L="$(lockof "$SLOT")"
echo "$$ $(date +%s) $COMMIT" > "$L/owner"
trap 'rm -rf "$L"' EXIT
echo "[evotest] slot $SLOT/$N ($(date +%T))"
cd "$R/slots/s$SLOT" || exit 2
tar xzf "/tmp/evotest-kit-$TAG.tgz" || { echo "giải kit lỗi"; exit 2; }
export EVO_SLOT="$SLOT"
bash remote.sh "$STEP" "$COMMIT" "$TAG"