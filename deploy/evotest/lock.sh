#!/usr/bin/env bash
# CR-115 · luật khoá của evotest (boot.sh `source` file này; run-tests.ps1 scp lên /tmp/evotest-lock-<tag>.sh và đặt EVO_LOCKLIB).
# Tách riêng để kiểm bằng test thật (tools/scripts/src/evotest-lock.test.ts chạy bash trên thư mục tạm).
#
# Hai loại khoá, đều là thư mục tạo nguyên tử bằng `mkdir`, file `owner` = "PID giây-epoch commit tag":
#   slot   : $R/.lock (slot 1) | $R/slots/sN/.lock (N>1)  - mỗi lượt thường giữ MỘT slot.
#   toàn máy: $R/.exclusive - lượt `-Exclusive` (perf) giữ trong lúc đo. Luật:
#     1. Lượt thường KHÔNG lấy slot khi .exclusive còn (owner sống) - xếp hàng; sau khi lấy slot kiểm lại (đóng cửa sổ chạy đua) và nhả nếu .exclusive vừa xuất hiện.
#     2. Lượt exclusive lấy .exclusive TRƯỚC (chặn lượt mới, không bị đói), rồi chờ mọi slot rảnh, rồi lấy slot của mình và kiểm lại các slot khác rảnh.
#     3. Owner chết (kill -9, mất ssh) => khoá mồ côi, lượt sau gỡ. Hết hạn (EX_DEADLINE) => nhả .exclusive, mã 3.
# Biến: R (gốc), N (số slot); tuỳ chọn EVO_POLL_S (mặc định 5), EVO_PROGRESS_S (30).
# (tool-evotest-cache) Lượt toàn bộ (full run) cũng giữ `.exclusive` nhưng không chờ slot rảnh: xem full_acquire bên dưới.

EX="$R/.exclusive"
POLL="${EVO_POLL_S:-5}"
PROGRESS_S="${EVO_PROGRESS_S:-30}"

lockof() { if [ "$1" = 1 ]; then echo "$R/.lock"; else echo "$R/slots/s$1/.lock"; fi; }

# Giữ nguyên hành vi cũ: mkdir nguyên tử; owner chết thì gỡ rồi lấy lại.
try_lock() {
  mkdir "$1" 2>/dev/null && return 0
  local o p; o=$(cat "$1/owner" 2>/dev/null); p=${o%% *}
  if [ ${#p} -gt 0 ] && ! kill -0 "$p" 2>/dev/null; then
    echo "evotest: lock mồ côi, gỡ $1 - owner: $o"; rm -rf "$1"; mkdir "$1" 2>/dev/null && return 0
  fi
  return 1
}

# 0 nếu slot $1 đang bận (thư mục có, owner sống hoặc chưa ghi owner); owner chết => rảnh.
slot_busy() {
  local l o p; l=$(lockof "$1"); [ -d "$l" ] || return 1
  o=$(cat "$l/owner" 2>/dev/null); p=${o%% *}
  [ ${#p} -gt 0 ] && ! kill -0 "$p" 2>/dev/null && return 1
  return 0
}

# Danh sách slot bận ("s2 s5"), bỏ slot $1 (0 = không bỏ).
busy_list() {
  local i out=""
  for i in $(seq 1 "$N"); do
    [ "$i" = "${1:-0}" ] && continue
    slot_busy "$i" && out="$out s$i"
  done
  echo "${out# }"
}

# 0 nếu có lượt exclusive còn sống. Owner chết (hoặc thư mục trống quá 10 s) => gỡ, trả 1.
ex_held() {
  [ -d "$EX" ] || return 1
  local o p age; o=$(cat "$EX/owner" 2>/dev/null); p=${o%% *}
  if [ ${#p} -gt 0 ]; then kill -0 "$p" 2>/dev/null && return 0
  else
    age=$(( $(date +%s) - $(stat -c %Y "$EX" 2>/dev/null || echo 0) ))
    [ "$age" -lt 10 ] && return 0
  fi
  echo "evotest: khoá exclusive mồ côi, gỡ - owner: $o"; rm -rf "$EX"; return 1
}

ex_owner_tag() { awk '{print $4}' "$EX/owner" 2>/dev/null; }

# Nhả .exclusive nếu là của lượt có tag $1 (không đụng khoá của lượt khác).
ex_release() { [ "$(ex_owner_tag)" = "$1" ] && rm -rf "$EX"; return 0; }

# Chờ mọi slot (trừ $1) rảnh tới EX_DEADLINE. 0 xong, 3 hết hạn.
ex_drain() {
  local b now last=0
  while :; do
    b=$(busy_list "${1:-0}"); [ -z "$b" ] && return 0
    now=$(date +%s)
    if [ "$now" -ge "$EX_DEADLINE" ]; then echo "evotest: -Exclusive hết hạn chờ, slot còn bận: $b"; return 3; fi
    if [ $((now - last)) -ge "$PROGRESS_S" ]; then
      echo "evotest: -Exclusive chờ slot rảnh: $b (còn $((EX_DEADLINE - now)) s)"; last=$now
    fi
    sleep "$POLL"
  done
}

# ex_acquire <commit> <tag> <timeout_s>: giữ .exclusive rồi chờ mọi slot rảnh. 0 xong, 3 hết hạn (đã nhả).
ex_acquire() {
  local now last=0 o
  EX_DEADLINE=$(( $(date +%s) + $3 ))
  while :; do
    if mkdir "$EX" 2>/dev/null; then echo "$$ $(date +%s) $1 $2" > "$EX/owner"; break; fi
    ex_held || continue   # mồ côi vừa gỡ => thử lại ngay
    now=$(date +%s)
    if [ "$now" -ge "$EX_DEADLINE" ]; then echo "evotest: -Exclusive hết hạn chờ lượt exclusive khác ($(cat "$EX/owner" 2>/dev/null))"; return 3; fi
    if [ $((now - last)) -ge "$PROGRESS_S" ]; then
      o=$(cat "$EX/owner" 2>/dev/null); echo "evotest: -Exclusive chờ lượt exclusive khác - owner: $o (còn $((EX_DEADLINE - now)) s)"; last=$now
    fi
    sleep "$POLL"
  done
  ex_drain 0 || { ex_release "$2"; return 3; }
}

# tool-evotest-cache · LƯỢT TOÀN BỘ (full run: -Step int|e2e|all không -Filter, ~35–50 phút) dùng lại khoá `.exclusive`, owner có thêm trường 5 = `full`:
#   - lượt thường xếp hàng khi .exclusive còn (đúng luật CR-115) ⇒ lượt toàn bộ giữ máy chủ không bị chen thêm lượt mới;
#   - khác -Exclusive: KHÔNG chờ các slot khác rảnh; còn slot bận (lượt khác đang chạy) ⇒ TỪ CHỐI (exit 5) trừ khi force=1.
# full_acquire <commit> <tag> <force 0|1> <timeout_s>: 0 giữ khoá; 3 hết hạn chờ lượt exclusive/full khác; 5 từ chối vì slot bận.
full_acquire() {
  local deadline now last=0 b o
  deadline=$(( $(date +%s) + ${4:-3600} ))
  while :; do
    if mkdir "$EX" 2>/dev/null; then echo "$$ $(date +%s) $1 $2 full" > "$EX/owner"; break; fi
    ex_held || continue
    now=$(date +%s)
    if [ "$now" -ge "$deadline" ]; then echo "evotest: lượt toàn bộ hết hạn chờ lượt khác ($(cat "$EX/owner" 2>/dev/null))"; return 3; fi
    if [ $((now - last)) -ge "$PROGRESS_S" ]; then
      o=$(cat "$EX/owner" 2>/dev/null); echo "evotest: lượt toàn bộ chờ lượt exclusive/full khác - owner: $o (còn $((deadline - now)) s)"; last=$now
    fi
    sleep "$POLL"
  done
  b=$(busy_list 0)
  if [ -n "$b" ]; then
    # một lượt thường vừa lấy slot trước khi .exclusive xuất hiện sẽ tự nhả sau khi kiểm lại (boot.sh) - đo lại một lần cho khỏi từ chối oan
    sleep "$FULL_RECHECK_S"; b=$(busy_list 0)
  fi
  if [ -n "$b" ] && [ "${3:-0}" != 1 ]; then
    echo "evotest: lượt TOÀN BỘ từ chối - slot còn bận: $b. Chạy lại khi rảnh (bun run res:check --server) hoặc thêm -Force."
    ex_release "$2"; return 5
  fi
  [ -n "$b" ] && echo "evotest: -Force: lượt toàn bộ chạy khi slot còn bận: $b (các lượt đó vẫn chạy tiếp, máy chủ sẽ chậm)"
  return 0
}
FULL_RECHECK_S="${EVO_FULL_RECHECK_S:-2}"

# Ảnh chụp tải để ghi vào kết quả: "load1=… nproc=… mem_avail_mb=… slot_bận=…".
snap() {
  echo "load1=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null) nproc=$(nproc 2>/dev/null) mem_avail_mb=$(awk '/MemAvailable/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null) slot_ban=[$(busy_list "${1:-0}")]"
}
