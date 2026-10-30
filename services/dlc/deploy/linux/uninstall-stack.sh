#!/usr/bin/env bash
# Remove the DLC services (and the system-wide certificate trust). Data, secrets and program files are KEPT
# unless --remove-files.
#
#   sudo ./uninstall-stack.sh --config ./stack.config.env [--remove-files]
. "$(dirname "$0")/common.sh"
set +e
CONFIG=""; REMOVE=0
while [ $# -gt 0 ]; do case "$1" in
    --config) CONFIG="$2"; shift 2;; --remove-files) REMOVE=1; shift;; *) die "unknown option $1";; esac; done
read_config "$CONFIG"
assert_mode_user
for id in dlc-fe dlc-engine dlc-kh dlc-keycloak; do
    if [ -f "$(unit_dir)/$id.service" ]; then
        sysctl_ disable --now "$id.service" >/dev/null 2>&1; rm -f "$(unit_dir)/$id.service"; c_ok "service $id removed"
    fi
done
sysctl_ daemon-reload
if [ "$SERVICE_MODE" = system ] && [ -f /usr/local/share/ca-certificates/dlc-keycloak.crt ]; then
    rm -f /usr/local/share/ca-certificates/dlc-keycloak.crt; update-ca-certificates --fresh >/dev/null 2>&1
    c_ok "Keycloak certificate removed from the trusted roots"
fi
c_warn "firewall rules (if any were added) are left in place: ufw status / firewall-cmd --list-ports"
if [ "$REMOVE" -eq 1 ]; then
    read -r -p "Delete EVERYTHING under $INSTALL_ROOT (data included)? type DELETE: " ans
    if [ "$ans" = DELETE ]; then rm -rf "$INSTALL_ROOT"; c_ok "removed $INSTALL_ROOT"; else c_warn "files kept"; fi
fi
