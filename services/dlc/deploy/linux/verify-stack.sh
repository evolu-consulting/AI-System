#!/usr/bin/env bash
# Check the whole DLC stack on this host: one PASS/FAIL line per check, exit code = number of failures.
#   --user NAME   also a real PKCE sign-in (token must carry aud dlc-api + role dlc-user) and the engine API with it
#   --demo        then a real end-to-end run through the frontend (New System from a tiny spec, pause/resume,
#                 nodes, worklog, reports, Start app -> GET the app, Stop app). Uses the model: about $1, 4-10 min.
# The user's password is asked for, or taken from DLC_USER_PASSWORD.
#
#   ./verify-stack.sh --config ./stack.config.env --user demo [--demo]
. "$(dirname "$0")/common.sh"
set +e
CONFIG=""; USERNAME=""; DEMO=0; SKIP_SELFCHECK=0
while [ $# -gt 0 ]; do case "$1" in
    --config) CONFIG="$2"; shift 2;; --user) USERNAME="$2"; shift 2;; --demo) DEMO=1; shift;;
    --skip-selfcheck) SKIP_SELFCHECK=1; shift;; *) die "unknown option $1";; esac; done
read_config "$CONFIG"
CER="$P_CONFIG/keycloak-tls.cer"
FAIL=0
check() {   # check "name" command...   (command output's last line is shown on PASS)
    local name="$1"; shift; local out
    if out="$("$@" 2>&1)"; then printf '\033[32mPASS\033[0m  %s  %s\n' "$name" "$(echo "$out" | tail -1 | cut -c1-160)"
    else FAIL=$((FAIL + 1)); printf '\033[31mFAIL\033[0m  %s  %s\n' "$name" "$(echo "$out" | tail -2 | tr '\n' ' ' | cut -c1-240)"; fi
}

for s in dlc-keycloak dlc-kh dlc-engine dlc-fe; do check "service $s running" sysctl_ is-active "$s"; done
check "Keycloak realm dlc" bash -c "curl -sf --cacert '$CER' '$U_ISSUER/.well-known/openid-configuration' | python3 -c \"import json,sys; d=json.load(sys.stdin); assert d['issuer']=='$U_ISSUER', d['issuer']; print(d['issuer'])\""
check "Keycloak signing keys (JWKS RS256)" bash -c "curl -sf --cacert '$CER' '$U_ISSUER/protocol/openid-connect/certs' | python3 -c \"import json,sys; k=[x for x in json.load(sys.stdin)['keys'] if x.get('alg')=='RS256']; assert k; print(len(k),'key(s)')\""
check "engine trust bundle accepts the Keycloak certificate" curl -sf -o /dev/null --cacert "$CA_BUNDLE" "$U_ISSUER/.well-known/openid-configuration"

TOKFILE=""
if [ -n "$USERNAME" ]; then
    if [ -z "${DLC_USER_PASSWORD:-}" ]; then read -r -s -p "Password for $USERNAME: " DLC_USER_PASSWORD; echo; fi
    export DLC_USER_PASSWORD
    TOKFILE="$(mktemp)"; trap 'rm -f "$TOKFILE"' EXIT
    check "PKCE sign-in as $USERNAME (aud dlc-api, role dlc-user)" python3 "$HELPER" kc-login --url "$U_KEYCLOAK" \
        --redirect "$U_FE/" --username "$USERNAME" --cafile "$CER" --token-file "$TOKFILE"
fi

check "knowledge store health" bash -c "curl -sf '$U_KH/health' | python3 -c \"import json,sys; d=json.load(sys.stdin); assert d.get('status')=='ok', d; print('ok')\""
check "knowledge store capabilities" bash -c "curl -sf '$U_KH/v1/capabilities' | python3 -c \"
import json,sys; n=[c['name'] for c in json.load(sys.stdin)['capabilities']]
miss=[x for x in ('events','records','packs','coord','retrieval','metrics') if x not in n]; assert not miss, 'missing %s' % miss; print(len(n),'capabilities')\""
check "engine retrieval serves lessons by meaning" python3 "$HELPER" retrieval-probe --kh "$U_KH" --rag-local "$P_CONFIG/rag.local.json"
check "engine namespace dlc_line active" bash -c "curl -sf '$U_KH/v1/admin/ns/dlc_line' | python3 -c \"import json,sys; d=json.load(sys.stdin); assert d.get('state')=='active', d; print('active')\""
check "knowledge store bound to 127.0.0.1 only" bash -c "L=\$(ss -ltnH '( sport = :$KH_PORT )' | awk '{print \$4}'); [ -n \"\$L\" ] || { echo 'not listening'; exit 1; }; ! echo \"\$L\" | grep -vqE '^(127\\.0\\.0\\.1|\\[::1\\]):'; echo \$L"

check "engine health" bash -c "curl -sf '$U_ENGINE_LOCAL/api/health' | python3 -c \"import json,sys; d=json.load(sys.stdin); assert d.get('ok'), d; print('ok')\""
check "engine refuses a call without a token (401)" bash -c "c=\$(curl -s -o /dev/null -w '%{http_code}' '$U_ENGINE_LOCAL/api/runs'); [ \"\$c\" = 401 ] || { echo \"got \$c\"; exit 1; }; echo 401"
check "engine OpenAPI" bash -c "curl -sf '$U_ENGINE_LOCAL/api/openapi.json' | python3 -c \"import json,sys; v=json.load(sys.stdin)['openapi']; assert v.startswith('3.'); print(v)\""
if [ -n "$TOKFILE" ] && [ -s "$TOKFILE" ]; then
    check "engine accepts the user token (/api/me)" bash -c "curl -sf -H \"Authorization: Bearer \$(cat '$TOKFILE')\" '$U_ENGINE_LOCAL/api/me' | python3 -c \"import json,sys; d=json.load(sys.stdin); print(d.get('actor') or d)\""
fi
if [ "$SKIP_SELFCHECK" -eq 0 ]; then
    check "engine self-check (dry runs, no model cost)" bash -c "d=\$(mktemp -d) && cd \"\$d\" && '$P_APPS/dlc/dlc' selfcheck; r=\$?; rm -rf \"\$d\"; exit \$r"
fi
check "frontend page" bash -c "c=\$(curl -s -o /dev/null -w '%{http_code}' '$U_FE/'); [ \"\$c\" = 200 ] || { echo \"got \$c\"; exit 1; }; echo 200"
check "frontend reachable on the public address" curl -sf -o /dev/null --max-time 10 "$U_FE/"
check "Claude CLI configured for the engine" bash -c "f='$P_SERVICES/dlc-engine.env'; d=\$(python3 '$HELPER' env-get \"\$f\" CLAUDE_CONFIG_DIR); \
  if python3 '$HELPER' env-get \"\$f\" CLAUDE_CODE_OAUTH_TOKEN | grep -q .; then echo token; \
  elif [ -n \"\$d\" ]; then [ -f \"\$d/.credentials.json\" ] && echo \"profile \$d\"; \
  else [ '$SERVICE_MODE' = user ] && [ -f \"\$HOME/.claude/.credentials.json\" ] && echo \"user sign-in \$HOME/.claude\"; fi"

if [ "$DEMO" -eq 1 ]; then
    [ -n "$USERNAME" ] || die "--demo needs --user"
    echo; echo "=== end-to-end demo run (real model) ==="
    check "end-to-end demo (New System -> green -> Start app)" python3 "$HELPER" demo --fe "$U_FE" --engine "$U_ENGINE_LOCAL" \
        --keycloak "$U_KEYCLOAK" --redirect "$U_FE/" --username "$USERNAME" --cafile "$CER"
fi

echo
if [ "$FAIL" -gt 0 ]; then printf '\033[31m%d check(s) failed\033[0m\n' "$FAIL"; else printf '\033[32mall checks passed\033[0m\n'; fi
exit "$FAIL"
