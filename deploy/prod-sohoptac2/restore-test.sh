#!/usr/bin/env bash
# sohoptac2 · thử khôi phục bản sao lưu MỚI NHẤT vào container tạm (project `s2restore`, không publish cổng, volume riêng
# s2restore_*), kiểm: sha256 MANIFEST, số hàng mỗi bảng nằm trong khoảng ghi lúc backup, một object FileBox tải về đúng hash.
# Xong (đạt hay không) đều gỡ sạch (down -v). KHÔNG đụng project/volume sống `sohoptac2` (chỉ đọc thư mục backups + minio-bin).
# Biến: BACKUP_ROOT, BACKUP_DIR (chọn bản cụ thể), PG_IMAGE, FB_IMAGE, HELPER_IMAGE. Thoát 0 = đạt.
set -euo pipefail
cd "$(dirname "$0")"
HERE=$(pwd)
umask 077
RPROJECT=s2restore   # cố định, không đổi bằng env: tuyệt đối không trùng project sống
BACKUP_ROOT=${BACKUP_ROOT:-$HERE/backups}
PG_IMAGE=${PG_IMAGE:-postgres:16.15-alpine}
FB_IMAGE=${FB_IMAGE:-sohoptac2-filebox:latest}
HELPER_IMAGE=${HELPER_IMAGE:-alpine:3.20}
LOG="$BACKUP_ROOT/restore-test.log"
log() { local m; m="$(date -u +%Y-%m-%dT%H:%M:%SZ) restore-test: $*"; printf '%s\n' "$m" >> "$LOG"; printf '%s\n' "$m" >&2; }
rdc() { docker compose -p "$RPROJECT" --project-directory "$WORK" -f "$WORK/compose.yml" --env-file "$WORK/restore.env" "$@"; }

WORK=""
teardown() {
  if [ -n "$WORK" ] && [ -f "$WORK/compose.yml" ]; then
    rdc down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  # chỉ ba volume của project tạm (down -v thường đã xoá)
  docker volume rm -f "${RPROJECT}_pgdata" "${RPROJECT}_fbdata" "${RPROJECT}_fbminio" >/dev/null 2>&1 || true
}
on_exit() {
  local rc=$?
  teardown
  [ -n "$WORK" ] && rm -rf -- "$WORK"
  if [ "$rc" -eq 0 ]; then log "DAT"; else log "THAT BAI (exit $rc)"; fi
  exit "$rc"
}
trap on_exit EXIT
die() { log "LOI: $*"; exit 1; }

mkdir -p "$BACKUP_ROOT"
exec 9>"$BACKUP_ROOT/.lock"
flock -s -w 1800 9 || die "backup dang chay qua lau"

if [ -n "${BACKUP_DIR:-}" ]; then
  B=$BACKUP_DIR
else
  last=$(ls -1 "$BACKUP_ROOT" | grep -E '^[0-9]{8}T[0-9]{6}Z$' | LC_ALL=C sort | tail -1 || true)
  [ -n "$last" ] || die "chua co ban sao luu nao trong $BACKUP_ROOT"
  B="$BACKUP_ROOT/$last"
fi
for f in MANIFEST.sha256 pg.dump pg-globals.sql rowcounts.tsv rowcounts.sql fbminio.tar fbdata.tar env; do
  [ -f "$B/$f" ] || die "ban sao luu thieu $f ($B)"
done
[ -x "$HERE/minio-bin/minio" ] || die "thieu $HERE/minio-bin/minio (nhi phan MinIO tinh, xem filebox-env.sh)"
log "kiem $B"
( cd "$B" && sha256sum -c --quiet MANIFEST.sha256 ) || die "MANIFEST sha256 sai"

WORK=$(mktemp -d "${TMPDIR:-/tmp}/s2restore.XXXXXX")
# env tối thiểu (chỉ khoá cần cho pg + filebox) lấy từ bản sao .env trong backup; không in.
grep -E '^(PG_OWNER_PASSWORD|FILEBOX_TOKEN|FILEBOX_MINIO_USER|FILEBOX_MINIO_PASSWORD|S2_UID|S2_GID)=' "$B/env" > "$WORK/restore.env" || true
for k in PG_OWNER_PASSWORD FILEBOX_TOKEN FILEBOX_MINIO_USER FILEBOX_MINIO_PASSWORD; do
  grep -q "^$k=" "$WORK/restore.env" || die "env trong backup thieu $k"
done
{ echo "PG_IMAGE=$PG_IMAGE"; echo "FB_IMAGE=$FB_IMAGE"; echo "HELPER_IMAGE=$HELPER_IMAGE"; echo "MINIO_BIN=$HERE/minio-bin/minio"; } >> "$WORK/restore.env"

cat > "$WORK/compose.yml" <<'YML'
# Tạm thời: không ports, không restart, volume riêng theo project s2restore.
services:
  pg:
    image: ${PG_IMAGE}
    environment:
      POSTGRES_USER: s2_owner
      POSTGRES_PASSWORD: ${PG_OWNER_PASSWORD}
      POSTGRES_DB: ai_system
    command: ["postgres", "-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off", "-c", "max_connections=50"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U s2_owner -d ai_system"]
      interval: 3s
      timeout: 3s
      retries: 40
    volumes: ["pgdata:/var/lib/postgresql/data"]
    mem_limit: 1g
  filebox-minio:
    image: ${HELPER_IMAGE}
    entrypoint: ["/usr/local/bin/minio"]
    command: ["server", "/data", "--address", ":9000", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: ${FILEBOX_MINIO_USER}
      MINIO_ROOT_PASSWORD: ${FILEBOX_MINIO_PASSWORD}
    volumes: ["fbminio:/data", "${MINIO_BIN}:/usr/local/bin/minio:ro"]
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:9000/minio/health/live"]
      interval: 3s
      timeout: 3s
      retries: 40
    mem_limit: 1g
  filebox:
    image: ${FB_IMAGE}
    user: "${S2_UID:-1002}:${S2_GID:-1002}"
    init: true
    environment:
      FILEBOX_TOKEN: ${FILEBOX_TOKEN}
      FILEBOX_S3_URL: http://filebox-minio:9000
      FILEBOX_DB: /data/filebox.db
      MINIO_ROOT_USER: ${FILEBOX_MINIO_USER}
      MINIO_ROOT_PASSWORD: ${FILEBOX_MINIO_PASSWORD}
    volumes: ["fbdata:/data"]
    depends_on:
      filebox-minio: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen(\"http://127.0.0.1:9100/health\", timeout=3).status == 200 else 1)"]
      interval: 3s
      timeout: 5s
      retries: 40
    mem_limit: 768m
volumes:
  pgdata:
  fbdata:
  fbminio:
YML

teardown   # dọn sót lần trước (chỉ s2restore_*)
rdc up --no-start pg filebox-minio filebox >/dev/null

# --- volume FileBox/MinIO từ tar (container phụ chỉ ghi vào volume s2restore_*) ---
untar_vol() { docker run --rm -i --pull=never --network none -v "$1":/v "$HELPER_IMAGE" tar -C /v -xpf - < "$2"; }
untar_vol "${RPROJECT}_fbminio" "$B/fbminio.tar"
untar_vol "${RPROJECT}_fbdata" "$B/fbdata.tar"

# --- Postgres: globals (role) -> DB trống -> pg_restore ---
rdc up -d --wait pg >/dev/null
rdc exec -T pg psql -U s2_owner -d postgres -X -q < "$B/pg-globals.sql" > /dev/null 2> "$WORK/globals.err" || true  # "role s2_owner already exists" là bình thường
rdc exec -T pg psql -U s2_owner -d postgres -X -q -v ON_ERROR_STOP=1 -c "DROP DATABASE ai_system" -c "CREATE DATABASE ai_system OWNER s2_owner" >/dev/null
rdc exec -T pg pg_restore -U s2_owner -d ai_system --exit-on-error < "$B/pg.dump" || die "pg_restore loi"
log "pg_restore xong"

# --- Số hàng mỗi bảng khớp manifest (khoảng min..max ghi lúc backup) ---
rdc exec -T pg psql -U s2_owner -d ai_system -X -At -F $'\t' -v ON_ERROR_STOP=1 < "$B/rowcounts.sql" | LC_ALL=C sort -t $'\t' -k1,1 > "$WORK/counts.restored"
awk -F'\t' '
  NR == FNR { lo[$1] = $2 + 0; hi[$1] = $3 + 0; n++; next }
  { seen[$1] = 1
    if (!($1 in lo)) { extra++; next }
    if ($2 + 0 < lo[$1] || $2 + 0 > hi[$1]) { bad++; printf "KHONG KHOP %s: khoi phuc=%s ky vong=%s..%s\n", $1, $2, lo[$1], hi[$1] } }
  END { for (k in lo) if (!(k in seen)) { bad++; printf "THIEU BANG %s\n", k }
        printf "rowcounts: %d bang, loi=%d, bang them=%d\n", n, bad + 0, extra + 0
        exit (bad > 0 || n == 0) }' "$B/rowcounts.tsv" "$WORK/counts.restored" >&2 || die "so hang khong khop manifest"
for r in admin_api hub_api agent_runtime; do
  [ "$(rdc exec -T pg psql -U s2_owner -d ai_system -X -At -c "SELECT count(*) FROM pg_roles WHERE rolname='$r'")" = 1 ] || die "thieu role $r sau khi khoi phuc globals"
done

# --- FileBox: object mẫu tải về đúng hash ---
if [ -s "$B/filebox-sample.tsv" ]; then
  rdc up -d --wait filebox-minio filebox >/dev/null
  IFS=$'\t' read -r fid ver size sha < "$B/filebox-sample.tsv"
  rdc exec -T -e FID="$fid" -e VER="$ver" -e SIZE="$size" -e SHA="$sha" filebox python - <<'PY' || die "mau FileBox khong khop"
import hashlib, os, urllib.parse, urllib.request
ver = os.environ["VER"]
q = "?version=" + urllib.parse.quote(ver) if ver else ""
req = urllib.request.Request(
    "http://127.0.0.1:9100/files/%s/content%s" % (os.environ["FID"], q),
    headers={"Authorization": "Bearer " + os.environ["FILEBOX_TOKEN"]},
)
h, n = hashlib.sha256(), 0
with urllib.request.urlopen(req, timeout=120) as r:
    while True:
        b = r.read(1 << 20)
        if not b:
            break
        h.update(b)
        n += len(b)
if n != int(os.environ["SIZE"]) or h.hexdigest() != os.environ["SHA"]:
    raise SystemExit("MISMATCH size=%d hash=%s" % (n, h.hexdigest()))
print("filebox sample OK (%d bytes)" % n)
PY
  log "filebox: object mau $fid khop hash"
else
  log "CANH BAO: backup khong co object mau FileBox (kho trong luc backup) — bo qua kiem FileBox"
fi
log "restore-test dat voi $(basename "$B")"
