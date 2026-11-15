#!/usr/bin/env bash
# sohoptac2-staging · dang nhap Claude CLI MOT LAN cho ban test (tuong tac: mo link, dan ma).
# KHONG con dung mac dinh (2026-11-15): compose mount claude-home cua PROD (dung chung dang nhap) - dang nhap/gia han lam o prod.
# Chi dung neu quay lai dang nhap rieng: luu vao ./claude-home local, va doi mount trong docker-compose.yml.
#   bash claude-login.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -x claude-bin/claude ] || { mkdir -p claude-bin; cp -p "$HOME/workspace/sohoptac2/claude-bin/claude" claude-bin/claude; }
mkdir -p claude-home
HOME="$PWD/claude-home" ./claude-bin/claude auth login
HOME="$PWD/claude-home" ./claude-bin/claude auth status
