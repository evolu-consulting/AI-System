#!/usr/bin/env bash
# Chạy trong container runner: dựng .env.local trỏ pg/redis của project evostaging, migrate + seed, chạy hai spike,
# ghi log + JSON vào /out. Không dừng ở spike đỏ đầu tiên (spike đỏ là kết quả, không phải lỗi dựng).
set -uo pipefail
cd /app
git init -q . && git add -A >/dev/null 2>&1 || true   # keys:dev cần gốc repo git

sed -e 's#@localhost:5432#@pg:5432#g' -e 's#redis://localhost:6379#redis://redis:6379#g' .env.example > .env.local
sed -i -e 's#^SEED_ADMIN_EMAIL=.*#SEED_ADMIN_EMAIL=admin@evolu.local#' -e 's#^HUB_PROCESS_ENGINE=.*#HUB_PROCESS_ENGINE=on#' .env.local
echo "HUB_TEST_REDIS_URL=redis://redis:6379/15" >> .env.local
bun run keys:dev >/out/setup.log 2>&1 && bun run db:setup >>/out/setup.log 2>&1 || { echo "setup lỗi"; cat /out/setup.log; exit 2; }

{
  echo "commit: $(cat /app/VERSION 2>/dev/null || echo '?')"
  echo "redis: $(bun -e "const r=new (require('ioredis'))('redis://redis:6379');console.log((await r.info('server')).match(/redis_version:(\S+)/)?.[1]);r.disconnect()" 2>/dev/null)"
  echo "nproc: $(nproc) · mem: $(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo) MB"
} > /out/env.txt

bun --env-file=.env.local --config=bunfig.int.toml test --timeout 600000 spikes/engine/engine.spike.test.ts \
  > /out/engine-spike.log 2>&1
echo "engine-spike exit $?" >> /out/env.txt
bun --env-file=.env.local --config=bunfig.int.toml test --timeout 7200000 spikes/engine/load.spike.test.ts \
  > /out/load-spike.log 2>&1
echo "load-spike exit $?" >> /out/env.txt
# CR-093 · bài hiệu năng P-d (PD-P01…P15) trên Linux, máy rảnh, Redis thật
PERF=1 bun --env-file=.env.local --config=bunfig.perf.toml test --timeout 1800000 tests/acceptance/P-d/perf/ \
  > /out/perf-pd.log 2>&1
echo "perf-pd exit $?" >> /out/env.txt
grep -E '^\((pass|fail)\)|spike1|spike6|spikeLoad|PD-P[0-9]+ | pass$| fail$' /out/engine-spike.log /out/load-spike.log /out/perf-pd.log > /out/summary.txt
cat /out/env.txt /out/summary.txt
