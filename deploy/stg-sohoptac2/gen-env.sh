#!/usr/bin/env bash
# sohoptac2-stg · sinh .env + mat khau (600) CHO STAGING. Khong doc/in/copy bat ky bi mat nao cua prod. Tu choi chay neu da co .env.
# Mau: deploy/prod-sohoptac2/env.template (cung bo khoa), nhung URL cong khai = http://127.0.0.1:2843x, APP_ENV=development (fixture seed duoc).
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && { echo "gen-env: .env da co - giu nguyen"; exit 0; }
umask 077
rnd() { openssl rand -hex "$1"; }
OWNER_PW=$(rnd 24); ADMIN_API_PW=$(rnd 24); HUB_API_PW=$(rnd 24); RT_PW=$(rnd 24)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
openssl genpkey -algorithm ed25519 -out "$tmp/jwt.pem" 2>/dev/null
openssl pkey -in "$tmp/jwt.pem" -pubout -out "$tmp/jwt.pub"
oneline() { awk '{printf "%s\\n", $0}' "$1"; }
PC=28431; PA=28432; PCH=28433; PH=28434; PCM=28435
B=http://127.0.0.1
ORIGINS="$B:$PC,$B:$PA,$B:$PCH,$B:$PH,$B:$PCM"
cat > .env <<EOF
S2_UID=$(id -u)
S2_GID=$(id -g)
S2_PORT_CONTRACTS=$PC
S2_PORT_ADMIN=$PA
S2_PORT_CHAT=$PCH
S2_PORT_HUB=$PH
S2_PORT_COMMUNITY=$PCM
S2_PUBLIC_CONTRACTS_URL=$B:$PC
S2_PUBLIC_ADMIN_URL=$B:$PA
S2_PUBLIC_CHAT_URL=$B:$PCH
S2_PUBLIC_HUB_URL=$B:$PH
S2_PUBLIC_COMMUNITY_URL=$B:$PCM
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
JWT_KID=stg-$(date +%Y-%m)
SECRET_MASTER_KEY=$(openssl rand -base64 32)
HUB_SECRETS_KEY=$(openssl rand -base64 32)
HUB_INTERNAL_TOKEN=$(openssl rand -base64 36 | tr -d '\n')
SEED_ADMIN_USERNAME=admin
PORT=3001
TRUST_PROXY_HOPS=1
CORS_ORIGINS=$ORIGINS
ADMIN_WEB_URL=$B:$PA
ADMIN_HUB_URL=http://hub-api:4000
LOGIN_IP_MAX_ATTEMPTS=100000
HUB_PORT=4000
HUB_CORS_ORIGINS=$ORIGINS
HUB_PUBLIC_INTERNAL_URL=http://hub-api:4000
HUB_STUDIO_DIST=/app/apps/studio-web/dist
HUB_ATTACH_DRIVER=local
HUB_ATTACH_DIR=/data/attachments
HUB_NOTIFY_BASE_URL=$B:$PC
HUB_SEED_FIXTURES=1
CONTRACTS_APPROVAL_ENGINE=on
AI_PROVIDER=subscription
AI_SUB_MAX_CONCURRENCY=1
FILEBOX_TOKEN=$(rnd 24)
FILEBOX_MINIO_USER=stgbox
FILEBOX_MINIO_PASSWORD=$(rnd 16)
FILEBOX_URL=http://filebox:9100
FILEBOX_HTTP_HOSTS=filebox
FILEBOX_PUBLIC_PATH=/_fb
FILEBOX_ORG=stg
EOF
chmod 600 .env
# Mat khau tai khoan stg (platform admin + demo-owner): file rieng 600; chi doc boi seed/smoke trong container.
printf '%s' "$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)Aa1" > ADMIN.pw
printf '%s' "$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)Aa1" > DEMO_OWNER.pw
chmod 600 ADMIN.pw DEMO_OWNER.pw
mkdir -p data/attachments out pw
echo "gen-env: da tao .env + ADMIN.pw + DEMO_OWNER.pw (600)"