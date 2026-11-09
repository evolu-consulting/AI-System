#!/usr/bin/env bash
# sohoptac2-staging · sinh .env + mat khau (600) cho STAGING tren ten mien -test. Khong doc/in/copy bat ky bi mat nao cua prod (moi khoa sinh MOI bang openssl).
# Tu choi ghi de .env da co (giu nguyen => du lieu/khoa on dinh qua cac lan up). APP_ENV=development (fixture seed duoc, KHONG phai production).
# Email: HUB_NOTIFY_MODE=off va khong co SMTP_PASSWORD/HUB_SMTP_* => khong gui mail that di dau ca.
set -euo pipefail
cd "$(dirname "$0")"
# .env da co: giu nguyen khoa/mat khau, chi BO SUNG khoa cau hinh moi (idempotent).
ensure() { grep -q "^$1=" .env || { echo "$1=$2" >> .env; echo "gen-env: them $1=$2"; }; }
# Module quy trinh mo cho MOI nguoi dung (Yeu cau, Viec cua toi, duyet/ky): vang => `off` (HUB_FROZEN_MODULES mac dinh off) => 404.
[ -f .env ] && { ensure HUB_PROCESS_ROUTES all; echo "gen-env: .env da co - giu nguyen"; exit 0; }
[ "${1:-}" = "--dry-run" ] && { echo "gen-env[dry-run]: se tao .env (600) + ADMIN.pw + DEMO_OWNER.pw (600) + data/ out/; cong 127.0.0.1:28541..28544; URL https://{app-test,ai-test,ai-test-admin,ai-test-hub}.<domain>"; exit 0; }
umask 077
D="${S2_BASE_DOMAIN:-evoluconsulting.com}"
[[ "$D" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] || { echo "gen-env: S2_BASE_DOMAIN khong hop le"; exit 2; }
rnd() { openssl rand -hex "$1"; }
OWNER_PW=$(rnd 24); ADMIN_API_PW=$(rnd 24); HUB_API_PW=$(rnd 24); RT_PW=$(rnd 24)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
openssl genpkey -algorithm ed25519 -out "$tmp/jwt.pem" 2>/dev/null
openssl pkey -in "$tmp/jwt.pem" -pubout -out "$tmp/jwt.pub"
oneline() { awk '{printf "%s\\n", $0}' "$1"; }
PC=28541; PA=28542; PCH=28543; PH=28544
U_C="https://app-test.$D"; U_A="https://ai-test-admin.$D"; U_CH="https://ai-test.$D"; U_H="https://ai-test-hub.$D"
ORIGINS="$U_C,$U_A,$U_CH,$U_H"
cat > .env <<EOF
S2_STACK=stg-test
S2_UID=$(id -u)
S2_GID=$(id -g)
S2_PORT_CONTRACTS=$PC
S2_PORT_ADMIN=$PA
S2_PORT_CHAT=$PCH
S2_PORT_HUB=$PH
S2_PUBLIC_CONTRACTS_URL=$U_C
S2_PUBLIC_ADMIN_URL=$U_A
S2_PUBLIC_CHAT_URL=$U_CH
S2_PUBLIC_HUB_URL=$U_H
S2_PUBLIC_COMMUNITY_URL=$U_C/community
PG_OWNER_PASSWORD=$OWNER_PW
APP_ENV=development
LOG_LEVEL=info
LOG_FORMAT=json
DATABASE_URL=postgres://s2_owner:$OWNER_PW@pg:5432/ai_system
ADMIN_API_DATABASE_URL=postgres://admin_api:$ADMIN_API_PW@pg:5432/ai_system
HUB_DATABASE_URL=postgres://hub_api:$HUB_API_PW@pg:5432/ai_system
AGENT_RT_DATABASE_URL=postgres://agent_runtime:$RT_PW@pg:5432/ai_system
REDIS_URL=redis://redis:6379
JWT_PRIVATE_KEY="$(oneline "$tmp/jwt.pem")"
JWT_PUBLIC_KEY="$(oneline "$tmp/jwt.pub")"
JWT_KID=stgtest-$(date +%Y-%m)
SECRET_MASTER_KEY=$(openssl rand -base64 32)
HUB_SECRETS_KEY=$(openssl rand -base64 32)
HUB_INTERNAL_TOKEN=$(openssl rand -base64 36 | tr -d '\n')
SEED_ADMIN_USERNAME=admin
PORT=3001
TRUST_PROXY_HOPS=3
CORS_ORIGINS=$ORIGINS
ADMIN_WEB_URL=$U_A
ADMIN_HUB_URL=http://hub-api:4000
LOGIN_IP_MAX_ATTEMPTS=100000
HUB_PORT=4000
HUB_CORS_ORIGINS=$ORIGINS
HUB_PUBLIC_INTERNAL_URL=http://hub-api:4000
HUB_STUDIO_DIST=/app/apps/studio-web/dist
HUB_ATTACH_DRIVER=local
HUB_ATTACH_DIR=/data/attachments
HUB_NOTIFY_BASE_URL=$U_C
HUB_NOTIFY_MODE=off
HUB_SEED_FIXTURES=1
HUB_PROCESS_ENGINE=on
HUB_PROCESS_ROUTES=all
ESIGN_PROVIDERS=selfsign
CONTRACTS_APPROVAL_ENGINE=on
AI_PROVIDER=subscription
AI_SUB_MAX_CONCURRENCY=1
FILEBOX_TOKEN=$(rnd 24)
FILEBOX_MINIO_USER=stgtestbox
FILEBOX_MINIO_PASSWORD=$(rnd 16)
FILEBOX_URL=http://filebox:9100
FILEBOX_HTTP_HOSTS=filebox
FILEBOX_PUBLIC_PATH=/_fb
FILEBOX_ORG=stgtest
EOF
chmod 600 .env
# Mat khau tai khoan staging (platform admin + demo-owner): file rieng 600; chi doc boi seed trong container. Doc bang `cat` tren host, khong dan vao chat/commit.
printf '%s' "$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)Aa1" > ADMIN.pw
printf '%s' "$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)Aa1" > DEMO_OWNER.pw
chmod 600 ADMIN.pw DEMO_OWNER.pw
mkdir -p data/attachments out edge-backup
echo "gen-env: da tao .env + ADMIN.pw + DEMO_OWNER.pw (600)"
