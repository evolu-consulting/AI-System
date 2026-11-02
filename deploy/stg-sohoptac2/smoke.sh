#!/usr/bin/env bash
# sohoptac2-stg · chay smoke Playwright (container pw, network host => chi 127.0.0.1:2843x). Spec/config o ./pw (scp tu e2e/stg), ket qua ./out/{report,shots,results}.
set -uo pipefail
cd "$(dirname "$0")"
rm -rf out/report out/results out/shots; mkdir -p out pw
[ -f pw/package.json ] || echo '{"name":"stg-smoke","private":true,"devDependencies":{"@playwright/test":"1.63.0"}}' > pw/package.json
docker compose -p sohoptac2-stg run --rm -T pw bash -lc 'cd /w && { [ -d node_modules/@playwright/test ] || bun install --no-save 2>&1 | tail -3; }; node node_modules/@playwright/test/cli.js test -c e2e/stg/stg.config.ts "$@"' _ "$@" < /dev/null
echo "smoke exit $?"