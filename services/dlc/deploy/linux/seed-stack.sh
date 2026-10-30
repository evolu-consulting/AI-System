#!/usr/bin/env bash
# Connect the DLC engine to the knowledge store and seed data: projects, the engine's namespace and client, the
# engine manifest, the lessons learned, the default flows of the frontend, and a first user.
# Safe to run again (the namespace client secret is rotated; the engine restarts with it).
#
#   sudo ./seed-stack.sh --config ./stack.config.env --lessons ../../lessons-customer.json --user demo --roles dlc-user,dlc-admin
#   (the user's password is asked for, or taken from DLC_USER_PASSWORD)
. "$(dirname "$0")/common.sh"
CONFIG=""; LESSONS=""; USERNAME=""; ROLES="dlc-user"; NS="dlc_line"
while [ $# -gt 0 ]; do case "$1" in
    --config) CONFIG="$2"; shift 2;; --lessons) LESSONS="$2"; shift 2;; --user) USERNAME="$2"; shift 2;;
    --roles) ROLES="$2"; shift 2;; --namespace) NS="$2"; shift 2;; *) die "unknown option $1";; esac; done
read_config "$CONFIG"
assert_mode_user

c_step "Knowledge store: projects + engine namespace"
wait_http "$U_KH/health" 120 || die "knowledge store not answering on $U_KH"
CL="$(python3 "$HELPER" kh-seed --kh "$U_KH" --ns "$NS")"
CID="$(echo "$CL" | python3 -c 'import json,sys; print(json.load(sys.stdin)["client_id"])')"
CSEC="$(echo "$CL" | python3 -c 'import json,sys; print(json.load(sys.stdin)["client_secret"])')"
c_ok "projects dlc + lesson-learned, namespace $NS, client $CID works"

c_step "Engine: switch to the knowledge store"
env_set dlc-engine "LINE_RAG=http" "LINE_RAG_URL=$U_KH" "LINE_RAG_NS=$NS" "LINE_RAG_CLIENT_ID=$CID" "LINE_RAG_CLIENT_SECRET=$CSEC"
M="$(cd "$P_DATA/dlc" && svc_exec dlc-engine "$P_APPS/dlc/dlc" rag-manifest apply 2>&1)" \
    || die "manifest apply failed:
$M"
c_ok "manifest applied: $(echo "$M" | tail -1)"
sysctl_ restart dlc-engine
if wait_http "$U_ENGINE_LOCAL/api/health" 120; then c_ok "engine up: $U_ENGINE_LOCAL"; else c_warn "engine not answering - see $P_LOGS/dlc-engine.log"; fi

if [ -n "$LESSONS" ]; then
    c_step "Lessons learned"
    # into the engine's own project: retrieval matches them by meaning there (rag.local.json include_people_lanes)
    python3 "$HELPER" import-lessons --kh "$U_KH" --file "$LESSONS" --project dlc
fi

c_step "Frontend: default flows"
O="$(cd "$P_DATA/fe" && svc_exec dlc-fe "$P_APPS/fe/dlc-fe" seed-flows 2>&1)" || die "seed-flows failed: $O"
c_ok "flows: $(echo "$O" | tail -1)"
sysctl_ restart dlc-fe
if wait_http "$U_FE/" 120; then c_ok "frontend up: $U_FE"; else c_warn "frontend not answering - see $P_LOGS/dlc-fe.log"; fi

if [ -n "$USERNAME" ]; then
    c_step "First user"
    if [ -z "${DLC_USER_PASSWORD:-}" ]; then read -r -s -p "  Password for $USERNAME: " DLC_USER_PASSWORD; echo; fi
    export DLC_USER_PASSWORD
    python3 "$HELPER" kc-user --url "$U_KEYCLOAK" --admin-password-file "$P_SECRETS/keycloak-admin.txt" \
        --username "$USERNAME" --roles "$ROLES" --cafile "$P_CONFIG/keycloak-tls.cer"
fi
c_step "Done - run verify-stack.sh"
