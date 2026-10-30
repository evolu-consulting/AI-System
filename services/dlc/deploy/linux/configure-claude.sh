#!/usr/bin/env bash
# Give the DLC engine service working Claude Code credentials and prove that a non-interactive call works with
# exactly the service's environment.
#
#   --mode token    (recommended for a dedicated server) run `claude setup-token` in any terminal, paste the token;
#                   it is stored only in the engine's env file (mode 600) as CLAUDE_CODE_OAUTH_TOKEN.
#   --mode login    sign in once into the engine's own profile folder (<INSTALL_ROOT>/claude-profile).
#   --mode user     SERVICE_MODE=user only: the engine runs as you and uses your existing Claude Code sign-in
#                   (~/.claude), e.g. on a host where Claude Code is already installed and signed in.
#
#   sudo ./configure-claude.sh --config ./stack.config.env --mode token
. "$(dirname "$0")/common.sh"
CONFIG=""; MODE=token
while [ $# -gt 0 ]; do case "$1" in
    --config) CONFIG="$2"; shift 2;; --mode) MODE="$2"; shift 2;; *) die "unknown option $1";; esac; done
read_config "$CONFIG"
assert_mode_user
case "$MODE" in token|login|user) ;; *) die "--mode must be token, login or user";; esac
[ "$MODE" != user ] || [ "$SERVICE_MODE" = user ] || die "--mode user needs SERVICE_MODE=user"

c_step "Claude Code CLI"
SVC_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
CLAUDE="$(command -v claude || true)"
for p in "$SVC_HOME/.local/bin/claude" "$HOME/.local/bin/claude" /usr/local/bin/claude /usr/bin/claude; do
    [ -n "$CLAUDE" ] && break; [ -x "$p" ] && CLAUDE="$p"
done
[ -n "$CLAUDE" ] || die "claude CLI not found. Install it first: curl -fsSL https://claude.ai/install.sh | bash   (or npm i -g @anthropic-ai/claude-code)"
if [ "$SERVICE_MODE" = system ]; then
    # the service user does not see the installer's PATH: copy the real binary next to the services
    install -m 755 "$(readlink -f "$CLAUDE")" "$P_BIN/claude"; CLAUDE="$P_BIN/claude"
fi
c_ok "CLI: $CLAUDE ($("$CLAUDE" --version 2>/dev/null | head -1))"

ADD=("PATH=$P_BIN:$SVC_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin")
case "$MODE" in
token)
    c_step "Token"
    echo "  In another terminal run:  claude setup-token   (sign in in the browser, copy the token it prints)"
    if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then TOK="$CLAUDE_CODE_OAUTH_TOKEN"; echo "  using CLAUDE_CODE_OAUTH_TOKEN from the environment"
    else read -r -s -p "  Paste the token: " TOK; echo; fi
    [ "${#TOK}" -ge 20 ] || die "that does not look like a token"
    ADD+=("CLAUDE_CODE_OAUTH_TOKEN=$TOK")
    ;;
login)
    PROFILE="$INSTALL_ROOT/claude-profile"; install -d -m 700 "$PROFILE"; own "$PROFILE"
    c_step "Login into $PROFILE"
    echo "  A Claude session opens with the engine's profile. Type /login, finish in the browser, then /exit."
    if [ "$SERVICE_MODE" = system ]; then sudo -u "$SERVICE_USER" env CLAUDE_CONFIG_DIR="$PROFILE" HOME="$SVC_HOME" "$CLAUDE"
    else CLAUDE_CONFIG_DIR="$PROFILE" "$CLAUDE"; fi
    ADD+=("CLAUDE_CONFIG_DIR=$PROFILE")
    ;;
user)
    c_step "Your own Claude Code sign-in ($HOME/.claude)"
    ;;
esac
env_set dlc-engine "${ADD[@]}"
[ "$MODE" = user ] && python3 - "$P_SERVICES/dlc-engine.env" <<'EOF'
import sys
p = sys.argv[1]; rows = open(p).read().splitlines()
open(p, "w").write("\n".join(r for r in rows if not r.startswith(("CLAUDE_CODE_OAUTH_TOKEN=", "CLAUDE_CONFIG_DIR="))) + "\n")
EOF

c_step "Check a non-interactive call with the service's environment"
TMPD="$(mktemp -d)"; chmod 755 "$TMPD"
OUT="$(cd "$TMPD" && svc_exec dlc-engine claude -p "Reply with exactly the word: ready" --max-turns 1 </dev/null 2>&1 || true)"
rm -rf "$TMPD"
echo "$OUT" | grep -qi ready || die "claude -p did not answer as expected:
$OUT"
c_ok "claude -p answers: $(echo "$OUT" | tail -1)"

c_step "Engine service"
c_ok "dlc-engine has the Claude settings ($MODE); it starts in seed-stack.sh (or: $( [ "$SERVICE_MODE" = user ] && echo 'systemctl --user' || echo systemctl ) start dlc-engine)"
