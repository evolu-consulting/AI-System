#!/usr/bin/env bash
# sohoptac2 · FileBox RIÊNG (ADR-0015, quyết định người dùng): sinh token + khoá MinIO riêng vào ./.env, MỘT lần (idempotent: có
# FILEBOX_MINIO_USER rồi thì giữ nguyên), KHÔNG in giá trị. Thay các dòng FILEBOX_* của FileBox dùng chung (token chung, CA) và
# đặt HUB_ATTACH_DRIVER=filebox. Sao lưu .env cũ ở .env.bak-filebox (600). gen-env.sh gọi file này; chạy tay cũng được.
set -euo pipefail
cd "$(dirname "$0")"
umask 077
[ -f .env ] || { echo "filebox-env: chưa có .env (chạy gen-env.sh)"; exit 2; }
# MinIO: image chính thức không còn trên registry ⇒ chép CHỈ-ĐỌC bản nhị phân tĩnh đã có trên host (không sửa/khởi động lại bản gốc).
if [ ! -x minio-bin/minio ]; then
  src="${MINIO_SRC:-$HOME/filebox/bin/minio}"; [ -x "$src" ] || { echo "filebox-env: không thấy $src"; exit 2; }
  mkdir -p minio-bin && cp "$src" minio-bin/minio.new && chmod 755 minio-bin/minio.new && mv minio-bin/minio.new minio-bin/minio
fi
if grep -q '^FILEBOX_MINIO_USER=' .env; then echo "filebox-env: đã có FileBox riêng — giữ nguyên"; exit 0; fi
cp -p .env .env.bak-filebox
tmp=$(mktemp)
grep -v -E '^(FILEBOX_[A-Z_]+|HUB_ATTACH_DRIVER)=' .env > "$tmp"
{
  echo "HUB_ATTACH_DRIVER=filebox"
  echo "FILEBOX_URL=http://filebox:9100"
  echo "FILEBOX_HTTP_HOSTS=filebox"
  echo "FILEBOX_PUBLIC_PATH=/_fb"
  echo "FILEBOX_ORG=ai-system"
  echo "FILEBOX_TOKEN=$(openssl rand -hex 32)"
  echo "FILEBOX_MINIO_USER=fb$(openssl rand -hex 6)"
  echo "FILEBOX_MINIO_PASSWORD=$(openssl rand -hex 24)"
} >> "$tmp"
cat "$tmp" > .env; rm -f "$tmp"; chmod 600 .env .env.bak-filebox
echo "filebox-env: đã sinh token + khoá MinIO riêng vào .env (600); bản cũ: .env.bak-filebox"