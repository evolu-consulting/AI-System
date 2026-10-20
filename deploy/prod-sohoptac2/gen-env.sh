#!/usr/bin/env bash
# sohoptac2 · chạy TRÊN máy chủ (deploy.ps1 gọi). Sinh bí mật MỘT lần (không ghi đè, không in giá trị nào), chuẩn bị thư mục dữ
# liệu, bản sao đăng nhập Claude và CLI. Chỉ đụng ~/workspace/sohoptac2.
set -euo pipefail
cd "$(dirname "$0")"
umask 077
rnd() { openssl rand -hex "$1"; }

if [ -f .env ]; then echo "gen-env: .env đã có — giữ nguyên"; else
  OWNER_PW=$(rnd 24); ADMIN_API_PW=$(rnd 24); HUB_API_PW=$(rnd 24); RT_PW=$(rnd 24)
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  openssl genpkey -algorithm ed25519 -out "$tmp/jwt.pem" 2>/dev/null
  openssl pkey -in "$tmp/jwt.pem" -pubout -out "$tmp/jwt.pub"
  oneline() { awk '{printf "%s\\n", $0}' "$1"; }
  P_CONTRACTS=18431; P_ADMIN=18432; P_CHAT=18433; P_HUB=18434
  ORIGINS="http://localhost:$P_CONTRACTS,http://localhost:$P_ADMIN,http://localhost:$P_CHAT,http://localhost:$P_HUB"
  cat > .env <<EOF
S2_UID=$(id -u)
S2_GID=$(id -g)
S2_PORT_CONTRACTS=$P_CONTRACTS
S2_PORT_ADMIN=$P_ADMIN
S2_PORT_CHAT=$P_CHAT
S2_PORT_HUB=$P_HUB
S2_PUBLIC_ADMIN_URL=http://localhost:$P_ADMIN
S2_PUBLIC_CHAT_URL=http://localhost:$P_CHAT
S2_PUBLIC_HUB_URL=http://localhost:$P_HUB
PG_OWNER_PASSWORD=$OWNER_PW
APP_ENV=production
LOG_LEVEL=info
DATABASE_URL=postgres://s2_owner:$OWNER_PW@pg:5432/ai_system
ADMIN_API_DATABASE_URL=postgres://admin_api:$ADMIN_API_PW@pg:5432/ai_system
HUB_DATABASE_URL=postgres://hub_api:$HUB_API_PW@pg:5432/ai_system
AGENT_RT_DATABASE_URL=postgres://agent_runtime:$RT_PW@pg:5432/ai_system
REDIS_URL=redis://redis:6379
JWT_PRIVATE_KEY="$(oneline "$tmp/jwt.pem")"
JWT_PUBLIC_KEY="$(oneline "$tmp/jwt.pub")"
JWT_KID=s2-$(date +%Y-%m)
SECRET_MASTER_KEY=$(openssl rand -base64 32)
HUB_SECRETS_KEY=$(openssl rand -base64 32)
HUB_INTERNAL_TOKEN=$(openssl rand -base64 36 | tr -d '\n')
SEED_ADMIN_USERNAME=admin
PORT=3001
TRUST_PROXY_HOPS=1
CORS_ORIGINS=$ORIGINS
ADMIN_WEB_URL=http://localhost:$P_ADMIN
ADMIN_HUB_URL=http://hub-api:4000
HUB_PORT=4000
HUB_CORS_ORIGINS=$ORIGINS
HUB_PUBLIC_INTERNAL_URL=http://hub-api:4000
HUB_STUDIO_DIST=/app/apps/studio-web/dist
HUB_ATTACH_DRIVER=local
HUB_ATTACH_DIR=/data/attachments
HUB_SEED_PROFILE=claude-sub-1
HUB_NOTIFY_BASE_URL=http://localhost:$P_CONTRACTS
AI_PROVIDER=subscription
AI_SUB_CLI_PATH=/opt/claude/claude
AI_SUB_CLAUDE_CONFIG_DIR=/claude-home/.claude
AI_SUB_MAX_CONCURRENCY=2
EOF
  chmod 600 .env
  echo "gen-env: đã tạo .env (600). SAO LƯU: mất SECRET_MASTER_KEY/HUB_SECRETS_KEY = mất mọi secret đã lưu."
fi

# Mật khẩu platform admin: CHỈ ở ADMIN_CREDENTIALS.txt (600); setup.sh đọc khi seed.
if [ ! -f ADMIN_CREDENTIALS.txt ]; then
  pw="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
  printf 'sohoptac2 platform admin (tenant: platform)\nusername: admin\npassword: %s\n' "$pw" > ADMIN_CREDENTIALS.txt
  chmod 600 ADMIN_CREDENTIALS.txt; unset pw
  echo "gen-env: đã tạo ADMIN_CREDENTIALS.txt (600)"
fi

mkdir -p data/attachments runtime-data/work runtime-data/logs claude-bin
chmod 700 data runtime-data

# Claude CLI: chép bản đang cài của user (auto-update của host không làm mất file đang gắn vào container).
src_cli="$(readlink -f "$HOME/.local/bin/claude" 2>/dev/null || true)"
if [ -x "$src_cli" ]; then
  if ! cmp -s "$src_cli" claude-bin/claude 2>/dev/null; then cp "$src_cli" claude-bin/claude.new && chmod 755 claude-bin/claude.new && mv claude-bin/claude.new claude-bin/claude; fi
elif [ ! -x claude-bin/claude ]; then echo "gen-env: không tìm thấy ~/.local/bin/claude"; exit 2; fi

# Bản sao đăng nhập gói Claude (ai-sub): chép MỘT lần từ ~/.claude của user, sau đó project tự giữ (CLI tự làm mới token).
# hub-api: CLAUDE_CONFIG_DIR=/claude-home/.claude; agent-runtime: HOME=/claude-home (⇒ ~/.claude). Không /login ở đây.
if [ ! -f claude-home/.claude/.credentials.json ]; then
  [ -f "$HOME/.claude/.credentials.json" ] || { echo "gen-env: ~/.claude/.credentials.json không có — user phải đăng nhập Claude CLI trước"; exit 2; }
  mkdir -p claude-home/.claude; chmod 700 claude-home claude-home/.claude
  cp -p "$HOME/.claude/.credentials.json" claude-home/.claude/.credentials.json
  [ -f "$HOME/.claude.json" ] && { cp -p "$HOME/.claude.json" claude-home/.claude.json; cp -p "$HOME/.claude.json" claude-home/.claude/.claude.json; }
  chmod 600 claude-home/.claude/.credentials.json claude-home/.claude.json claude-home/.claude/.claude.json 2>/dev/null || true
  echo "gen-env: đã chép đăng nhập Claude vào claude-home/ (600)"
fi
