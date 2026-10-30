#!/usr/bin/env bash
# Install the DLC stack on one Linux host: Keycloak (https), the knowledge store (KH, 127.0.0.1 only), the DLC
# engine and the default frontend, each a systemd service (system units as SERVICE_USER, or --user units).
#
# Idempotent: re-running replaces program files and unit files, keeps data, secrets and the certificate.
# Order: folders -> unpack -> Keycloak (cert, realm, service) -> KH (.env, service) -> engine -> frontend -> firewall.
# Then: configure-claude.sh -> seed-stack.sh -> verify-stack.sh
#
#   sudo ./install-stack.sh --config ./stack.config.env          # SERVICE_MODE=system
#   ./install-stack.sh --config ./stack.config.env               # SERVICE_MODE=user
. "$(dirname "$0")/common.sh"
CONFIG=""; SKIP_FIREWALL=0
while [ $# -gt 0 ]; do case "$1" in
    --config) CONFIG="$2"; shift 2;; --skip-firewall) SKIP_FIREWALL=1; shift;;
    *) die "unknown option $1";; esac; done
read_config "$CONFIG"
assert_mode_user

c_step "Prerequisites"
for b in python3 curl tar unzip git openssl; do command -v "$b" >/dev/null || die "$b is required (install it first)"; done
python3 -c 'import sys; assert sys.version_info >= (3, 10)' || die "python3 3.10+ required"
if [ "$SERVICE_MODE" = user ]; then
    systemctl --user is-system-running >/dev/null 2>&1 || systemctl --user status >/dev/null 2>&1 || die "systemd --user is not available for $(id -un)"
    [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" = yes ] || c_warn "lingering is off: services stop when you log out (sudo loginctl enable-linger $(id -un))"
fi
for port in "$KEYCLOAK_HTTPS_PORT" "$KEYCLOAK_MGMT_PORT" "$KH_PORT" "$ENGINE_PORT" "$FE_PORT"; do
    if ss -ltnH "( sport = :$port )" 2>/dev/null | grep -q .; then
        # a port held by our own service (re-run) is fine
        if ! ss -ltnpH "( sport = :$port )" 2>/dev/null | grep -qE 'java|KnowledgeHub|dlc'; then c_warn "port $port is already in use"; fi
    fi
done
c_ok "python3 $(python3 -c 'import platform; print(platform.python_version())'), git, curl, openssl"

c_step "Folders"
if [ "$SERVICE_MODE" = system ] && ! id "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir "/var/lib/$SERVICE_USER" --shell /bin/bash "$SERVICE_USER"
    c_ok "service user $SERVICE_USER created"
fi
mkdir -p "$P_APPS" "$P_DATA/dlc/work" "$P_DATA/dlc/packs" "$P_DATA/dlc/targets" "$P_DATA/fe" "$P_CONFIG" "$P_LOGS" "$P_BIN"
install -d -m 700 "$P_SECRETS" "$P_SERVICES"
c_ok "$INSTALL_ROOT ($SERVICE_MODE mode, services run as $SERVICE_USER)"

unpack_fresh() {   # unpack_fresh <archive> <dest>: program files replaced, data folders beside them kept
    local src="$ARTIFACTS_DIR/$1" dest="$2" tmp
    [ -f "$src" ] || die "artifact missing: $src"
    tmp="$(mktemp -d)"
    case "$src" in *.zip) unzip -q "$src" -d "$tmp";; *) tar -xzf "$src" -C "$tmp";; esac
    local inner; inner="$(find "$tmp" -mindepth 1 -maxdepth 1)"
    [ "$(echo "$inner" | wc -l)" -eq 1 ] && [ -d "$inner" ] || inner="$tmp"
    mkdir -p "$dest"
    chmod -R u+w "$dest"                  # some packages ship read-only files (the JDK's legal/): allow the overwrite
    cp -a "$inner/." "$dest/"; rm -rf "$tmp"
    c_ok "unpacked $1 -> $dest"
}

c_step "Unpack"
# re-run / upgrade: stop our services first (a running program cannot be overwritten); the ones that were
# running are started again at the end
WAS_ACTIVE=()
for u in dlc-fe dlc-engine dlc-kh dlc-keycloak; do
    if [ -f "$(unit_dir)/$u.service" ] && sysctl_ is-active --quiet "$u"; then WAS_ACTIVE+=("$u"); sysctl_ stop "$u"; fi
done
[ "${#WAS_ACTIVE[@]}" -gt 0 ] && c_ok "stopped for the upgrade: ${WAS_ACTIVE[*]}"
JDK="$P_APPS/jdk21"; KC="$P_APPS/keycloak"; KH="$P_APPS/kh"; DLC="$P_APPS/dlc"; FE="$P_APPS/fe"
unpack_fresh "$JDK_TAR" "$JDK"
unpack_fresh "$KEYCLOAK_ZIP" "$KC"
unpack_fresh "$KH_TAR" "$KH"
unpack_fresh "$DLC_TAR" "$DLC"
unpack_fresh "$FE_TAR" "$FE"
"$JDK/bin/java" -version 2>&1 | head -1 | sed 's/^/  java: /'

# ------------------------------------------------------------------ Keycloak
c_step "Keycloak (https $KEYCLOAK_HTTPS_PORT)"
P12="$P_SECRETS/keycloak-tls.p12"; P12PW="$P_SECRETS/keycloak-tls.pass"; CER="$P_CONFIG/keycloak-tls.cer"
if [ ! -f "$P12" ]; then
    new_secret 16 | tr -d '\n' > "$P12PW"; chmod 600 "$P12PW"
    SAN="ip:127.0.0.1,dns:localhost"
    if [[ "$PUBLIC_HOST" =~ ^[0-9.]+$ ]]; then SAN="ip:$PUBLIC_HOST,$SAN"; else SAN="dns:$PUBLIC_HOST,$SAN"; fi
    "$JDK/bin/keytool" -genkeypair -alias keycloak -keyalg RSA -keysize 2048 -validity 825 -storetype PKCS12 \
        -keystore "$P12" -storepass "$(cat "$P12PW")" -dname "CN=$PUBLIC_HOST" -ext "SAN=$SAN" >/dev/null 2>&1
    "$JDK/bin/keytool" -exportcert -alias keycloak -keystore "$P12" -storepass "$(cat "$P12PW")" -rfc -file "$CER" >/dev/null 2>&1
    chmod 600 "$P12"
    c_ok "self-signed certificate for $PUBLIC_HOST created ($CER)"
else c_ok "certificate kept ($P12)"; fi
# trust bundle for the engine and the frontend backend: the system CAs + the Keycloak certificate
SYS_CA=""; for f in /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt /etc/ssl/ca-bundle.pem; do [ -f "$f" ] && SYS_CA="$f" && break; done
{ [ -n "$SYS_CA" ] && cat "$SYS_CA"; cat "$CER"; } > "$CA_BUNDLE"
if [ "$SERVICE_MODE" = system ] && command -v update-ca-certificates >/dev/null; then
    cp "$CER" /usr/local/share/ca-certificates/dlc-keycloak.crt && update-ca-certificates >/dev/null 2>&1 && c_ok "certificate trusted system-wide"
fi

ADMIN_FILE="$P_SECRETS/keycloak-admin.txt"
[ -f "$ADMIN_FILE" ] || { new_secret 16 | tr -d '\n' > "$ADMIN_FILE"; chmod 600 "$ADMIN_FILE"; }
# sign-in theme (the web's style 24); the realm template names it (loginTheme), so it must be there before the import
mkdir -p "$KC/themes" && cp -r "$KIT_ROOT/keycloak/themes/." "$KC/themes/"
python3 "$HELPER" render-realm "$KIT_ROOT/keycloak/realm-dlc.template.json" "$KC/data/import/realm-dlc.json" \
    --host "$PUBLIC_HOST" --fe-port "$FE_PORT" --engine-port "$ENGINE_PORT" \
    --customer-origin "${CUSTOMER_FE_ORIGIN:-http://localhost:3000}" --customer-redirect "${CUSTOMER_FE_REDIRECT:-http://localhost:3000/*}"
cat > "$KC/conf/keycloak.conf" <<EOF
# written by install-stack.sh
hostname=https://$PUBLIC_HOST:$KEYCLOAK_HTTPS_PORT
https-port=$KEYCLOAK_HTTPS_PORT
http-enabled=false
https-key-store-file=$P12
https-key-store-password=$(cat "$P12PW")
http-management-port=$KEYCLOAK_MGMT_PORT
db=dev-file
health-enabled=true
EOF
chmod 600 "$KC/conf/keycloak.conf"
env_set dlc-keycloak "JAVA_HOME=$JDK" "PATH=$JDK/bin:/usr/local/bin:/usr/bin:/bin" \
    "KC_BOOTSTRAP_ADMIN_USERNAME=admin" "KC_BOOTSTRAP_ADMIN_PASSWORD=$(cat "$ADMIN_FILE")"
own "$INSTALL_ROOT"
install_unit dlc-keycloak "DLC Keycloak (realm dlc)" "$KC" "$KC/bin/kc.sh start --import-realm"
sysctl_ restart dlc-keycloak
if wait_http "$U_ISSUER/.well-known/openid-configuration" 300 --cacert "$CER"; then c_ok "Keycloak up: $U_ISSUER"
else c_warn "Keycloak did not answer within 5 minutes - see $P_LOGS/dlc-keycloak.log"; fi

# ------------------------------------------------------------------ KH
c_step "Knowledge store (127.0.0.1:$KH_PORT)"
KEYFILE="$ARTIFACTS_DIR/$KH_SIGNING_KEY_FILE"
[ -f "$KEYFILE" ] || die "signing key missing: $KEYFILE (openssl genpkey -algorithm ed25519 -out kh-signing-key.pem)"
{ sed "s/__KH_PORT__/$KH_PORT/" "$KIT_LINUX/kh.agents.env"
  printf '\nKH_PRINCIPAL_SIGNING_KEY="%s"\n' "$(awk '{printf "%s\\n", $0}' "$KEYFILE" | sed 's/\\n$//')"
} > "$KH/.env"
chmod 600 "$KH/.env"
env_set dlc-kh "KH_NO_TRAY=1" "HOME=$KH"
own "$INSTALL_ROOT"
install_unit dlc-kh "DLC Knowledge store (agents, local only)" "$KH" "$KH/KnowledgeHub"
sysctl_ restart dlc-kh
if wait_http "$U_KH/health" 300; then c_ok "KH up: $U_KH"; else c_warn "KH did not answer - see $P_LOGS/dlc-kh.log and $KH/logs/app.log"; fi

# ------------------------------------------------------------------ DLC engine
c_step "DLC engine ($ENGINE_PORT)"
DD="$P_DATA/dlc"; RAG_LOCAL="$P_CONFIG/rag.local.json"
[ -f "$RAG_LOCAL" ] || cat > "$RAG_LOCAL" <<EOF
{"rag_url": "$U_KH", "rag_ns": "dlc_line", "project": "dlc", "pack_id": "spec",
 "header_run": "X-KH-Run", "header_unit": "X-KH-Unit", "header_attempt": "X-KH-Attempt",
 "header_lease": "X-KH-Lease", "header_epoch": "X-KH-Epoch", "redaction_packs": ["kh-default@1"],
 "include_people_lanes": true}
EOF
# this knowledge store serves only the engine: its project knowledge (the imported lessons) is matched by meaning
python3 - "$RAG_LOCAL" <<'PY'
import json, sys
p = sys.argv[1]; d = json.load(open(p))
if "include_people_lanes" not in d:
    d["include_people_lanes"] = True; json.dump(d, open(p, "w"))
PY
SVC_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
env_set dlc-engine \
    "LINE_HOST=0.0.0.0" "LINE_PORT=$ENGINE_PORT" "LINE_DB=$DD/line.db" "LINE_WORKROOT=$DD/work" \
    "LINE_LLM=cli" "LINE_MAX_USD_RUN=${MAX_USD_RUN:-6}" "LINE_MAX_PARALLEL_UNITS=${MAX_PARALLEL_UNITS:-3}" \
    "LINE_HUMAN_MODE=${HUMAN_MODE:-decide}" "LINE_FGRAPH=1" "LINE_AUTO_RESUME=1" "LINE_PROFILE=agents" "LINE_MAX_ACTIVE_AGENTS=10" "LINE_LEARN=1" "LINE_LEARN_SERVE_MAX_CHARS=4000" \
    "LINE_RAG=$( [ -n "$(env_get dlc-engine LINE_RAG 2>/dev/null)" ] && env_get dlc-engine LINE_RAG || echo off )" \
    "LINE_RAG_LOCAL=$RAG_LOCAL" \
    "LINE_AUTH_ISSUER=$U_ISSUER" "LINE_AUTH_AUDIENCE=dlc-api" "LINE_AUTH_ROLE_USER=dlc-user" "LINE_AUTH_ROLE_ADMIN=dlc-admin" \
    "LINE_AUTH_BOARD_CLIENT=dlc-fe" "LINE_CORS_ORIGINS=$U_FE,${CUSTOMER_FE_ORIGIN:-}" \
    "LINE_PUBLIC_HOST=$PUBLIC_HOST" "LINE_APP_PORTS=$APP_PORTS" "LINE_PYTHON=python3" \
    "DLC_HOME=$DD" "DLC_WORKSPACE_ROOT=${WORKSPACE_ROOT:-}" "HOME=$SVC_HOME" "PYTHONIOENCODING=utf-8" "LANG=C.UTF-8" "SSL_CERT_FILE=$CA_BUNDLE" \
    "PATH=$P_BIN:$SVC_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
own "$INSTALL_ROOT"
install_unit dlc-engine "DLC Engine (API + board)" "$DD" "$DLC/dlc serve --resume" dlc-kh.service
# not started yet: Claude for the engine (configure-claude.sh) comes first

# ------------------------------------------------------------------ frontend
c_step "Default frontend ($FE_PORT)"
FD="$P_DATA/fe"
env_set dlc-fe \
    "SDLC_HOST=0.0.0.0" "SDLC_PORT=$FE_PORT" "SDLC_DATA_DIR=$FD" "SDLC_DB=$FD/sdlc.db" \
    "SDLC_ENGINE_URL=$U_ENGINE_LOCAL" "SDLC_AUTH_ISSUER=$U_ISSUER" "SDLC_AUTH_CLIENT=dlc-fe" "SDLC_AUTH_AUDIENCE=dlc-api" \
    "SDLC_PUBLIC_URL=$U_FE" "HOME=$SVC_HOME" "PYTHONIOENCODING=utf-8" "LANG=C.UTF-8" "SSL_CERT_FILE=$CA_BUNDLE"
own "$INSTALL_ROOT"
install_unit dlc-fe "DLC Frontend" "$FD" "$FE/dlc-fe serve" dlc-engine.service

# ------------------------------------------------------------------ firewall
if [ "$SKIP_FIREWALL" -eq 0 ]; then
    c_step "Firewall"
    PORTS=("$KEYCLOAK_HTTPS_PORT" "$FE_PORT" "$ENGINE_PORT" "${APP_PORTS/-/:}")
    if [ "$(id -u)" -eq 0 ] && command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
        for p in "${PORTS[@]}"; do ufw allow "$p/tcp" >/dev/null; c_ok "ufw: allow $p/tcp"; done
    elif [ "$(id -u)" -eq 0 ] && command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
        for p in "${PORTS[@]}"; do firewall-cmd --permanent --add-port="${p/:/-}/tcp" >/dev/null; c_ok "firewalld: $p/tcp"; done
        firewall-cmd --reload >/dev/null
    else
        c_warn "no firewall changed (not root, or no active ufw/firewalld). Make sure TCP ${PORTS[*]} are reachable (also in the provider's security group)"
    fi
    c_ok "KH port $KH_PORT stays closed (bound to 127.0.0.1)"
fi

for u in dlc-engine dlc-fe; do
    if [[ " ${WAS_ACTIVE[*]} " == *" $u "* ]]; then sysctl_ start "$u" && c_ok "$u started again"; fi
done

c_step "Done"
cat <<EOF
  Keycloak admin : $U_KEYCLOAK/admin   user 'admin', password in $ADMIN_FILE
  Frontend       : $U_FE  (starts after the engine)
  Engine         : $U_ENGINE
  Next           : configure-claude.sh  ->  seed-stack.sh  ->  verify-stack.sh
EOF
