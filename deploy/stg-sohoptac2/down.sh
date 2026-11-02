#!/usr/bin/env bash
# sohoptac2-stg · dep: chi project `sohoptac2-stg` (down -v: container, mang, volume/tmpfs). Giu thu muc de lay ket qua; --rm-dir xoa luon.
set -uo pipefail
cd "$(dirname "$0")"
docker compose -p sohoptac2-stg --profile tools --profile pw down -v --remove-orphans
[ "${1:-}" = "--rm-dir" ] && { cd .. && rm -rf sohoptac2-stg; }
docker ps -a --filter label=com.docker.compose.project=sohoptac2-stg --format '{{.Names}}' | wc -l