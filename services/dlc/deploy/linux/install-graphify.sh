#!/usr/bin/env bash
# Install Graphify for the DLC engine: the agents then query a local code graph instead of reading code with the
# model. Graphify (Apache-2.0, PyPI graphifyy, CLI graphify) builds the graph with a local AST pass: no model, no key.
#
#   1. venv at $INSTALL_ROOT/apps/graphify with graphifyy==<version> (--wheelhouse DIR: offline, from wheels
#      downloaded beforehand with `pip download graphifyy==<version>`)
#   2. checks `graphify --help` and a real code-only scan of a tiny sample
#   3. LINE_GRAPHIFY in the dlc-engine env file, engine restarted (skip with --no-engine-env)
# Safe to run again.
#
#   sudo ./install-graphify.sh --config ./stack.config.env [--version 0.9.73] [--wheelhouse DIR]
. "$(dirname "$0")/common.sh"
CONFIG=""; VERSION="0.9.73"; WHEELHOUSE=""; NO_ENV=0
while [ $# -gt 0 ]; do case "$1" in
    --config) CONFIG="$2"; shift 2;; --version) VERSION="$2"; shift 2;; --wheelhouse) WHEELHOUSE="$2"; shift 2;;
    --no-engine-env) NO_ENV=1; shift;; *) die "unknown option $1";; esac; done
read_config "$CONFIG"
assert_mode_user

c_step "Python"
command -v python3 >/dev/null || die "python3 3.10+ is required"
python3 -c 'import sys; assert sys.version_info >= (3, 10)' || die "python3 3.10+ required (Graphify)"
python3 -c 'import venv' 2>/dev/null || die "python3 venv module missing (Debian/Ubuntu: apt install python3-venv)"
c_ok "python3 $(python3 -c 'import platform; print(platform.python_version())')"

c_step "Graphify $VERSION"
VENV="$P_APPS/graphify"
EXE="$VENV/bin/graphify"
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV" || die "could not create the venv at $VENV"
PIP=(-m pip install --disable-pip-version-check --quiet)
if [ -n "$WHEELHOUSE" ]; then
    [ -d "$WHEELHOUSE" ] || die "wheelhouse not found: $WHEELHOUSE"
    PIP+=(--no-index --find-links "$WHEELHOUSE")
fi
"$VENV/bin/python" "${PIP[@]}" "graphifyy==$VERSION" || die "pip install graphifyy==$VERSION failed"
[ -x "$EXE" ] || die "graphify missing after install: $EXE"
GOT="$("$VENV/bin/python" -c 'import importlib.metadata as m; print(m.version("graphifyy"))')"
[ "$GOT" = "$VERSION" ] || die "graphifyy $GOT installed, $VERSION expected"
own "$VENV"
c_ok "graphifyy $GOT in $VENV"

c_step "Check"
"$EXE" --help >/dev/null || die "graphify --help failed"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/src"
printf 'def save(note):\n    return store(note)\n\n\ndef store(note):\n    return note\n' > "$TMP/src/notes.py"
env -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u GEMINI_API_KEY \
    "$EXE" extract "$TMP/src" --code-only --max-workers 1 --out "$TMP/out" >"$TMP/log" 2>&1 \
    && [ -f "$TMP/out/graphify-out/graph.json" ] || die "sample scan failed: $(tail -5 "$TMP/log")"
"$EXE" explain save --graph "$TMP/out/graphify-out/graph.json" 2>&1 | grep -q store \
    || die "sample graph does not show save -> store"
c_ok "code-only scan and explain answer (sample: save -> store)"

if [ "$NO_ENV" = 1 ]; then
    c_warn "engine not changed (--no-engine-env): set LINE_GRAPHIFY=$EXE for the engine yourself"
else
    c_step "Engine"
    env_set dlc-engine "LINE_GRAPHIFY=$EXE" "LINE_CODEGRAPH=auto"
    sysctl_ restart dlc-engine
    c_ok "LINE_GRAPHIFY set; engine restarted"
fi
printf '\nGraphify %s installed. Each run'"'"'s target is indexed at its start; agents get code_graph.\n' "$VERSION"
