#!/usr/bin/env bash
# sohoptac2 · sao lưu (chạy TRÊN máy chủ, không ghi gì vào volume sống ngoài việc dừng/khởi động lại filebox ~vài giây):
#   pg_dump -Fc (+ globals: role) · đếm hàng mỗi bảng (manifest) · mẫu FileBox (hash) · tar volume fbminio + fbdata
#   (filebox + minio dừng ngắn để sqlite + object nhất quán) · .env + claude-home + ADMIN_CREDENTIALS.txt (600, không in)
# Ra: $BACKUP_ROOT/<UTC yyyymmddThhmmssZ>/ + MANIFEST.sha256. Giữ KEEP_DAILY ngày gần nhất + KEEP_WEEKLY tuần (bản mới nhất mỗi tuần).
# Lỗi => ghi log, dọn bản dở, khởi động lại dịch vụ đã dừng, thoát khác 0.
# CR-104: ban local xong ma offsite loi => backup.json ok=true, offsite_ok=false, error=<ly do>; exit van 1 (cron/log bao loi, hub xep warn).
# Biến: BACKUP_ROOT, KEEP_DAILY=14, KEEP_WEEKLY=8, QUIESCE=1 (0 = tar nóng, sqlite có thể lệch), OFFSITE_DIR (rsync đích, vd user@host:/path;
#   bỏ trống => bỏ qua + cảnh báo), OFFSITE_RSYNC_OPTS, HELPER_IMAGE=alpine:3.20.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
HERE=$(pwd)
umask 077
PROJECT=sohoptac2
BACKUP_ROOT=${BACKUP_ROOT:-$HERE/backups}
KEEP_DAILY=${KEEP_DAILY:-14}
KEEP_WEEKLY=${KEEP_WEEKLY:-8}
QUIESCE=${QUIESCE:-1}
HELPER_IMAGE=${HELPER_IMAGE:-alpine:3.20}
OFFSITE_DIR=${OFFSITE_DIR:-}
OFFSITE_RSYNC_OPTS=${OFFSITE_RSYNC_OPTS:-}
VOL_FBMINIO=${PROJECT}_fbminio
VOL_FBDATA=${PROJECT}_fbdata

mkdir -p "$BACKUP_ROOT"; chmod 700 "$BACKUP_ROOT"
LOG="$BACKUP_ROOT/backup.log"
log() { local m; m="$(date -u +%Y-%m-%dT%H:%M:%SZ) backup: $*"; printf '%s\n' "$m" >> "$LOG"; printf '%s\n' "$m" >&2; }
dc() { docker compose -p "$PROJECT" "$@"; }

PARTIAL=""
STOPPED=0
restart_fb() {
  if [ "$STOPPED" = 1 ]; then
    log "khoi dong lai filebox-minio + filebox"
    dc up -d --no-build --no-recreate --wait filebox-minio filebox >/dev/null || log "CANH BAO: khoi dong lai filebox that bai — kiem tra tay"
    STOPPED=0
  fi
}
# --- CR-104: trang thai cho hub-api doc (ops-status/backup.json, ghi nguyen tu, khong chua bi mat) ---
S2_DIR=${S2_DIR:-$HERE}
STATUS_DIR="$S2_DIR/ops-status"
STATUS_ARMED=0      # chi ghi sau khi co khoa (lan chay trung khong de len ket qua cua lan dang chay)
ERR_MSG=""
RESULT_DIR=""
RESULT_SIZE=0
LOCAL_DONE=0        # 1 sau khi ban local da doi ten xong: loi offsite/don dep sau do KHONG lam ban local that bai (ok=true)
OFFSITE_OK=null     # null = khong dung/chua toi luot; true|false = ket qua rsync
json_str() { printf '%s' "$1" | LC_ALL=C tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
write_status() {
  local ok=false off=false err=null tmp
  { [ "$1" -eq 0 ] || [ "$LOCAL_DONE" = 1 ]; } && ok=true
  [ -n "$OFFSITE_DIR" ] && off=true
  if [ "$1" -ne 0 ] || [ -n "$ERR_MSG" ]; then err="\"$(json_str "${ERR_MSG:-exit $1}")\""; fi
  mkdir -p "$STATUS_DIR" && chmod 755 "$STATUS_DIR" || return 0
  tmp=$(mktemp "$STATUS_DIR/.backup.json.XXXXXX") || return 0
  printf '{"finished_at":"%s","ok":%s,"dir":"%s","size_bytes":%s,"offsite":%s,"offsite_ok":%s,"error":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ok" "$(json_str "$RESULT_DIR")" "${RESULT_SIZE:-0}" "$off" "$OFFSITE_OK" "$err" > "$tmp" \
    && chmod 644 "$tmp" && mv -f "$tmp" "$STATUS_DIR/backup.json" || rm -f -- "$tmp"
}
on_exit() {
  local rc=$?
  restart_fb || true
  if [ "$rc" -ne 0 ]; then
    [ -n "$PARTIAL" ] && rm -rf -- "$PARTIAL"
    log "THAT BAI (exit $rc)"
  fi
  [ "$STATUS_ARMED" = 1 ] && { write_status "$rc" || true; }
  exit "$rc"
}
trap on_exit EXIT
die() { ERR_MSG="$*"; log "LOI: $*"; exit 1; }

command -v flock >/dev/null || die "thieu flock"
command -v sha256sum >/dev/null || die "thieu sha256sum"
exec 9>"$BACKUP_ROOT/.lock"
flock -n 9 || die "backup/restore-test khac dang chay"
STATUS_ARMED=1

[ -f .env ] || die "khong thay .env"
[ -d claude-home ] || die "khong thay claude-home"
dc exec -T pg pg_isready -q -U s2_owner -d ai_system || die "pg khong san sang"

TS=$(date -u +%Y%m%dT%H%M%SZ)
PARTIAL="$BACKUP_ROOT/.partial-$TS"
FINAL="$BACKUP_ROOT/$TS"
mkdir -p "$PARTIAL"
log "bat dau $TS"

# --- SQL đếm hàng (bản sao nằm trong backup để restore-test dùng đúng câu này) ---
cat > "$PARTIAL/rowcounts.sql" <<'SQL'
SELECT n.nspname || '.' || c.relname,
       (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
  AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\_toast%'
ORDER BY 1;
SQL
rowcounts() {
  dc exec -T pg psql -U s2_owner -d ai_system -X -At -F $'\t' -v ON_ERROR_STOP=1 < "$PARTIAL/rowcounts.sql" | LC_ALL=C sort -t $'\t' -k1,1
}

# --- Postgres ---
rowcounts > "$PARTIAL/.counts.before"
dc exec -T pg pg_dump -U s2_owner -d ai_system -Fc > "$PARTIAL/pg.dump"
dc exec -T pg pg_dumpall -U s2_owner --globals-only > "$PARTIAL/pg-globals.sql"
rowcounts > "$PARTIAL/.counts.after"
dc exec -T pg pg_restore -l < "$PARTIAL/pg.dump" > /dev/null || die "pg.dump khong doc duoc (pg_restore -l)"
# manifest: bang <TAB> min <TAB> max (đếm trước/sau dump; restore phải nằm trong khoảng)
LC_ALL=C join -t $'\t' "$PARTIAL/.counts.before" "$PARTIAL/.counts.after" \
  | awk -F'\t' 'BEGIN{OFS="\t"}{lo=$2+0;hi=$3+0;if(lo>hi){t=lo;lo=hi;hi=t}print $1,lo,hi}' > "$PARTIAL/rowcounts.tsv"
rm -f "$PARTIAL/.counts.before" "$PARTIAL/.counts.after"
[ -s "$PARTIAL/rowcounts.tsv" ] || die "manifest dem hang rong"
log "pg: dump $(wc -c < "$PARTIAL/pg.dump") byte, $(wc -l < "$PARTIAL/rowcounts.tsv") bang"

# --- FileBox: mẫu một object (id, version, size, sha256) khi filebox còn chạy ---
dc exec -T filebox python - > "$PARTIAL/filebox-sample.tsv" <<'PY'
import hashlib, json, os, urllib.parse, urllib.request
base = "http://127.0.0.1:9100"
hdr = {"Authorization": "Bearer " + os.environ["FILEBOX_TOKEN"]}
def get(path):
    return urllib.request.urlopen(urllib.request.Request(base + path, headers=hdr), timeout=120)
for f in json.load(get("/files?limit=50")):
    size = f.get("size") or 0
    if not 0 < size <= 50 * 1024 * 1024:
        continue
    q = "?version=" + urllib.parse.quote(f["version_id"]) if f.get("version_id") else ""
    h, n = hashlib.sha256(), 0
    with get("/files/%s/content%s" % (f["file_id"], q)) as r:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            h.update(b)
            n += len(b)
    print("\t".join([f["file_id"], f.get("version_id") or "", str(n), h.hexdigest()]))
    break
PY
if [ -s "$PARTIAL/filebox-sample.tsv" ]; then log "filebox: da ghi mau"; else log "CANH BAO: filebox chua co file de lay mau"; fi

# --- Volume MinIO + FileBox (sqlite): dừng ngắn để nhất quán, tar qua container phụ CHỈ-ĐỌC ---
tar_vol() { docker run --rm --pull=never --network none -v "$1":/v:ro "$HELPER_IMAGE" tar -C /v -cf - . > "$2"; }
if [ "$QUIESCE" = 1 ]; then
  STOPPED=1
  log "dung filebox + filebox-minio de tar"
  dc stop -t 30 filebox filebox-minio >/dev/null
else
  log "CANH BAO: QUIESCE=0 — tar nong, filebox.db/object co the lech nhau"
fi
tar_vol "$VOL_FBMINIO" "$PARTIAL/fbminio.tar"
tar_vol "$VOL_FBDATA" "$PARTIAL/fbdata.tar"
restart_fb
log "volume: fbminio $(wc -c < "$PARTIAL/fbminio.tar") byte, fbdata $(wc -c < "$PARTIAL/fbdata.tar") byte"

# --- Bí mật (600, không in) ---
cp -p .env "$PARTIAL/env"
tar -C "$HERE" -czf "$PARTIAL/claude-home.tgz" claude-home
[ -f ADMIN_CREDENTIALS.txt ] && cp -p ADMIN_CREDENTIALS.txt "$PARTIAL/admin-credentials.txt"
{ echo "timestamp=$TS"; echo "host=$(hostname)"; echo "version=$(cat VERSION 2>/dev/null || echo unknown)"; echo "quiesce=$QUIESCE"; } > "$PARTIAL/backup.info"
find "$PARTIAL" -type f -exec chmod 600 {} +

# --- Manifest sha256 + kiểm lại, rồi đổi tên (đổi tên = hoàn tất) ---
( cd "$PARTIAL" && find . -maxdepth 1 -type f ! -name MANIFEST.sha256 -printf '%f\n' | LC_ALL=C sort | xargs sha256sum > MANIFEST.sha256 && sha256sum -c --quiet MANIFEST.sha256 )
chmod 600 "$PARTIAL/MANIFEST.sha256"; chmod 700 "$PARTIAL"
mv "$PARTIAL" "$FINAL"
PARTIAL=""
LOCAL_DONE=1
RESULT_DIR="$TS"
RESULT_SIZE=$(du -sb "$FINAL" | cut -f1)
log "xong $FINAL ($(du -sh "$FINAL" | cut -f1))"

# --- Giữ 14 ngày + 8 tuần ---
mapfile -t names < <(ls -1 "$BACKUP_ROOT" | grep -E '^[0-9]{8}T[0-9]{6}Z$' | LC_ALL=C sort -r)
keep=" "; seen=" "; n=0; wn=0
for d in "${names[@]}"; do
  n=$((n + 1))
  if [ "$n" -le "$KEEP_DAILY" ]; then keep="$keep$d "; fi
  wk=$(date -u -d "${d:0:4}-${d:4:2}-${d:6:2}" +%G-%V)
  case "$seen" in
    *" $wk "*) ;;
    *) seen="$seen$wk "; wn=$((wn + 1)); if [ "$wn" -le "$KEEP_WEEKLY" ]; then keep="$keep$d "; fi ;;
  esac
done
for d in "${names[@]}"; do
  case "$keep" in *" $d "*) ;; *) rm -rf -- "${BACKUP_ROOT:?}/$d"; log "da xoa ban cu $d" ;; esac
done
find "$BACKUP_ROOT" -maxdepth 1 -name '.partial-*' -mmin +1440 -exec rm -rf -- {} + 2>/dev/null || true

# --- Ngoài máy chủ (tuỳ chọn) ---
if [ -z "$OFFSITE_DIR" ]; then
  log "CANH BAO: OFFSITE_DIR chua dat — ban sao chi nam tren cung may chu (mat may = mat het)"
else
  command -v rsync >/dev/null || { OFFSITE_OK=false; die "OFFSITE_DIR dat nhung thieu rsync (ban local $TS van con)"; }
  # shellcheck disable=SC2086
  if rsync -a --chmod=D700,F600 $OFFSITE_RSYNC_OPTS "$FINAL" "${OFFSITE_DIR%/}/"; then OFFSITE_OK=true; else OFFSITE_OK=false; die "rsync offsite that bai (ban local $TS van con)"; fi
  log "offsite: da chep $TS toi $OFFSITE_DIR"
fi
