#!/usr/bin/env bash
# start.sh — bật toàn bộ stack dev (combine:dev) + Agent Runtime trong WSL.
# Chạy từ Git Bash ở gốc repo:  ./start.sh          Ctrl+C để dừng tất cả.
# Tuỳ chọn:
#   --no-runtime      không bật Agent Runtime WSL (chỉ Dify mock / lệnh /)
#   --kill-orphan     tự dừng tiến trình cũ còn giữ cổng :4000/:3001
#   WSL_DISTRO=Ubuntu WSL_USER=worker   SKIP_CLAUDE_CHECK=1 (bỏ gọi thử claude -p)
set -uo pipefail
cd "$(dirname "$0")"

WSL_DISTRO="${WSL_DISTRO:-Ubuntu}"
WSL_USER="${WSL_USER:-worker}"
RUNTIME=1; KILL_ORPHAN=0
for a in "$@"; do
  case "$a" in
    --no-runtime) RUNTIME=0 ;;
    --kill-orphan) KILL_ORPHAN=1 ;;
    *) echo "Tham số lạ: $a"; exit 2 ;;
  esac
done

LOG_DIR=.data/logs
mkdir -p "$LOG_DIR"
COMBINE_LOG="$LOG_DIR/combine.log"
RUNTIME_LOG="$LOG_DIR/runtime.log"
RT_SCRIPT=.data/rt.sh

ok()   { printf '\033[32m[start] ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m[start] ! %s\033[0m\n' "$*"; }
die()  { printf '\033[31m[start] ✗ %s\033[0m\n' "$*"; exit 1; }

# --- Docker ---------------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
  warn "Docker chưa chạy — đang bật Docker Desktop…"
  "/c/Program Files/Docker/Docker/Docker Desktop.exe" >/dev/null 2>&1 &
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
  docker info >/dev/null 2>&1 || die "Docker không lên sau 3 phút"
fi
ok "Docker sẵn sàng"

# --- Cổng bị chiếm (hub-api/admin-api mồ côi) ------------------------------
for port in 4000 3001; do
  pid=$(netstat -ano | awk -v p=":$port" '$2 ~ p"$" && $4 == "LISTENING" {print $5; exit}')
  [ -z "$pid" ] && continue
  if [ "$KILL_ORPHAN" = 1 ]; then
    taskkill //PID "$pid" //T //F >/dev/null && warn "đã dừng PID $pid giữ cổng :$port"
  else
    die "Cổng :$port đang bị PID $pid giữ (stack cũ?). Dừng nó hoặc chạy ./start.sh --kill-orphan"
  fi
done

# --- Runtime WSL: IP NAT + kiểm Claude --------------------------------------
stop_runtime() {
  wsl.exe -d "$WSL_DISTRO" -u "$WSL_USER" -- pkill -TERM -f "python -m agent_runtime" </dev/null >/dev/null 2>&1 || true
}

if [ "$RUNTIME" = 1 ]; then
  command -v wsl.exe >/dev/null || die "Không có wsl.exe (dùng --no-runtime để bỏ Runtime)"
  WSL_HOST_IP=$(wsl.exe -d "$WSL_DISTRO" -u "$WSL_USER" -- ip route | tr -d '\r' | awk '/^default/ {print $3; exit}')
  [[ "$WSL_HOST_IP" =~ ^[0-9.]+$ ]] || die "Không lấy được IP Windows nhìn từ WSL"
  export HUB_PUBLIC_INTERNAL_URL="http://$WSL_HOST_IP:4000"
  ok "WSL NAT: Hub nội bộ = $HUB_PUBLIC_INTERNAL_URL"

  if [ "${SKIP_CLAUDE_CHECK:-0}" != 1 ]; then
    echo "[start] kiểm đăng nhập Claude trong WSL ($WSL_USER)… (~10 s)"
    reply=$(wsl.exe -d "$WSL_DISTRO" -u "$WSL_USER" -- bash -lc 'timeout 90 claude -p "Reply with exactly: OK" 2>&1' </dev/null)
    if [[ "$reply" != *OK* ]]; then
      printf '%s\n' "$reply" | tail -5
      die "Claude trong WSL chưa đăng nhập/không trả lời. Chạy: wsl -d $WSL_DISTRO -u $WSL_USER → claude (login), rồi ./start.sh lại"
    fi
    ok "Claude trong WSL đã đăng nhập"
  fi
  stop_runtime  # dọn Runtime cũ nếu còn

  cat > "$RT_SCRIPT" <<EOF
mkdir -p ~/combine/work ~/combine/logs && cd /mnt/d/AI/ai-system/apps/agent-runtime
export UV_PROJECT_ENVIRONMENT=\$HOME/.venvs/agent-runtime APP_ENV=development AGENT_RT_PROVIDERS=claude-sub,dify AGENT_RT_HUB_URL=$HUB_PUBLIC_INTERNAL_URL AGENT_RT_DATABASE_URL=postgres://agent_runtime:agent_runtime_dev_pw@localhost:5432/ai_system REDIS_URL=redis://localhost:6379 AGENT_RT_WORKER_ID=combine AGENT_RT_WORK_DIR=\$HOME/combine/work AGENT_RT_LOG_DIR=\$HOME/combine/logs
exec uv run --frozen --no-sync python -m agent_runtime
EOF
fi

# --- Dừng khi Ctrl+C / thoát ------------------------------------------------
cleanup() {
  trap - EXIT INT TERM
  echo; echo "[start] đang dừng…"
  [ "$RUNTIME" = 1 ] && stop_runtime
  [ -n "${WAITER_PID:-}" ] && kill "$WAITER_PID" 2>/dev/null
  ok "đã dừng (log: $LOG_DIR/)"
}
trap cleanup EXIT INT TERM

# --- Bật Runtime khi stack sẵn sàng (chạy nền) ------------------------------
: > "$COMBINE_LOG"
if [ "$RUNTIME" = 1 ]; then
  (
    for _ in $(seq 1 300); do grep -q "\[combine\] sẵn sàng" "$COMBINE_LOG" && break; sleep 1; done
    grep -q "\[combine\] sẵn sàng" "$COMBINE_LOG" || exit 0
    echo "[start] bật Agent Runtime WSL (log: $RUNTIME_LOG)…"
    wsl.exe -d "$WSL_DISTRO" -u "$WSL_USER" -- bash -l -s < "$RT_SCRIPT" > "$RUNTIME_LOG" 2>&1 &
    for _ in $(seq 1 90); do
      grep -q "runtime.ready" "$RUNTIME_LOG" && { printf '\033[32m[start] ✓ Agent Runtime sẵn sàng — mở Chat http://localhost:3100\033[0m\n'; exit 0; }
      sleep 1
    done
    printf '\033[31m[start] ✗ Runtime chưa ready sau 90 s — xem %s\033[0m\n' "$RUNTIME_LOG"
  ) &
  WAITER_PID=$!
fi

# --- Stack chính (foreground) ----------------------------------------------
bun run combine:dev 2>&1 | tee "$COMBINE_LOG"
