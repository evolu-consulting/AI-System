# Shared helpers for the DLC stack scripts on Linux (sourced). bash 4+, python3, curl, tar, unzip.
set -euo pipefail

KIT_LINUX="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT_ROOT="$(cd "$KIT_LINUX/.." && pwd)"
HELPER="$KIT_LINUX/kit_helper.py"

c_step() { printf '\n\033[36m=== %s ===\033[0m\n' "$*"; }
c_ok()   { printf '  \033[32mOK\033[0m  %s\n' "$*"; }
c_warn() { printf '  \033[33m!!\033[0m  %s\n' "$*"; }
die()    { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# read_config [path]: loads the settings and derives paths/urls
read_config() {
    local cfg="${1:-$KIT_LINUX/stack.config.env}"
    [ -f "$cfg" ] || die "config not found: $cfg (copy stack.config.example.env and fill it in)"
    set -a; # shellcheck disable=SC1090
    . "$cfg"; set +a
    SERVICE_MODE="${SERVICE_MODE:-system}"
    case "$SERVICE_MODE" in system|user) ;; *) die "config: SERVICE_MODE must be system or user";; esac
    if [ "$SERVICE_MODE" = user ]; then
        INSTALL_ROOT="${INSTALL_ROOT:-$HOME/dlc}"; [ "$INSTALL_ROOT" = /opt/dlc ] && INSTALL_ROOT="$HOME/dlc"
        SERVICE_USER="$(id -un)"
    fi
    for k in PUBLIC_HOST INSTALL_ROOT KEYCLOAK_HTTPS_PORT KH_PORT ENGINE_PORT FE_PORT APP_PORTS; do
        [ -n "${!k:-}" ] || die "config: $k is required"
    done
    KEYCLOAK_MGMT_PORT="${KEYCLOAK_MGMT_PORT:-9001}"
    ARTIFACTS_DIR="${ARTIFACTS_DIR:-$KIT_ROOT/..}"; ARTIFACTS_DIR="$(cd "$ARTIFACTS_DIR" && pwd)"
    P_APPS="$INSTALL_ROOT/apps"; P_DATA="$INSTALL_ROOT/data"; P_CONFIG="$INSTALL_ROOT/config"
    P_SERVICES="$INSTALL_ROOT/services"; P_LOGS="$INSTALL_ROOT/logs"; P_SECRETS="$INSTALL_ROOT/secrets"
    P_BIN="$INSTALL_ROOT/bin"
    U_KEYCLOAK="https://$PUBLIC_HOST:$KEYCLOAK_HTTPS_PORT"
    U_ISSUER="$U_KEYCLOAK/realms/dlc"
    U_KH="http://127.0.0.1:$KH_PORT"
    U_ENGINE="http://$PUBLIC_HOST:$ENGINE_PORT"
    U_ENGINE_LOCAL="http://127.0.0.1:$ENGINE_PORT"
    U_FE="http://$PUBLIC_HOST:$FE_PORT"
    CA_BUNDLE="$P_CONFIG/ca-bundle.pem"
}

assert_mode_user() {
    if [ "$SERVICE_MODE" = system ]; then
        [ "$(id -u)" -eq 0 ] || die "SERVICE_MODE=system: run this script as root (sudo)"
    else
        [ "$(id -u)" -ne 0 ] || die "SERVICE_MODE=user: run this script as the user that owns the services, not root"
    fi
}

new_secret() { python3 -c "import secrets,sys; print(secrets.token_hex(int(sys.argv[1])))" "${1:-24}"; }

# wait_http URL [seconds] [curl options...]: true once the URL answers with a status < 500
wait_http() {
    local url="$1" secs="${2:-180}"; shift 2 || true
    local t0=$SECONDS code
    while [ $((SECONDS - t0)) -lt "$secs" ]; do
        code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@" "$url" || true)"
        if [ -n "$code" ] && [ "$code" != 000 ] && [ "$code" -lt 500 ]; then return 0; fi
        sleep 3
    done
    return 1
}

# ------------------------------------------------------------------ service env files
# One file per service: <INSTALL_ROOT>/services/<id>.env, KEY='value' lines (read by systemd and by bash), mode 600.

env_set() {   # env_set <id> KEY=value ...   (adds or replaces)
    local id="$1"; shift
    python3 "$HELPER" env-set "$P_SERVICES/$id.env" "$@"
    chmod 600 "$P_SERVICES/$id.env"
}
env_get() { [ -f "$P_SERVICES/$1.env" ] && python3 "$HELPER" env-get "$P_SERVICES/$1.env" "$2" || true; }

# run_with_env <id> cmd...: run a command with exactly that service's environment added
run_with_env() {
    local id="$1"; shift
    ( set -a; # shellcheck disable=SC1090
      . "$P_SERVICES/$id.env"; set +a; "$@" )
}

# svc_exec <id> cmd...: like run_with_env, but as the service user (system mode: the env file stays root-only,
# it is read here and the environment is handed over by setpriv)
svc_exec() {
    local id="$1"; shift
    if [ "$SERVICE_MODE" = system ]; then
        run_with_env "$id" setpriv --reuid="$SERVICE_USER" --regid="$SERVICE_USER" --init-groups "$@"
    else
        run_with_env "$id" "$@"
    fi
}

# ------------------------------------------------------------------ systemd
sysctl_() { if [ "$SERVICE_MODE" = user ]; then systemctl --user "$@"; else systemctl "$@"; fi; }
unit_dir() { if [ "$SERVICE_MODE" = user ]; then echo "$HOME/.config/systemd/user"; else echo /etc/systemd/system; fi; }

# install_unit <id> <description> <workdir> <exec start> [after/wants units...]
install_unit() {
    local id="$1" desc="$2" wd="$3" exec="$4"; shift 4
    local deps="$*" ud; ud="$(unit_dir)"; mkdir -p "$ud"
    local userline="" target="default.target"
    if [ "$SERVICE_MODE" = system ]; then userline="User=$SERVICE_USER"$'\n'"Group=$SERVICE_USER"; target="multi-user.target"; fi
    [ -f "$P_SERVICES/$id.env" ] || : > "$P_SERVICES/$id.env"
    chmod 600 "$P_SERVICES/$id.env"
    cat > "$ud/$id.service" <<EOF
# written by install-stack.sh
[Unit]
Description=$desc
After=network-online.target ${deps}
Wants=network-online.target ${deps}

[Service]
Type=simple
$userline
WorkingDirectory=$wd
EnvironmentFile=$P_SERVICES/$id.env
ExecStart=$exec
Restart=on-failure
RestartSec=10
TimeoutStopSec=30
LimitNOFILE=65536
StandardOutput=append:$P_LOGS/$id.log
StandardError=append:$P_LOGS/$id.log

[Install]
WantedBy=$target
EOF
    sysctl_ daemon-reload
    sysctl_ enable "$id.service" >/dev/null 2>&1
    c_ok "service $id installed ($(unit_dir)/$id.service)"
}

# give the service user the files it needs (system mode)
own() { if [ "$SERVICE_MODE" = system ]; then chown -R "$SERVICE_USER:$SERVICE_USER" "$@"; fi; }
