#!/usr/bin/env bash
# tool-evotest-cache · hàm bash cho cache chung của evotest ($C = $R/cache), `source` bởi remote.sh (và `run-tests.ps1 -CachePrune` qua ssh).
#   build/<khoá>/        bản dựng web (evotest-cache.ts app-build): dist/, meta.json, .ref = định danh mã nguồn (c-<commit> | h-<băm>)
#   dbtpl/<băm migrations>/  mẫu DB đã migrate (pg_dump -Fc) + globals.sql (role): slot MỚI nạp lại thay vì migrate; .ref = băm
# Biến cần có: R (gốc ~/workspace/evotest), C (= $R/cache); remote.sh còn cần mảng DC (docker compose) và D (thư mục slot).
# Tuỳ chọn: EVO_PRUNE_PROTECT_S (mặc định 600: mục sửa trong 10 phút gần nhất không bao giờ bị xoá).

# --- dọn cache -------------------------------------------------------------------------------------------------------------

# Khoá còn sống = nhịp tim `hb` (hoặc chính thư mục) mới hơn 60 s (khớp withDirLock của evotest-cache.lib.ts).
_lock_stale() {
  local f="$1/hb"; [ -f "$f" ] || f="$1"
  [ $(( $(date +%s) - $(stat -c %Y "$f" 2>/dev/null || echo 0) )) -gt 60 ]
}

# cache_prune [giữ N ref (5)] [trần GB (6)]: mỗi pool (build, dbtpl) giữ N ref dùng gần nhất (ref = commit/băm; mục MỚI nhất của ref
# quyết định tuổi), rồi nếu tổng > trần thì bỏ tiếp ref cũ nhất (mỗi pool luôn giữ ref mới nhất). Không xoá mục sửa < PROTECT giây.
# Cùng luật với planEviction (tools/scripts/src/evotest-cache.rules.ts).
cache_prune() {
  local keep="${1:-5}" max_gb="${2:-6}" now protect="${EVO_PRUNE_PROTECT_S:-600}" max_b pool d name ref m b i total
  max_b=$(( max_gb * 1073741824 )); now=$(date +%s)
  [ -d "$C" ] || return 0
  declare -A last bytes names pool_of
  local -a order
  for pool in build dbtpl; do
    [ -d "$C/$pool" ] || continue
    for d in "$C/$pool"/.tmp-*; do [ -e "$d" ] && [ $(( now - $(stat -c %Y "$d") )) -gt 3600 ] && rm -rf "$d"; done
    for d in "$C/$pool"/.lock-*; do [ -d "$d" ] && _lock_stale "$d" && rm -rf "$d"; done
    for d in "$C/$pool"/*/; do
      d="${d%/}"; [ -f "$d/.ref" ] || continue
      ref="$pool/$(cat "$d/.ref")"; m=$(stat -c %Y "$d"); b=$(du -sb "$d" | cut -f1)
      names[$ref]+="$d "; bytes[$ref]=$(( ${bytes[$ref]:-0} + b )); pool_of[$ref]="$pool"
      [ "$m" -gt "${last[$ref]:-0}" ] && last[$ref]=$m
    done
  done
  # mới → cũ, theo pool; rank > keep ⇒ xoá
  declare -A drop rank
  mapfile -t order < <(for ref in "${!last[@]}"; do printf '%s\t%s\n' "${last[$ref]}" "$ref"; done | sort -t$'\t' -k1,1nr | cut -f2)
  total=0
  for ref in "${order[@]}"; do
    pool="${pool_of[$ref]}"; rank[$pool]=$(( ${rank[$pool]:-0} + 1 ))
    b="${bytes[$ref]}"
    if [ "${rank[$pool]}" -gt "$(( keep < 1 ? 1 : keep ))" ]; then drop[$ref]=1; else total=$(( total + b )); fi
  done
  # vượt trần: bỏ ref cũ nhất còn lại (không bỏ ref mới nhất của pool = rank 1)
  for (( i=${#order[@]}-1; i>=0 && total>max_b; i-- )); do
    ref="${order[$i]}"; pool="${pool_of[$ref]}"
    [ -n "${drop[$ref]:-}" ] && continue
    # ref mới nhất của pool = ref đầu tiên của pool trong order
    local first=""; for r in "${order[@]}"; do [ "${pool_of[$r]}" = "$pool" ] && { first="$r"; break; }; done
    [ "$ref" = "$first" ] && continue
    b="${bytes[$ref]}"; drop[$ref]=1; total=$(( total - b ))
  done
  local n=0
  for ref in "${!drop[@]}"; do
    for d in ${names[$ref]}; do
      [ $(( now - $(stat -c %Y "$d") )) -ge "$protect" ] && { rm -rf "$d"; n=$((n+1)); echo "[evotest] cache: xoá $d (ref $ref)"; }
    done
  done
  echo "[evotest] cache: giữ ≤ $keep ref/pool, trần $max_gb GB · xoá $n mục · còn $(du -sh "$C" 2>/dev/null | cut -f1)"
}

# --- mẫu DB đã migrate dùng chung giữa các slot ----------------------------------------------------------------------------

# Băm migrations GIỐNG `migrationsHash()` của packages/db/src/test-db-template.ts (sha256 của "<đường dẫn>\0<sha256 file>\n", đường dẫn
# tương đối packages/db, sắp theo byte) - test evotest-cache.int.test.ts so hai bên. Sai lệch chỉ làm hụt cache (COMMENT trong DB mới là chuẩn).
dbtpl_hash() {
  ( cd "$1/packages/db" 2>/dev/null || exit 1
    for d in migrations*/; do find "${d%/}" -type f; done | LC_ALL=C sort | while IFS= read -r f; do
      printf '%s\0%s\n' "$f" "$(sha256sum < "$f" | cut -d' ' -f1)"
    done | sha256sum | cut -d' ' -f1 )
}

_pg() { "${DC[@]}" exec -T pg "$@"; }

# Nạp mẫu đã lưu cho băm migrations hiện tại vào pg của slot (đã chạy `up --wait pg`). Mẫu đặt tên ai_system_cache_<key>_tpl_test, COMMENT
# `<key>:<băm>` ⇒ ensureTemplate của test-db-template.ts coi là "donor" và chép (~0,3 s) thay vì migrate. Lỗi bất kỳ ⇒ bỏ qua (migrate như cũ).
dbtpl_restore() {
  local h d f key comment n ok=0
  h=$(dbtpl_hash "$D/app") || return 0
  d="$C/dbtpl/$h"
  [ -f "$d/.ref" ] || { echo "[evotest] dbtpl: chưa có mẫu cho migrations ${h:0:12}"; return 0; }
  "${DC[@]}" up -d --wait pg >/dev/null 2>&1 || return 0
  grep -v -E '^(CREATE|ALTER) ROLE ai( |;)' "$d/globals.sql" | _pg psql -U ai -d postgres -q -v ON_ERROR_STOP=0 >/dev/null 2>&1
  for f in "$d"/*.dump; do
    [ -f "$f" ] || continue
    key=$(basename "$f" .dump); comment=$(cat "$d/$key.comment"); n="ai_system_cache_${key}_tpl_test"
    if _pg createdb -U ai "$n" >/dev/null 2>&1 && _pg pg_restore -U ai -d "$n" --single-transaction --exit-on-error < "$f" >/dev/null 2>&1 \
       && _pg psql -U ai -d postgres -q -c "COMMENT ON DATABASE \"$n\" IS '${comment//\'/\'\'}'" >/dev/null 2>&1; then ok=$((ok+1))
    else _pg dropdb -U ai --if-exists "$n" >/dev/null 2>&1; echo "[evotest] dbtpl: nạp $key lỗi - bỏ qua"; fi
  done
  touch "$d"
  echo "[evotest] dbtpl: nạp $ok mẫu (migrations ${h:0:12})"
}

# Sau bước int: lưu mẫu mới dựng (nếu chưa có cho băm đó) bằng pg_dump -Fc + role. Khoá mkdir + rename nguyên tử.
dbtpl_save() {
  local rows h dst tmp lk line n c key
  rows=$(_pg psql -U ai -d postgres -At -F '|' -c "select datname, shobj_description(oid,'pg_database') from pg_database where datname like '%\_tpl\_test' and shobj_description(oid,'pg_database') like '%:%' order by datname" 2>/dev/null) || return 0
  [ -n "$rows" ] || return 0
  h=$(printf '%s\n' "$rows" | head -1 | cut -d'|' -f2); h=${h#*:}
  dst="$C/dbtpl/$h"; [ -f "$dst/.ref" ] && return 0
  mkdir -p "$C/dbtpl"; lk="$C/dbtpl/.lock-$h"
  if ! mkdir "$lk" 2>/dev/null; then _lock_stale "$lk" && rm -rf "$lk" && mkdir "$lk" 2>/dev/null || return 0; fi
  tmp="$C/dbtpl/.tmp-$h-$$"; rm -rf "$tmp"; mkdir -p "$tmp"
  _pg pg_dumpall -U ai --globals-only > "$tmp/globals.sql" 2>/dev/null
  declare -A done_key=()
  while IFS= read -r line; do
    n=${line%%|*}; c=${line#*|}; [ "${c#*:}" = "$h" ] || continue
    key=${c%%:*}; [ -n "${done_key[$key]:-}" ] && continue
    if _pg pg_dump -U ai -Fc -d "$n" > "$tmp/$key.dump" 2>/dev/null && [ -s "$tmp/$key.dump" ]; then echo "$c" > "$tmp/$key.comment"; done_key[$key]=1; fi
  done <<< "$rows"
  if [ "${#done_key[@]}" -gt 0 ] && [ -s "$tmp/globals.sql" ]; then
    echo "$h" > "$tmp/.ref"; mv "$tmp" "$dst" && echo "[evotest] dbtpl: lưu ${#done_key[@]} mẫu (migrations ${h:0:12})"
  else rm -rf "$tmp"; fi
  rm -rf "$lk"
}
