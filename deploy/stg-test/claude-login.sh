#!/usr/bin/env bash
# sohoptac2-staging · dang nhap Claude CLI MOT LAN cho ban test (tuong tac: mo link, dan ma).
# Luu vao ./claude-home cua staging (KHONG dung chung prod). Sau do: bash up.sh (hoac restart agent-runtime).
#   bash claude-login.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -x claude-bin/claude ] || { mkdir -p claude-bin; cp -p "$HOME/workspace/sohoptac2/claude-bin/claude" claude-bin/claude; }
mkdir -p claude-home
HOME="$PWD/claude-home" ./claude-bin/claude auth login
HOME="$PWD/claude-home" ./claude-bin/claude auth status
