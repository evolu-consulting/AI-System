#!/usr/bin/env bash
# Chạy TRÊN máy chủ (run-tests.ps1 scp lên /tmp rồi gọi qua ssh): chọn slot trống đầu tiên bằng `mkdir .lock` nguyên tử, giải kit, chạy remote.sh.
# Dùng: [EVO_SLOTS=8] [EVO_EXCLUSIVE=1 EVO_EXCLUSIVE_TIMEOUT_S=3600] EVO_LOCKLIB=<lock.sh> boot.sh <bước> <commit> <tag>.
# Slot 1 giữ khoá cũ ~/workspace/evotest/.lock (tương thích mgmt/run.ps1, nightly); slot N>1: ~/workspace/evotest/slots/sN/.lock.
# Lock mồ côi (PID owner đã chết) bị gỡ. Chỉ chờ khi mọi slot bận (tối đa 90 phút, exit 3).
# CR-115 `-Exclusive` (perf): luật khoá toàn máy `.exclusive` ở lock.sh - lượt thường xếp hàng khi có lượt exclusive; lượt exclusive chờ mọi slot rảnh
# (hết EVO_EXCLUSIVE_TIMEOUT_S => exit 3), in tải/RAM đầu-cuối, nhả khoá khi lỗi/Ctrl-C (trap EXIT/INT/TERM/HUP).
STEP="$1"; COMMIT="$2"; TAG="$3"
R="$HOME/workspace/evotest"; N="${EVO_SLOTS:-8}"
EXCL="${EVO_EXCLUSIVE:-}"
# shellcheck source=lock.sh
. "${EVO_LOCKLIB:?thiếu EVO_LOCKLIB}" || exit 2
[ -n "$EVO_LOCKLIB" ] && unlink "$EVO_LOCKLIB" 2>/dev/null
mkdir -p "$R/slots" || exit 2

L=""; CHILD=""
cleanup() {
  if [ -n "$CHILD" ] && kill -0 "$CHILD" 2>/dev/null; then kill -TERM "$CHILD" 2>/dev/null; wait "$CHILD" 2>/dev/null; fi
  [ -n "$L" ] && rm -rf "$L"
  [ -n "$EXCL" ] && ex_release "$TAG"
}
trap cleanup EXIT
trap 'exit 143' INT TERM HUP

if [ -n "$EXCL" ]; then
  ex_acquire "$COMMIT" "$TAG" "${EVO_EXCLUSIVE_TIMEOUT_S:-3600}" || exit $?
fi

SLOT=0; said=0; WAIT_END=$(( $(date +%s) + 5400 ))
while [ "$SLOT" -eq 0 ]; do
  if [ -z "$EXCL" ] && ex_held; then
    [ "$said" -eq 0 ] && echo "evotest: có lượt perf -Exclusive đang giữ máy, xếp hàng... owner: $(cat "$EX/owner" 2>/dev/null)"; said=1
  else
    for i in $(seq 1 "$N"); do
      mkdir -p "$R/slots/s$i"
      if try_lock "$(lockof "$i")"; then SLOT=$i; break; fi
    done
    # Cửa sổ chạy đua: lượt exclusive có thể xuất hiện ngay sau khi kiểm - nhả slot và xếp hàng lại.
    if [ "$SLOT" -ne 0 ] && [ -z "$EXCL" ] && ex_held; then rm -rf "$(lockof "$SLOT")"; SLOT=0; fi
    [ "$SLOT" -ne 0 ] && break
    [ "$said" -eq 0 ] && echo "evotest: cả $N slot đều bận, xếp hàng... slot1 owner: $(cat "$(lockof 1)/owner" 2>/dev/null)"; said=1
  fi
  if [ "$(date +%s)" -ge "$WAIT_END" ]; then echo "evotest: chờ slot quá 90 phút; nếu treo, xoá khoá trong ~/workspace/evotest(/slots/sN)/.lock"; exit 3; fi
  sleep "$POLL"
done
L="$(lockof "$SLOT")"
echo "$$ $(date +%s) $COMMIT" > "$L/owner"
echo "[evotest] slot $SLOT/$N ($(date +%T))"
if [ -n "$EXCL" ]; then
  # Slot của mình đã giữ: kiểm lại không còn lượt nào lọt vào giữa chừng, rồi ghi tải/RAM lúc bắt đầu đo.
  ex_drain "$SLOT" || exit 3
  echo "[evotest] exclusive-start $(snap "$SLOT") commit=$COMMIT"
fi
cd "$R/slots/s$SLOT" || exit 2
tar xzf "/tmp/evotest-kit-$TAG.tgz" || { echo "giải kit lỗi"; exit 2; }
export EVO_SLOT="$SLOT"
bash remote.sh "$STEP" "$COMMIT" "$TAG" &
CHILD=$!
wait "$CHILD"; rc=$?
CHILD=""
[ -n "$EXCL" ] && echo "[evotest] exclusive-end $(snap "$SLOT") exit=$rc"
exit $rc
