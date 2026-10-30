#!/usr/bin/env bash
# Install or upgrade the Knowledge Hub helper (kh-helper) for one CLI profile (macOS, Linux). Safe to run again.
# Uses the wheel next to this script; profile: $1, else $CLAUDE_CONFIG_DIR, else ~/.claude (Claude Code).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PROFILE_DIR="${1:-${CLAUDE_CONFIG_DIR:-$HOME/.claude}}"
KH_URL="${KH_URL:-https://knowledge-hub.cfapps.br10.hana.ondemand.com}"
WHEEL="$(ls "$HERE"/kh_helper-*.whl | head -1)"
KH="$PROFILE_DIR/kh-helper/bin/python"
if [ ! -x "$KH" ]; then
    PY=""
    for c in python3.13 python3.12 python3.11 python3.10 python3; do
        if command -v "$c" >/dev/null && "$c" -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"; then
            PY="$c"; break
        fi
    done
    [ -n "$PY" ] || { echo "Python 3.10 or newer is needed (brew install python@3.12 / apt-get install python3 python3-venv)" >&2; exit 1; }
    echo "Creating $PROFILE_DIR/kh-helper ..."
    "$PY" -m venv "$PROFILE_DIR/kh-helper"
fi
echo "Installing $(basename "$WHEEL") ..."
"$KH" -m pip install --upgrade --quiet "$WHEEL"
if ! "$KH" -m kh_helper.cli status | grep -q '"signed_in": true'; then
    echo "Sign in to Knowledge Hub in the browser page that opens ..."
    "$KH" -m kh_helper.cli login --kh-url "$KH_URL"
fi
if "$KH" -m kh_helper.cli setup | grep -q '"failed'; then
    echo "WARNING: KH hooks cannot start in this shell; fix that, then run: \"$KH\" -m kh_helper.cli setup" >&2
fi
"$KH" -m pip show kh-helper | grep '^Version'
echo "Done. Close your CLI (e.g. Claude Code) and open it again to use the new helper."
