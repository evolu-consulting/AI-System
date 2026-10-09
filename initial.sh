#!/usr/bin/env bash
# initial.sh — chuẩn bị máy dev lần đầu (chạy lại nhiều lần vẫn an toàn).
# Chạy từ Git Bash ở gốc repo:  ./initial.sh            (giữ dữ liệu)
#                               ./initial.sh --reset    (XOÁ SẠCH DB dev + Redis rồi seed lại: tenant platform + Evolu)
# Tài khoản dev (CR-051, mật khẩu 1234567890):
#   platform: admin (email admin@evolu.com)
#   evolu:    julian.bui (tenant_admin), thomas.tran, vio.ngo, edgar.nguyen, rowan.nguyen
# Tuỳ chọn env:
#   WSL_DISTRO=Ubuntu  WSL_USER=worker     — nơi chạy Agent Runtime
#   DIFY_SEED_ENV_FILE=<.env chứa DIFY_KEY_*> — seed Dify thật (--apply) sau khi migrate
set -euo pipefail
cd "$(dirname "$0")"

WSL_DISTRO="${WSL_DISTRO:-Ubuntu}"
WSL_USER="${WSL_USER:-worker}"
RESET=0
for a in "$@"; do
  case "$a" in
    --reset) RESET=1 ;;
    *) echo "Tham số lạ: $a"; exit 2 ;;
  esac
done
DEV_PASSWORD=1234567890
EVOLU_MEMBERS=julian.bui,thomas.tran,vio.ngo,edgar.nguyen,rowan.nguyen

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✗ %s\033[0m\n' "$*"; exit 1; }

env_value() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2- | tr -d '"'; }

start_docker() {
  if docker info >/dev/null 2>&1; then ok "Docker đang chạy"; return; fi
  local exe="/c/Program Files/Docker/Docker/Docker Desktop.exe"
  [ -f "$exe" ] || die "Docker chưa chạy và không tìm thấy Docker Desktop"
  warn "Docker chưa chạy — đang bật Docker Desktop…"
  "$exe" >/dev/null 2>&1 &
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && { ok "Docker sẵn sàng"; return; }; sleep 3; done
  die "Docker không lên sau 3 phút"
}

step "1. Công cụ"
command -v bun >/dev/null || die "Thiếu bun (https://bun.sh)"
ok "bun $(bun --version)"
command -v docker >/dev/null || die "Thiếu docker"
start_docker

step "2. .env.local"
bun run keys:dev
# set_env KEY VALUE — ghi/đè một dòng trong .env.local
set_env() {
  if grep -qE "^$1=" .env.local; then sed -i "s|^$1=.*|$1=$2|" .env.local; else echo "$1=$2" >> .env.local; fi
}
set_env SEED_ADMIN_USERNAME admin
set_env SEED_ADMIN_PASSWORD "$DEV_PASSWORD"
set_env SEED_ADMIN_EMAIL admin@evolu.com
ok "platform admin dev: admin / $DEV_PASSWORD (admin@evolu.com)"

step "3. Cài package"
bun install

step "4. Postgres / Redis / Mailpit + migrate + seed"
docker compose up -d --wait
if [ "$RESET" = 1 ]; then
  warn "--reset: xoá sạch DB dev (mọi hội thoại, phòng, tenant) + Redis"
  bun run db:reset:dev -- --yes
  docker compose exec -T redis redis-cli FLUSHALL >/dev/null && ok "Redis đã xoá"
fi
bun run db:setup
ok "tenant evolu + 5 user, agent Evolu Consultant/Invoices, phòng 'Evolu team' được seed khi ./start.sh bật hub-dev"

if [ -n "${DIFY_SEED_ENV_FILE:-}" ]; then
  step "5. Seed Dify thật (DIFY_SEED_ENV_FILE)"
  warn "seed:dify cần admin-api + Hub đang chạy — nếu lỗi, chạy ./start.sh trước rồi:"
  warn "  DIFY_SEED_ENV_FILE=... bun run seed:dify -- --apply --tenant evolu --members $EVOLU_MEMBERS"
  DIFY_SEED_ENV_FILE="$DIFY_SEED_ENV_FILE" bun run seed:dify -- --apply --tenant evolu --members "$EVOLU_MEMBERS"     || warn "seed:dify chưa chạy được (xem trên)"
else
  step "5. Seed Dify thật (lệnh /dich, /summary…) — bỏ qua (đặt DIFY_SEED_ENV_FILE để chạy)"
fi

step "6. Agent Runtime trong WSL ($WSL_DISTRO, user $WSL_USER)"
if ! command -v wsl.exe >/dev/null; then
  warn "Không có wsl.exe — Chat Orchestrator / @agent sẽ không chạy"
else
  wsl.exe -d "$WSL_DISTRO" -u "$WSL_USER" -- bash -l -s <<'EOF' || warn "Chuẩn bị WSL chưa xong (xem trên)"
set -e
command -v uv >/dev/null || { echo "  ✗ thiếu uv trong WSL (curl -LsSf https://astral.sh/uv/install.sh | sh)"; exit 1; }
echo "  ✓ uv $(uv --version | cut -d' ' -f2)"
cd /mnt/d/AI/ai-system/apps/agent-runtime
UV_PROJECT_ENVIRONMENT=$HOME/.venvs/agent-runtime uv sync --frozen
echo "  ✓ venv ~/.venvs/agent-runtime"
mkdir -p ~/combine/work ~/combine/logs
if command -v claude >/dev/null; then
  echo "  ✓ claude CLI $(claude --version 2>/dev/null | head -1)"
else
  echo "  ! thiếu claude CLI trong WSL (npm i -g @anthropic-ai/claude-code hoặc installer chính thức)"
fi
EOF
  ok "Nhớ đăng nhập Claude trong WSL nếu chưa: wsl -d $WSL_DISTRO -u $WSL_USER  →  claude"
fi

step "Xong. Bật stack: ./start.sh"
